import { reactive } from "vue";
import type {
  CueMarker,
  PauseGap,
  RecordingStatus,
  SegmentMeta,
  Take,
} from "../../../shared/types";
import { takeName, recordingMime } from "../lib/format";
import { recordedTotal } from "../lib/timeline";
import { buildCut, buildFull } from "../lib/builder";
interface ActiveSegment {
  id: string;
  chunks: Blob[];
  recorder: MediaRecorder;
  startLive: number;
  startWall: number;
  startMusic: number;
  /** onstop 完成后 resolve，保证元数据先落盘再开启下一段或收尾 */
  stopped: Promise<void>;
  failed: boolean;
}

interface ActiveSession {
  id: string;
  video: MediaStream;
  audio: MediaStream;
  mime: string;
  segments: ActiveSegment[];
  meta: SegmentMeta[];
  gaps: PauseGap[];
  markers: CueMarker[];
  pausedWall: number;
  pausedLive: number;
}

/** 连点防抖：该窗口内重复的场记点击视为同一次有效操作。 */
const MARK_DEBOUNCE = 300;

export function createRecorder(readMusic: () => number) {
  const state = reactive({
    status: "idle" as RecordingStatus,
    error: "",
    /** 现场时钟：含暂停的完整时长 */
    liveElapsed: 0,
    /** 成片时钟：仅累计有效录制区间 */
    filmElapsed: 0,
    markers: [] as CueMarker[],
    takes: [] as Take[],
    /** 正在构建完整现场版的 Take id（构建期间禁用其下载按钮） */
    buildingId: "",
  });

  let session: ActiveSession | undefined;
  let timer = 0;
  let resuming = false;
  let lastMarkAt = 0;
  /** 已完成 Take 的分段原始数据（非响应式，避免大块二进制进入响应式系统） */
  const takeBlobs = new Map<string, Blob[]>();
  let fillerCtx: AudioContext | undefined;

  function tick() {
    const s = session;
    if (!s) return;
    const now = performance.now();
    if (state.status === "recording") {
      const seg = s.segments[s.segments.length - 1];
      state.liveElapsed = seg.startLive + (now - seg.startWall) / 1000;
      state.filmElapsed =
        recordedTotal(s.meta) + (now - seg.startWall) / 1000;
    } else if (state.status === "paused") {
      state.liveElapsed = s.pausedLive;
      state.filmElapsed = recordedTotal(s.meta);
    }
  }

  function startTimer() {
    if (!timer) timer = window.setInterval(tick, 100);
  }

  /**
   * 每个有效录制区间使用独立的 MediaRecorder。
   * 每段闭包持有自己的 id 与 chunks，迟到的 onstop 只写自己的槽位，
   * 不可能把上一段的停止回调写到继续录制后的新段里。
   */
  function createSegment(
    s: ActiveSession,
    startLive: number,
    startMusic: number,
  ): ActiveSegment {
    const id = crypto.randomUUID();
    const stream = new MediaStream([
      ...s.video.getVideoTracks(),
      ...s.audio.getAudioTracks(),
    ]);
    const recorder = new MediaRecorder(
      stream,
      s.mime ? { mimeType: s.mime } : undefined,
    );
    const seg: ActiveSegment = {
      id,
      chunks: [],
      recorder,
      startLive,
      startWall: performance.now(),
      startMusic,
      stopped: Promise.resolve(),
      failed: false,
    };
    seg.stopped = new Promise<void>((resolve) => {
      recorder.ondataavailable = (e) => {
        if (e.data.size) seg.chunks.push(e.data);
      };
      recorder.onstop = () => {
        const index = s.segments.findIndex((x) => x.id === id);
        if (index >= 0) {
          const duration = (performance.now() - seg.startWall) / 1000;
          s.meta[index] = {
            id,
            startLive: seg.startLive,
            duration,
            startMusic: seg.startMusic,
            endMusic: readMusic(),
          };
        }
        resolve();
      };
      recorder.onerror = () => {
        seg.failed = true;
        state.error =
          "当前分段录制出错，已保留此前录制内容，可停止后下载。";
        try {
          if (recorder.state !== "inactive") recorder.stop();
        } catch {
          resolve();
        }
        void seg.stopped.then(() => finalize(s.id));
      };
    });
    recorder.start(1000);
    return seg;
  }

  function start(canvas: HTMLCanvasElement, audio: MediaStream) {
    if (state.status !== "idle") return;
    state.error = "";
    let video: MediaStream | undefined;
    try {
      if (!window.MediaRecorder || !canvas.captureStream)
        throw Error("此浏览器不支持舞台录制");
      const mime = recordingMime();
      video = canvas.captureStream(30);
      const startMusic = readMusic();
      const s: ActiveSession = {
        id: crypto.randomUUID(),
        video,
        audio,
        mime,
        segments: [],
        meta: [],
        gaps: [],
        markers: [],
        pausedWall: 0,
        pausedLive: 0,
      };
      const first = createSegment(s, 0, startMusic);
      s.segments.push(first);
      s.meta.push({
        id: first.id,
        startLive: 0,
        duration: 0,
        startMusic,
        endMusic: startMusic,
      });
      session = s;
      state.markers = s.markers;
      state.liveElapsed = 0;
      state.filmElapsed = 0;
      state.status = "recording";
      startTimer();
    } catch (e) {
      video?.getTracks().forEach((t) => t.stop());
      state.error = e instanceof Error ? e.message : "无法开始录制";
      state.status = "idle";
    }
  }

  function pause() {
    if (state.status !== "recording" || !session) return;
    const s = session;
    const seg = s.segments[s.segments.length - 1];
    try {
      if (seg.recorder.state === "recording") seg.recorder.stop();
    } catch {}
    const now = performance.now();
    s.pausedWall = now;
    s.pausedLive = seg.startLive + (now - seg.startWall) / 1000;
    state.liveElapsed = s.pausedLive;
    state.filmElapsed = recordedTotal(s.meta);
    // 只停止录制：音乐、舞台、画布轨道均不触碰，现场照常推进
    state.status = "paused";
  }

  async function resume() {
    if (state.status !== "paused" || !session || resuming) return;
    const s = session;
    resuming = true;
    try {
      // 等上一段的 onstop 元数据落盘，避免连续点击时段落错位
      const previous = s.segments[s.segments.length - 1];
      await previous.stopped;
      if (!session || session.id !== s.id || state.status !== "paused") return;
      const now = performance.now();
      const gap: PauseGap = {
        afterSegment: s.segments.length - 1,
        startLive: s.pausedLive,
        endLive: s.pausedLive + (now - s.pausedWall) / 1000,
        duration: (now - s.pausedWall) / 1000,
      };
      s.gaps.push(gap);
      // 从当前现场接上：新段起点即当前现场位置，暂停漏掉的时间不补录
      const next = createSegment(s, gap.endLive, readMusic());
      s.segments.push(next);
      s.meta.push({
        id: next.id,
        startLive: gap.endLive,
        duration: 0,
        startMusic: next.startMusic,
        endMusic: next.startMusic,
      });
      state.status = "recording";
    } finally {
      resuming = false;
    }
  }

  function mark() {
    const s = session;
    if (!s || (state.status !== "recording" && state.status !== "paused"))
      return;
    const now = performance.now();
    if (now - lastMarkAt < MARK_DEBOUNCE) return; // 连点只记一次有效标记
    lastMarkAt = now;
    const kind = state.status === "paused" ? "cut" : "kept";
    let live: number;
    let film: number | null;
    if (kind === "cut") {
      live = s.pausedLive;
      film = null;
    } else {
      const seg = s.segments[s.segments.length - 1];
      live = seg.startLive + (now - seg.startWall) / 1000;
      film = recordedTotal(s.meta) + (now - seg.startWall) / 1000;
    }
    // 通过响应式代理推送，UI 即时更新；底层仍是同一个数组
    state.markers.push({
      id: crypto.randomUUID(),
      label: `场记 ${state.markers.length + 1}`,
      live,
      film,
      music: readMusic(),
      kind,
    });
  }

  async function stop() {
    const s = session;
    if (!s || state.status === "saving" || state.status === "idle") return;
    const wasPaused = state.status === "paused";
    state.status = "saving";
    clearInterval(timer);
    timer = 0;
    const now = performance.now();
    if (wasPaused) {
      // 暂停中停止：从暂停到点击停止之间的现场时间作为尾间隙保留，
      // 去掉暂停版本不拼它，完整现场版用黑场静音填上
      s.gaps.push({
        afterSegment: s.segments.length - 1,
        startLive: s.pausedLive,
        endLive: s.pausedLive + (now - s.pausedWall) / 1000,
        duration: (now - s.pausedWall) / 1000,
      });
    }
    const last = s.segments[s.segments.length - 1];
    try {
      if (last.recorder.state !== "inactive") last.recorder.stop();
    } catch {}
    await last.stopped;
    finalize(s.id);
  }

  function finalize(sessionId: string) {
    const s = session;
    if (!s || s.id !== sessionId) return; // 旧会话的迟到回调直接丢弃
    clearInterval(timer);
    timer = 0;
    try {
      // 同步过滤掉没有数据的失败分段，再按原始下标重新对齐间隙
      const kept = s.segments
        .map((seg, originalIndex) => ({ seg, meta: s.meta[originalIndex], originalIndex }))
        .filter((x) => x.seg.chunks.length > 0);
      if (!kept.length) throw new Error("没有录制到任何内容");
      const blobs = kept.map(
        ({ seg }) =>
          new Blob(seg.chunks, { type: seg.recorder.mimeType || s.mime }),
      );
      const metas = kept.map((x) => x.meta);
      const keptIndex = new Set(kept.map((x) => x.originalIndex));
      const gaps = s.gaps.filter((g) => keptIndex.has(g.afterSegment));
      const mime = s.mime || blobs[0].type;
      const cut = buildCut(blobs, mime);
      const take: Take = {
        id: s.id,
        url: URL.createObjectURL(cut),
        size: cut.size,
        duration: recordedTotal(metas),
        liveDuration:
          recordedTotal(metas) + gaps.reduce((sum, g) => sum + g.duration, 0),
        name: takeName(mime),
        mime,
        startMusic: metas[0].startMusic,
        markers: [...state.markers],
        segments: metas,
        gaps,
      };
      takeBlobs.set(take.id, blobs);
      state.takes.unshift(take);
      s.video.getTracks().forEach((t) => t.stop());
    } catch (e) {
      state.error = e instanceof Error ? e.message : "保存失败";
    } finally {
      session = undefined;
      state.markers = [];
      state.liveElapsed = 0;
      state.filmElapsed = 0;
      state.status = "idle";
    }
  }

  async function downloadFull(id: string) {
    const take = state.takes.find((t) => t.id === id);
    const blobs = takeBlobs.get(id);
    if (!take || !blobs || state.buildingId) return;
    state.buildingId = id;
    state.error = "";
    try {
      fillerCtx ??= new AudioContext();
      const full = await buildFull(blobs, take.gaps, take.mime, fillerCtx);
      const url = URL.createObjectURL(full);
      const a = document.createElement("a");
      a.href = url;
      a.download = takeName(take.mime, "full");
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      state.error =
        e instanceof Error
          ? e.message
          : "完整现场版生成失败，可下载去暂停版本。";
    } finally {
      state.buildingId = "";
    }
  }

  function remove(id: string) {
    const i = state.takes.findIndex((t) => t.id === id);
    if (i >= 0) {
      URL.revokeObjectURL(state.takes[i].url);
      takeBlobs.delete(id);
      state.takes.splice(i, 1);
    }
  }

  function dispose() {
    clearInterval(timer);
    const s = session;
    session = undefined; // 先摘除，迟到的 onstop / finalize 全部变为空操作
    if (s) {
      s.segments.forEach((seg) => {
        try {
          if (seg.recorder.state !== "inactive") seg.recorder.stop();
        } catch {}
      });
      s.video.getTracks().forEach((t) => t.stop());
    }
    state.takes.forEach((t) => URL.revokeObjectURL(t.url));
    takeBlobs.clear();
    void fillerCtx?.close();
    fillerCtx = undefined;
  }

  return {
    state,
    start,
    pause,
    resume,
    mark,
    stop,
    remove,
    dispose,
    downloadFull,
  };
}
export type StageRecorder = ReturnType<typeof createRecorder>;
