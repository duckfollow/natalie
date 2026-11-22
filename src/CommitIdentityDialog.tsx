import { Check, ChevronDown, ShieldKeyhole, LoaderCircle, Mail, UserRound, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useId } from "react";
import { createPortal } from "react-dom";

export function CommitIdentityDialog({ identity, disabled, onSave, onAuthentication, canAuthenticate }: {
  identity: string | null;
  onAuthentication?: () => void;
  canAuthenticate?: boolean;
  disabled: boolean;
  onSave: (name: string, email: string) => Promise<boolean>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const author = identity?.match(/^(.*) <([^<>]*)>$/);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  function closeMenu() { setPosition(null); }
  function openIdentity() {
    closeMenu();
    setError(""); setName(author?.[1] ?? ""); setEmail(author?.[2] ?? "");
    dialog.current?.showModal();
  }
  useLayoutEffect(() => {
    if (!position || !menu.current) return;
    const element = menu.current;
    element.style.left = `${Math.max(8, Math.min(position.left, window.innerWidth - element.offsetWidth - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(position.top, window.innerHeight - element.offsetHeight - 8))}px`;
    element.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [position]);
  useEffect(() => {
    if (!position) return;
    function dismiss(event: PointerEvent) {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) closeMenu();
    }
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", closeMenu);
    };
  }, [position]);
  function openMenu() {
    const bounds = trigger.current?.getBoundingClientRect();
    if (bounds) setPosition({ top: bounds.bottom + 6, left: bounds.right - 230 });
  }
  return (
    <>
      <button ref={trigger} type="button" className="commit-author-inline" disabled={disabled}
        title={identity ?? "Identity and authentication"} aria-label={`Account settings: ${author?.[1] || "Commit identity"}`}
        aria-haspopup="menu" aria-expanded={position !== null} aria-controls={position ? menuId : undefined}
        onClick={() => position ? closeMenu() : openMenu()}
        onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); openMenu(); } }}>
        <span className="git-toolbar-icon"><UserRound size={20} aria-hidden="true" /></span>
        <span className="commit-author-name">{author?.[1] || "Account"}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {position && createPortal(<div ref={menu} id={menuId} className="repo-checkout-menu account-settings-menu" role="menu" aria-label="Identity and authentication"
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); closeMenu(); trigger.current?.focus(); }
          if (event.key === "Tab") closeMenu();
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
          }
        }}>
        <div className="account-settings-summary"><strong>{author?.[1] || "Commit identity"}</strong><span>{author?.[2] || "Set your name and email"}</span></div>
        <button role="menuitem" type="button" onClick={openIdentity}><UserRound size={15} aria-hidden="true" />Commit identity</button>
        <button role="menuitem" type="button" disabled={!canAuthenticate || !onAuthentication} title={!canAuthenticate ? "Add a remote first" : undefined}
          onClick={() => { closeMenu(); trigger.current?.focus(); onAuthentication?.(); }}><ShieldKeyhole size={15} aria-hidden="true" />Authentication</button>
      </div>, document.body)}
      {createPortal(<dialog ref={dialog} className="repo-picker repository-action-picker commit-identity-dialog" aria-labelledby="commit-identity-title"
        onCancel={(event) => { if (saving) event.preventDefault(); }}>
        <header>
          <UserRound size={17} aria-hidden="true" />
          <h2 id="commit-identity-title">Commit author</h2>
          <button type="button" className="repo-picker-close" disabled={saving} aria-label="Close"
            onClick={() => dialog.current?.close()}><X size={17} aria-hidden="true" /></button>
        </header>
        <form className="repo-picker-content git-action-form" onSubmit={async (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (disabled || saving) return;
          setSaving(true);
          setError("");
          try {
            if (await onSave(name.trim(), email.trim())) dialog.current?.close();
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure));
          } finally { setSaving(false); }
        }}>
          <div className="commit-identity-intro"><span className="commit-identity-symbol"><UserRound size={22} /></span><div><strong>Your commit identity</strong><p>Choose how your name appears in commit history.</p></div></div>
          <label>Name<span className="repository-action-field"><UserRound size={15} /><input autoFocus required value={name} disabled={saving}
            autoComplete="name" onChange={(event) => setName(event.target.value)} /></span></label>
          <label>Email<span className="repository-action-field"><Mail size={15} /><input type="email" required value={email} disabled={saving}
            autoComplete="email" onChange={(event) => setEmail(event.target.value)} /></span></label>
          <p className="commit-identity-scope">Saved for this repository · Applies to future commits</p>
          {error && <p className="commit-identity-error" role="alert">{error}</p>}
          <footer>
            <button type="button" disabled={saving} onClick={() => dialog.current?.close()}>Cancel</button>
            <button className="primary" disabled={disabled || saving || !name.trim() || !email.trim()}>
              {saving ? <LoaderCircle size={14} className="commit-identity-spinner" /> : <Check size={14} />}
              {saving ? "Saving…" : "Save changes"}
            </button>
          </footer>
        </form>
      </dialog>, document.body)}
    </>
  );
}
