import { Check, LoaderCircle, Mail, UserRound, X } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

export function CommitIdentityDialog({ identity, disabled, onSave }: {
  identity: string | null;
  disabled: boolean;
  onSave: (name: string, email: string) => Promise<boolean>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const author = identity?.match(/^(.*) <([^<>]*)>$/);
  return (
    <>
      <button type="button" className="commit-author-inline" disabled={disabled}
        title={identity ? `${identity} · Change commit author` : "Set commit author for this repository"} aria-label="Change commit author"
        aria-haspopup="dialog" onClick={() => {
          const match = identity?.match(/^(.*) <([^<>]*)>$/);
          setError("");
          setName(match?.[1] ?? "");
          setEmail(match?.[2] ?? "");
          dialog.current?.showModal();
        }}>
        <span className="git-toolbar-icon"><UserRound size={20} aria-hidden="true" /></span>
        <span className="commit-author-name">{author?.[1] || "Set commit author"}</span>
      </button>
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
