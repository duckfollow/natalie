import { useEffect, useRef, useState } from "react";
import { GitPullRequestArrow, ListChecks, X } from "lucide-react";
import type { Commit } from "./history-graph";

export function CherryPickDialog({
  commit,
  branch,
  head,
  onClose,
  onApply,
}: {
  commit: Commit;
  branch: string;
  head: string | null;
  onClose: () => void;
  onApply: (mainline: number | undefined, noCommit: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mainline, setMainline] = useState("");
  const [noCommit, setNoCommit] = useState(true);
  const merge = commit.parents.length > 1;
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="repo-picker repository-action-picker cherry-picker"
      aria-labelledby="cherry-pick-title"
      onCancel={onClose}
    >
      <header>
        <GitPullRequestArrow size={18} aria-hidden="true" />
        <h2 id="cherry-pick-title">Cherry-pick into <strong>{branch}</strong></h2>
        <button type="button" className="repo-picker-close" aria-label="Close cherry-pick" onClick={onClose}>
          <X size={17} aria-hidden="true" />
        </button>
      </header>
      <form
        className="repo-picker-content git-action-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (merge && !mainline) return;
          onApply(merge ? Number(mainline) : undefined, noCommit);
        }}
      >
        <section className="cherry-preview" aria-label="Cherry-pick graph preview">
          <h3>Commit preview</h3>
          <div className="cherry-preview-graph">
            <div className="cherry-preview-next">
              <strong>{commit.subject || "Untitled commit"}</strong>
              <small>New commit {noCommit ? "after review" : "after cherry-pick"} · from <code>{commit.hash.slice(0, 7)}</code></small>
            </div>
            <div>
              <strong>{branch}</strong>
              <small>Current HEAD{head && <> · <code>{head.slice(0, 7)}</code></>}</small>
            </div>
          </div>
        </section>
        {merge && (
          <label>
            Mainline parent
            <select
              required
              autoFocus
              value={mainline}
              onChange={(event) => setMainline(event.target.value)}
            >
              <option value="">Choose which parent to compare against</option>
              {commit.parents.map((hash, index) => (
                <option key={index} value={index + 1}>
                  Parent {index + 1} · {hash.slice(0, 7)}
                </option>
              ))}
            </select>
            <span>Choose the parent Git should use as the base for this merge commit’s changes.</span>
          </label>
        )}
        <label className="cherry-pick-review">
          <input type="checkbox" checked={noCommit} onChange={(event) => setNoCommit(event.target.checked)} />
          <span>
            <strong>Review before committing</strong>
            <small>Apply changes to Staged in File status.</small>
          </span>
        </label>
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={merge && !mainline}>
            {noCommit ? <ListChecks size={15} aria-hidden="true" /> : <GitPullRequestArrow size={15} aria-hidden="true" />}
            {noCommit ? "Apply changes" : "Cherry-pick"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
