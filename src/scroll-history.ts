/** Center a commit with a continuous acceleration curve; user input takes over immediately. */
export function centerHistoryRow(scroller: HTMLElement, row: HTMLElement, onArrive?: () => void): () => void {
  const bounds = scroller.getBoundingClientRect();
  const target = row.getBoundingClientRect();
  const start = scroller.scrollTop;
  const end = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight,
    start + target.top - bounds.top - scroller.clientTop + target.height / 2 - scroller.clientHeight / 2));
  const distance = end - start;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || Math.abs(distance) < 1) {
    scroller.scrollTo({ top: end, behavior: "instant" });
    onArrive?.();
    return () => {};
  }
  const duration = Math.min(1100, 650 + Math.sqrt(Math.abs(distance)) * 8);
  let frame = 0;
  let started: number | undefined;
  let stopped = false;
  const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
  function stop() {
    stopped = true;
    cancelAnimationFrame(frame);
    events.forEach(event => scroller.removeEventListener(event, stop));
  }
  function tick(now: number) {
    if (stopped || !scroller.isConnected) { stop(); return; }
    started ??= now;
    const t = Math.min(1, (now - started) / duration);
    const eased = t * t * t * (t * (t * 6 - 15) + 10);
    scroller.scrollTo({ top: start + distance * eased, behavior: "instant" });
    if (t < 1) frame = requestAnimationFrame(tick);
    else { stop(); onArrive?.(); }
  }
  events.forEach(event => scroller.addEventListener(event, stop, { passive: true }));
  frame = requestAnimationFrame(tick);
  return stop;
}
