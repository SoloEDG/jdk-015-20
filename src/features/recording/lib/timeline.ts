import type { SegmentMeta } from "../../../shared/types";

/**
 * 把现场位置（含暂停的完整时间线）换算为成片位置（仅有效录制区间）。
 * 落在暂停区间内时返回 null。
 */
export function filmPosition(
  live: number,
  segments: Pick<SegmentMeta, "startLive" | "duration">[],
): number | null {
  let offset = 0;
  for (const s of segments) {
    const endLive = s.startLive + s.duration;
    if (live <= endLive) {
      // 早于本段起点说明处在上一段结束后的暂停区间内
      if (live < s.startLive) return null;
      return offset + (live - s.startLive);
    }
    offset += s.duration;
  }
  return offset;
}

/** 累计所有分段的有效录制时长（即成片总时长）。 */
export const recordedTotal = (
  segments: Pick<SegmentMeta, "duration">[],
): number => segments.reduce((sum, s) => sum + s.duration, 0);

/** 小于该阈值的暂停不再生成黑场填充，避免无意义的极短片段。 */
export const MIN_FILLER = 0.05;
