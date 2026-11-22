import { invoke } from "@tauri-apps/api/core";
import { FileDiff, Layers3, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Preview = { files: { path: string; overlap: boolean }[]; diff: string; truncated: boolean; conflicts: boolean };
export function StashPreviewDialog({ root, stash, disabled, onClose, onApply }: {
  root: string; stash: { name: string; hash: string }; disabled: boolean;
  onClose: () => void; onApply: () => Promise<boolean>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);
  useEffect(() => {
    let current = true;
    dialog.current?.showModal();
    invoke<Preview>("repository", { root, action: { kind: "stash_preview", hash: stash.hash } })
      .then(result => { if (current) setPreview(result); })
      .catch(failure => { if (current) setError(String(failure)); });
    return () => { current = false; };
  }, [root, stash.hash]);
  const overlaps = preview?.files.filter(file => file.overlap).length ?? 0;
  return createPortal(<dialog ref={dialog} className="repo-picker stash-preview-dialog" aria-labelledby="stash-preview-title"
    onCancel={event => { event.preventDefault(); if (!applying) onClose(); }}>
    <header><Layers3 size={18} /><div className="repo-settings-heading"><h2 id="stash-preview-title">Apply stash</h2><span title={stash.name}>{stash.name}</span></div><button type="button" className="repo-picker-close" aria-label="Close stash preview" disabled={applying} onClick={onClose}><X size={17} /></button></header>
    <div className="stash-preview-body" aria-busy={!preview && !error}>
      {error ? <p role="alert" className="stash-preview-warning">{error}</p> : !preview ? <p role="status" className="stash-preview-loading"><LoaderCircle size={16} />Loading stash changes…</p> : <>
        <div className="stash-preview-summary"><span><FileDiff size={15} />{preview.files.length} changed {preview.files.length === 1 ? "file" : "files"}</span><small>Preview only · No files changed yet</small></div>
        {(overlaps > 0 || preview.conflicts) && <div className="stash-preview-warning" role="status"><TriangleAlert size={16} /><span>{preview.conflicts ? "Resolve existing conflicts before applying this stash." : `${overlaps} file(s) overlap with your current changes. Git may refuse to apply or require conflict resolution.`}</span></div>}
        <div className="stash-preview-files">{preview.files.map(file => <div key={file.path}><FileDiff size={13} /><span title={file.path}>{file.path}</span>{file.overlap && <small>Local changes</small>}</div>)}</div>
        <div className="stash-preview-diff" tabIndex={0} aria-label="Stash diff"><pre>{preview.diff.split("\n").map((line, index) => <span key={index} className={line.startsWith("+") ? "stash-diff-added" : line.startsWith("-") ? "stash-diff-removed" : line.startsWith("@@") ? "stash-diff-hunk" : undefined}>{line}{"\n"}</span>)}</pre></div>
        {preview.truncated && <p className="stash-preview-note">Large diff: showing the first 256 KB. All files are listed above.</p>}
      </>}
    </div>
    <footer className="stash-preview-footer"><span>The saved stash is kept after applying. Overlap checks do not guarantee a conflict-free apply.</span><div><button type="button" onClick={onClose} disabled={applying}>Cancel</button><button type="button" className="primary" disabled={disabled || applying || !preview || preview.conflicts || preview.files.length === 0} onClick={async () => {
      setApplying(true); setError("");
      try { await onApply(); } catch (failure) { setError(String(failure)); } finally { setApplying(false); }
    }}>{applying ? <LoaderCircle size={14} /> : <Layers3 size={14} />}{applying ? "Applying…" : "Apply stash"}</button></div></footer>
  </dialog>, document.body);
}
