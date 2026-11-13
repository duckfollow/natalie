import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowDownCircle,
  ArrowUpCircle,
  Cloud,
  CloudDownload,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  Layers3,
  Link2,
  Plus,
  Save,
  X,
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
          className="repo-picker repository-action-picker"
          aria-labelledby="git-action-title"
          onCancel={() => setPrompt(null)}
        >
          <header>
            {prompt === "Origin" && <Cloud size={20} aria-hidden="true" />}
            {prompt === "Branch" && <GitBranch size={20} aria-hidden="true" />}
            {prompt === "Merge" && <GitMerge size={20} aria-hidden="true" />}
            {prompt === "Stash" && <Layers3 size={20} aria-hidden="true" />}
            <h2 id="git-action-title">
              {prompt === "Branch"
                ? "Create branch"
                : prompt === "Merge"
                  ? `Merge into ${currentBranch}`
                  : prompt === "Origin"
                    ? (originUrl == null ? "Add remote origin" : "Change remote origin")
                    : "Stash changes"}
            </h2>
            <button type="button" className="repo-picker-close" aria-label="Close" onClick={() => setPrompt(null)}>
              <X size={17} aria-hidden="true" />
            </button>
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
              <div className="merge-branch-flow">
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
                <ArrowDown size={15} aria-hidden="true" />
                <div className="merge-destination">
                  <span>Destination branch</span>
                  <div>
                    <GitBranch size={15} aria-hidden="true" />
                    <code>{currentBranch}</code>
                  </div>
                </div>
              </div>
            ) : prompt === "Origin" ? (
              <label>
                Repository URL
                <span className="repository-action-field">
                  <Link2 size={15} aria-hidden="true" />
                  <input
                    autoFocus
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    aria-describedby="origin-url-help"
                    required
                    spellCheck={false}
                    autoCapitalize="none"
                    placeholder="https://github.com/owner/repository.git"
                  />
                </span>
                <span id="origin-url-help">Use an HTTPS URL, SSH address, or local repository path.</span>
              </label>
            ) : prompt === "Branch" ? (
              <>
                <label>
                  Branch name
                  <span className="repository-action-field">
                    <GitBranch size={15} aria-hidden="true" />
                    <input
                      autoFocus
                      value={value}
                      onChange={(event) => setValue(event.target.value)}
                      placeholder="feature/my-branch"
                      aria-describedby="branch-start-point"
                      required
                      spellCheck={false}
                      autoCapitalize="none"
                    />
                  </span>
                </label>
                <p id="branch-start-point" className="branch-start-point">
                  Starts from <code>{currentBranch}</code>
                </p>
              </>
            ) : (
              <label>
                Stash message (optional)
                <span className="repository-action-field">
                  <Layers3 size={15} aria-hidden="true" />
                  <input
                    autoFocus
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    placeholder="e.g. Work in progress on checkout"
                    aria-describedby="stash-scope"
                  />
                </span>
              </label>
            )}
            {prompt === "Origin" && originUrl != null && (
              <p>Git will keep any separate push URL. Fetch after saving to refresh remote branches.</p>
            )}
            {prompt === "Stash" && (
              <p id="stash-scope">Includes staged and unstaged changes, plus untracked files.</p>
            )}
            <footer>
              <button type="button" onClick={() => setPrompt(null)}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={busy || (prompt !== "Stash" && !value.trim())}
              >
                {prompt === "Origin"
                  ? originUrl == null
                    ? <><Plus size={14} aria-hidden="true" /> Add origin</>
                    : <><Save size={14} aria-hidden="true" /> Save changes</>
                  : prompt === "Branch"
                    ? <><Plus size={14} aria-hidden="true" /> Create branch</>
                    : prompt === "Merge"
                      ? <><GitMerge size={14} aria-hidden="true" /> Merge branches</>
                      : <><Layers3 size={14} aria-hidden="true" /> Stash changes</>}
              </button>
            </footer>
          </form>
        </dialog>
      )}
    </>
  );
}
