import { AlignLeft, Bot, Check, ListChecks, LoaderCircle, ScanText } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { MessageDetail } from "./commit-message";

const options = [
  { value: "short", label: "Short", Icon: AlignLeft },
  { value: "detailed", label: "Detailed", Icon: ListChecks },
  { value: "analysis", label: "Analysis", Icon: ScanText },
] as const;

export function CommitGenerateButton({ disabled, working, ready, detail, onDetail, onGenerate }: {
  disabled: boolean;
  working: boolean;
  ready: boolean | null;
  detail: MessageDetail;
  onDetail: (detail: MessageDetail) => void;
  onGenerate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const id = useId();
  function clearHold() {
    clearTimeout(timer.current);
    start.current = null;
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    container.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    function outside(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", outside);
    return () => window.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (disabled) { clearHold(); setOpen(false); }
  }, [disabled]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <div className="commit-generator-actions commit-hold-control" ref={container}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <button ref={trigger} type="button" className="commit-message-generate"
        disabled={disabled} aria-busy={working} aria-haspopup="menu" aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={working ? "Generating commit message" : `Generate commit message · ${detail}. Hold to choose format.`}
        title={`Generate message · ${detail} · Hold or right-click to choose format`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          clearHold();
          held.current = false;
          start.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
          timer.current = setTimeout(() => { held.current = true; setOpen(true); }, 500);
        }}
        onPointerMove={(event) => {
          if (start.current && Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 8) {
            held.current = true;
            clearHold();
          }
        }}
        onPointerUp={clearHold}
        onPointerCancel={() => { held.current = true; clearHold(); }}
        onLostPointerCapture={clearHold}
        onClick={() => { if (!held.current && !open) onGenerate(); }}
        onContextMenu={(event) => { event.preventDefault(); clearHold(); held.current = true; setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === "ContextMenu" || event.key === "ArrowDown" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault(); held.current = true; setOpen(true);
          } else if (event.key === "Enter" || event.key === " ") held.current = false;
        }}>
        {working ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : (
          <span className="commit-ai-status" data-ready={ready ?? undefined} role="img"
            aria-label={ready === null ? "AI loads on first generation" : ready ? "AI ready" : "AI failed"} />
        )}
        <Bot size={16} aria-hidden="true" />
      </button>
      {open && <div id={id} role="menu" aria-label="Message format" className="commit-format-menu"
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); close(); }
          if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
            event.preventDefault();
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
              : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
            items[index]?.focus();
          }
        }}>
        {options.map(({ value, label, Icon }) => (
          <button type="button" role="menuitemradio" aria-checked={detail === value} key={value}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => { onDetail(value); close(); }}>
            <Icon size={14} aria-hidden="true" /><span>{label}</span>
            {detail === value && <Check size={14} aria-hidden="true" />}
          </button>
        ))}
      </div>}
    </div>
  );
}
