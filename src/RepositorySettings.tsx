import { invoke } from "@tauri-apps/api/core";
import { Settings, X, UserRound, Cloud, RefreshCw, ShieldKeyhole, SlidersHorizontal } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

type Setting = { key: string; value: string; scope: string };
const sections = [
  { name: "Identity", icon: UserRound, keys: ["user.name", "user.email"] },
  { name: "Remotes", icon: Cloud, keys: ["remote.origin.url", "remote.origin.fetch", "fetch.prune"] },
  { name: "Sync", icon: RefreshCw, keys: ["pull.rebase", "pull.ff", "push.default", "push.autoSetupRemote"] },
  { name: "Authentication", icon: ShieldKeyhole, keys: ["credential.helper", "commit.gpgsign", "tag.gpgsign", "gpg.format"] },
  { name: "Advanced", icon: SlidersHorizontal, keys: ["core.autocrlf", "core.safecrlf", "core.ignorecase", "core.filemode", "core.editor", "diff.tool", "merge.tool"] },
];
const labels: Record<string, [string, string]> = {
  "user.name": ["Author name", "Name recorded on new commits"],
  "user.email": ["Author email", "Email recorded on new commits"],
  "remote.origin.url": ["Origin URL", "Default remote repository"],
  "remote.origin.fetch": ["Fetch mapping", "Remote branches tracked locally"],
  "fetch.prune": ["Prune deleted branches", "Remove remote references when fetching"],
  "pull.rebase": ["Rebase on pull", "Replay local commits when pulling"],
  "pull.ff": ["Fast-forward policy", "Control how pull integrates remote history"],
  "push.default": ["Push behavior", "Choose which branch to push"],
  "push.autoSetupRemote": ["Automatic upstream", "Set tracking on the first push"],
  "credential.helper": ["Credential storage", "Helper used for authentication"],
  "commit.gpgsign": ["Sign commits", "Sign new commits automatically"],
  "tag.gpgsign": ["Sign tags", "Sign new tags automatically"],
  "gpg.format": ["Signing format", "GPG or SSH signature format"],
  "core.autocrlf": ["Line ending conversion", "Convert line endings on checkout and commit"],
  "core.safecrlf": ["Line ending protection", "Check for irreversible conversions"],
  "core.ignorecase": ["Case handling", "How Git handles filename capitalization"],
  "core.filemode": ["File permissions", "Track executable permission changes"],
  "core.editor": ["Editor", "Editor used by Git"],
  "diff.tool": ["Diff tool", "External tool for comparing changes"],
  "merge.tool": ["Merge tool", "External tool for resolving conflicts"],
};
const descriptions = ["The identity recorded in your commit history.", "Connection and tracking settings for your remote.", "How local and remote history stay in sync.", "Credential storage and signature preferences.", "File handling and external tools."];
export function RepositorySettings({ root }: { root: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef(0);
  const [section, setSection] = useState(0);
  const [rows, setRows] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function open() {
    dialog.current?.showModal();
    const id = ++request.current;
    setLoading(true); setError(""); setRows([]);
    try { const result = await invoke<Setting[]>("git_settings", { root }); if (id === request.current) setRows(result); }
    catch (failure) { if (id === request.current) setError(String(failure)); }
    finally { if (id === request.current) setLoading(false); }
  }
  const selected = sections[section];
  return <>
    <button type="button" className="repo-settings-trigger" title="Repository settings" aria-label="Repository settings" aria-haspopup="dialog" onClick={() => void open()}><Settings size={16} /></button>
    {createPortal(<dialog ref={dialog} className="repo-picker repo-settings-dialog" aria-labelledby="repo-settings-title">
      <header><Settings size={18} /><div className="repo-settings-heading"><h2 id="repo-settings-title">Repository settings</h2><span title={root}>{root.split("/").filter(Boolean).pop()}</span></div><button type="button" className="repo-picker-close" aria-label="Close settings" onClick={() => dialog.current?.close()}><X size={17} /></button></header>
      <div className="repo-settings-layout">
        <nav aria-label="Settings categories">{sections.map(({ name, icon: Icon }, index) => <button type="button" key={name} aria-pressed={section === index} onClick={() => setSection(index)}><Icon size={15} />{name}</button>)}</nav>
        <section className="repo-settings-content" aria-busy={loading}>
          <div className="repo-settings-section-heading"><h3>{selected.name}</h3><p>{descriptions[section]}</p></div>
          <div className="repo-settings-values">
          {loading ? <p role="status">Loading settings…</p> : error ? <p role="alert">{error}</p> : selected.keys.map(key => {
            const values = rows.filter(row => row.key === key).reverse();
            const [label, description] = labels[key] ?? [key, ""];
            return <article className="repo-setting" key={key}>
              <div className="repo-setting-label"><h4>{label}</h4><p>{description}</p><code>{key}</code></div>
              <div className="repo-setting-values">{values.length ? values.map((row, index) => <div className="repo-setting-value" key={row.scope}><span>{row.value || "(empty)"}</span><small data-primary={index === 0}>{row.scope}</small></div>) : <span className="repo-setting-unset">Not configured</span>}</div>
            </article>;
          })}
          </div>
        </section>
      </div>
      <footer className="repo-settings-footer"><span>View only · Repository overrides Global and System</span><span>Change author from the name beside Auth</span></footer>
    </dialog>, document.body)}
  </>;
}
