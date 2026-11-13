import { useEffect, useRef, useState } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  CloudDownload,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  Layers3,
  Settings2,
} from "lucide-react";

export type GitAction =
  | { kind: "fetch" | "pull" | "push" }
  | { kind: "branch"; name: string }
  | { kind: "merge"; branch: string }
  | { kind: "stash"; message: string }
  | { kind: "set_origin"; url: string };

const operations = [
  { label: "Commit", icon: GitCommitHorizontal },
  { label: "Pull", icon: ArrowDownCircle },
  { label: "Push", icon: ArrowUpCircle },
  { label: "Fetch", icon: CloudDownload },
  { label: "Branch", icon: GitBranch },
  { label: "Merge", icon: GitMerge },
  { label: "Stash", icon: Layers3 },
  { label: "Origin", icon: Settings2 },
] as const;

type Prompt = "Branch" | "Merge" | "Stash" | "Origin";

export function GitToolbar({
  busy,
  branches,
  currentBranch,
  originUrl,
  ahead,
  behind,
  changes,
  onCommit,
  onAction,
}: {
  busy: boolean;
  branches: string[];
  currentBranch: string;
  originUrl: string | null;
  ahead: number | null;
  behind: number | null;
  changes: number;
  onCommit: () => void;
  onAction: (action: GitAction) => void;
}) {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [value, setValue] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const mergeBranches = branches.filter((branch) => branch !== currentBranch);
  useEffect(() => {
    if (!prompt) return;
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, [prompt]);

  return (
    <>
      <div className="git-toolbar" role="group" aria-label="Git actions">
        {operations.map(({ label, icon: Icon }) => (
          <button
            key={label}
            type="button"
            title={label === "Pull" ? "Pull using fast-forward only" : label}
            disabled={
              busy ||
              (label === "Merge" && !mergeBranches.length) ||
              (label === "Stash" && !changes)
            }
            onClick={() => {
              switch (label) {
                case "Commit":
                  onCommit();
                  break;
                case "Pull":
                  onAction({ kind: "pull" });
                  break;
                case "Push":
                  onAction({ kind: "push" });
                  break;
                case "Fetch":
                  onAction({ kind: "fetch" });
                  break;
                case "Branch":
                case "Merge":
                case "Stash":
                case "Origin":
                  setValue(label === "Origin" ? (originUrl ?? "") : label === "Merge" ? (mergeBranches[0] ?? "") : "");
                  setPrompt(label);
              }
            }}
          >
            <span className="git-toolbar-icon">
              <Icon size={20} aria-hidden="true" />
            </span>
            {label}
            {label === "Commit" && changes > 0 && (
              <small className="git-toolbar-count" aria-label={`${changes} changed files`}>
                {changes}
              </small>
            )}
            {label === "Pull" && behind != null && behind > 0 && (
              <small className="git-toolbar-count" aria-label={`${behind} commits to pull`}>
                {behind}
              </small>
            )}
            {label === "Push" && ahead != null && ahead > 0 && (
              <small className="git-toolbar-count" aria-label={`${ahead} commits to push`}>
                {ahead}
              </small>
            )}
          </button>
        ))}
      </div>
      {prompt && (
        <dialog
          ref={dialog}
          className="repo-picker"
          aria-labelledby="git-action-title"
          onCancel={() => setPrompt(null)}
        >
          <header>
            <h2 id="git-action-title">
              {prompt === "Branch"
                ? "Create branch"
                : prompt === "Merge"
                  ? `Merge into ${currentBranch}`
                  : prompt === "Origin"
                    ? (originUrl == null ? "Add remote origin" : "Change remote origin")
                    : "Stash changes"}
            </h2>
          </header>
          <form
            className="repo-picker-content git-action-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (prompt === "Branch")
                onAction({ kind: "branch", name: value.trim() });
              if (prompt === "Merge")
                onAction({ kind: "merge", branch: value });
              if (prompt === "Stash")
                onAction({ kind: "stash", message: value });
              if (prompt === "Origin")
                onAction({ kind: "set_origin", url: value.trim() });
              setPrompt(null);
            }}
          >
            {prompt === "Merge" ? (
              <label>
                Source branch
                <select
                  autoFocus
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                >
                  {mergeBranches.map((branch) => (
                    <option key={branch}>{branch}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                {prompt === "Branch"
                  ? "Branch name"
                  : prompt === "Origin" ? "Origin URL" : "Stash message (optional)"}
                <input
                  autoFocus
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  required={prompt !== "Stash"}
                  spellCheck={prompt === "Origin" ? false : undefined}
                  placeholder={prompt === "Origin" ? "git@github.com:owner/repository.git" : undefined}
                />
              </label>
            )}
            {prompt === "Origin" && (
              <p>Accepts HTTPS, SSH or a local repository path. A separately configured push URL stays unchanged. Fetch after saving to refresh remote commits.</p>
            )}
            {prompt === "Stash" && (
              <p>Stashes staged, unstaged and untracked changes.</p>
            )}
            <footer>
              <button type="button" onClick={() => setPrompt(null)}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={busy || (prompt !== "Stash" && !value.trim())}
              >
                {prompt === "Branch" ? "Create" : prompt === "Origin" ? "Save origin" : prompt}
              </button>
            </footer>
          </form>
        </dialog>
      )}
    </>
  );
}
