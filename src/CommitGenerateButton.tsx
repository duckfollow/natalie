import { commitModels, commitModel, type CommitModelId } from "./commit-models";
import { AlignLeft, Bot, Check, ListChecks, LoaderCircle, ScanText, Settings2, SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { MessageDetail } from "./commit-message";

const options = [
  { value: "short", label: "Short", Icon: AlignLeft },
  { value: "detailed", label: "Detailed", Icon: ListChecks },
  { value: "analysis", label: "Analysis", Icon: ScanText },
] as const;

export function CommitGenerateButton({ disabled, working, ready, detail, useModel, modelId, onModel, onGenerator, onDetail, onGenerate }: {
  disabled: boolean;
  working: boolean;
  ready: boolean | null;
  detail: MessageDetail;
  useModel: boolean;
  modelId: CommitModelId;
  onModel: (id: CommitModelId) => void;
  onGenerator: (useAI: boolean) => void;
  onDetail: (detail: MessageDetail) => void;
  onGenerate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
  useEffect(() => () => {
    clearTimeout(timer.current);
    clearTimeout(hoverTimer.current);
  }, []);
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
      data-settings-visible={showSettings || open}
      onMouseEnter={() => {
        clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => setShowSettings(true), 1500);
      }}
      onMouseLeave={() => {
        clearTimeout(hoverTimer.current);
        setShowSettings(false);
      }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <button ref={trigger} type="button" className="commit-message-generate"
        disabled={disabled} aria-busy={working} aria-haspopup="menu" aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={working ? "Generating commit message" : `Generate commit message · ${detail} · ${useModel ? commitModel(modelId).label : "Rules"}. Hold to choose options.`}
        title={`Generate message · ${detail} · ${useModel ? commitModel(modelId).label : "Rules"} · Hold or right-click for options`}
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
          <span className="commit-ai-status" data-ready={useModel ? ready ?? undefined : true} role="img"
            aria-label={!useModel ? "Rules ready" : ready === null ? "AI loads on first generation" : ready ? "AI ready" : "AI failed"} />
        )}
        <Bot size={16} aria-hidden="true" />
      </button>
      <div className="commit-settings-reveal">
        <button type="button" className="commit-settings-trigger" disabled={working}
          aria-label="Commit message settings" title="Commit message settings"
          aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
          onClick={() => { held.current = true; setOpen(current => !current); }}>
          <Settings2 size={14} aria-hidden="true" />
        </button>
      </div>
      {open && <div id={id} role="menu" aria-label="Commit message options" className="commit-format-menu"
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
        <div role="group" aria-label="Message format">
          <div className="commit-menu-heading" aria-hidden="true">Message format</div>
        {options.map(({ value, label, Icon }) => (
          <button type="button" role="menuitemradio" aria-checked={detail === value} key={value}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => { onDetail(value); close(); }}>
            <Icon size={14} aria-hidden="true" /><span>{label}</span>
            {detail === value && <Check size={14} aria-hidden="true" />}
          </button>
        ))}
        </div>
        <div role="group" aria-label="Generator" className="commit-generator-group">
          <div className="commit-menu-heading" aria-hidden="true">Generator</div>
          <button type="button" role="menuitemradio" aria-checked={!useModel}
            onMouseDown={(event) => event.preventDefault()} onClick={() => { onGenerator(false); close(); }}>
            <SlidersHorizontal size={14} aria-hidden="true" />
            <span className="commit-generator-choice"><span>Rules</span><small>Instant · offline</small></span>
            {!useModel && <Check size={14} aria-hidden="true" />}
          </button>
          {commitModels.map(model => (
            <button type="button" role="menuitemradio" aria-checked={useModel && modelId === model.id} key={model.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { onModel(model.id); close(); }}>
              <Bot size={14} aria-hidden="true" />
              <span className="commit-generator-choice"><span>{model.label}</span><small>{model.description}</small></span>
              {useModel && modelId === model.id && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
        </div>
      </div>}
    </div>
  );
}
