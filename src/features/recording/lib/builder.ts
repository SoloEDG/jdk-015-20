import type { PauseGap } from "../../../shared/types";
import { recordingMime } from "./format";
import { MIN_FILLER } from "./timeline";

/**
 * 生成一段「黑场 + 静音」填充，音视频来自同一个 MediaRecorder，
 * 因此填充段的画面与声音严格等长，不会出现各自删掉不同时长。
 */
export async function makeFiller(
  seconds: number,
  ctx: AudioContext,
): Promise<Blob> {
  const duration = Math.max(seconds, MIN_FILLER);
  const mime = recordingMime();
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const c = canvas.getContext("2d");
  if (c) {
    c.fillStyle = "#000";
    c.fillRect(0, 0, canvas.width, canvas.height);
  }
  const video = canvas.captureStream(30);

  const dest = ctx.createMediaStreamDestination();
  const silence = ctx.createBufferSource();
  silence.buffer = ctx.createBuffer(
    dest.channelCount || 2,
    Math.ceil(ctx.sampleRate * duration),
    ctx.sampleRate,
  );
  silence.connect(dest);

  const stream = new MediaStream([
    ...video.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);
  const recorder = new MediaRecorder(
    stream,
    mime ? { mimeType: mime } : undefined,
  );
  const parts: Blob[] = [];
  // 用音频时钟等待，保证静音时长就是暂停时长
  const wait = ctx.createBufferSource();
  wait.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  wait.connect(ctx.destination);

  const cleanup = () => {
    stream.getTracks().forEach((t) => t.stop());
    try {
      silence.disconnect();
    } catch {}
    try {
      wait.disconnect();
    } catch {}
  };

  try {
    return await new Promise<Blob>((resolve, reject) => {
      let settled = false;
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        reject(new Error(message));
      };
      recorder.ondataavailable = (e) => {
        if (e.data.size) parts.push(e.data);
      };
      recorder.onstop = () => {
        if (settled) return;
        settled = true;
        resolve(new Blob(parts, { type: recorder.mimeType || mime }));
      };
      recorder.onerror = () => fail("填充片段生成失败，可改用去暂停版本下载");
      wait.onended = () => {
        try {
          silence.stop();
        } catch {}
        try {
          if (recorder.state !== "inactive") recorder.stop();
        } catch {
          fail("填充片段结束失败，可改用去暂停版本下载");
        }
      };
      silence.start();
      recorder.start();
      wait.start(ctx.currentTime + duration);
    });
  } finally {
    cleanup();
  }
}

/** 去掉暂停区间：只拼接有效分段，音视频按整段一起移除，天然等长。 */
export function buildCut(blobs: Blob[], mime: string): Blob {
  return new Blob(blobs, { type: mime });
}

/**
 * 保留完整现场：分段与黑场静音填充按现场顺序交替拼接，
 * 填充时长来自统一的时间线元数据，音频与画面使用同一份填充。
 * gaps 的 afterSegment 指向 take.segments 的下标。
 */
export async function buildFull(
  blobs: Blob[],
  gaps: PauseGap[],
  mime: string,
  ctx: AudioContext,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const significant = gaps.filter((g) => g.duration >= MIN_FILLER);
  const total = significant.length;
  let done = 0;
  const parts: Blob[] = [];
  for (let i = 0; i < blobs.length; i++) {
    parts.push(blobs[i]);
    for (const gap of significant.filter((g) => g.afterSegment === i)) {
      parts.push(await makeFiller(gap.duration, ctx));
      done += 1;
      onProgress?.(done, total);
    }
  }
  return new Blob(parts, { type: mime });
}
