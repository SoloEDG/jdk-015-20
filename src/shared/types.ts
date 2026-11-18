export type SceneKind = "orbit" | "spectrum" | "wave" | "tunnel";
export interface Scene {
  id: string;
  name: string;
  kind: SceneKind;
  theme: string;
  intensity: number;
  speed: number;
}
export interface Analysis {
  bins: number[];
  wave: number[];
  rms: number;
  bass: number;
  beat: boolean;
  time: number;
}
export interface StageDocument {
  scenes: Scene[];
  activeId: string;
  gain: number;
  sensitivity: number;
  smoothing: number;
  transition: number;
  blackout: boolean;
  frozen: boolean;
  strobe: boolean;
  master: number;
}
export type RecordingStatus = "idle" | "recording" | "paused" | "saving";
export type CueKind = "kept" | "cut";
export interface CueMarker {
  id: string;
  label: string;
  /** 现场位置：含暂停区间的完整时间线 */
  live: number;
  /** 成片位置：去掉暂停后的时间线；落在剪去区间时为 null */
  film: number | null;
  /** 音乐位置：取自音频引擎的连续播放位置，长排练不中断 */
  music: number;
  kind: CueKind;
}
export interface SegmentMeta {
  id: string;
  /** 该段在现场时间线上的起点（含此前暂停时长） */
  startLive: number;
  /** 实际录制时长（不含暂停） */
  duration: number;
  startMusic: number;
  endMusic: number;
}
export interface PauseGap {
  /** 该间隙跟在哪个分段之后（分段下标），用于失败分段被过滤后重新对齐 */
  afterSegment: number;
  startLive: number;
  endLive: number;
  /** endLive - startLive，即被剪掉的时长 */
  duration: number;
}
export interface Take {
  id: string;
  /** 成片版本（已去暂停）的对象地址 */
  url: string;
  size: number;
  /** 成片时长（去掉暂停区间） */
  duration: number;
  /** 完整现场时长（含暂停区间） */
  liveDuration: number;
  name: string;
  mime: string;
  /** 开始录制时的音乐位置，便于在长排练中定位 */
  startMusic: number;
  markers: CueMarker[];
  segments: SegmentMeta[];
  gaps: PauseGap[];
}
export interface Theme {
  id: string;
  name: string;
  colors: [string, string, string];
  background: string;
}
