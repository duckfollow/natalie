import { useEffect, useRef, useState } from "react";
import { GitPullRequestArrow } from "lucide-react";
import type { Commit } from "./history-graph";

export function CherryPickDialog({
  commit,
  branch,
  onClose,
  onApply,
}: {
  commit: Commit;
  branch: string;
  onClose: () => void;
  onApply: (mainline?: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mainline, setMainline] = useState("");
  const merge = commit.parents.length > 1;
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="repo-picker"
      aria-labelledby="cherry-pick-title"
      onCancel={onClose}
    >
      <header>
        <GitPullRequestArrow size={18} aria-hidden="true" />
        <h2 id="cherry-pick-title">Cherry-pick into {branch}</h2>
      </header>
      <form
        className="repo-picker-content git-action-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (merge && !mainline) return;
          onApply(merge ? Number(mainline) : undefined);
        }}
      >
        <p>
          <code>{commit.hash.slice(0, 7)}</code> · {commit.subject}
        </p>
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
          </label>
        )}
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={merge && !mainline}>
            Cherry-pick
          </button>
        </footer>
      </form>
    </dialog>
  );
}
