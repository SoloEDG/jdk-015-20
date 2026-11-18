export function recordingMime() {
  return (
    [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4",
    ].find((t) => MediaRecorder.isTypeSupported(t)) ?? ""
  );
}
export function takeName(mime: string, mode: "cut" | "full" = "cut") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = mime.includes("mp4") ? "mp4" : "webm";
  const suffix = mode === "full" ? "LIVE" : "CUT";
  return `Resonance-${stamp}-${suffix}.${ext}`;
}
