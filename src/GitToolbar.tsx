import { Dropdown } from "./Dropdown";
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
  Tag,
} from "lucide-react";

export type GitAction =
  | { kind: "fetch" | "pull" | "push" }
  | { kind: "publish_branch"; branch: string; remote: string }
  | { kind: "branch"; name: string; start?: string }
  | { kind: "rename_branch"; branch: string; name: string }
  | { kind: "tag"; name: string; hash: string }
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

type Prompt = "Publish" | "Branch" | "Merge" | "Stash" | "Origin";

export function GitToolbar({
  busy,
  branches,
  currentBranch,
  remotes,
  canPush,
  hasUpstream,
  tagCommit,
  branchCommit,
  renameBranch,
  onPromptClose,
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
  remotes: string[];
  canPush: boolean;
  hasUpstream: boolean;
  tagCommit: string | null;
  branchCommit: string | null;
  renameBranch: string | null;
  onPromptClose: () => void;
  originUrl: string | null;
  ahead: number | null;
  behind: number | null;
  changes: number;
  onCommit: () => void;
  onAction: (action: GitAction) => void;
}) {
  const [toolbarPrompt, setPrompt] = useState<Prompt | null>(null);
  const [value, setValue] = useState("");
  const prompt = renameBranch ? "Rename" : tagCommit ? "Tag" : branchCommit ? "Branch" : toolbarPrompt;
  function closePrompt() {
    setValue("");
    setPrompt(null);
    onPromptClose();
  }
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
            title={
              label === "Pull" ? "Pull using fast-forward only"
                : label === "Push" && !canPush ? "Check out a branch with a commit to push"
                : label === "Push" && !hasUpstream ? (remotes.length ? "Publish branch" : "Add a remote to publish")
                : label
            }
            disabled={
              busy ||
              (label === "Push" && !canPush) ||
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
                  if (hasUpstream) {
                    onAction({ kind: "push" });
                  } else if (remotes.length) {
                    setValue(remotes.includes("origin") ? "origin" : remotes[0]);
                    setPrompt("Publish");
                  } else {
                    setValue("");
                    setPrompt("Origin");
                  }
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
          onCancel={closePrompt}
        >
          <header>
            {prompt === "Publish" && <ArrowUpCircle size={20} aria-hidden="true" />}
            {prompt === "Origin" && <Cloud size={20} aria-hidden="true" />}
            {prompt === "Tag" && <Tag size={20} aria-hidden="true" />}
            {(prompt === "Branch" || prompt === "Rename") && <GitBranch size={20} aria-hidden="true" />}
            {prompt === "Merge" && <GitMerge size={20} aria-hidden="true" />}
            {prompt === "Stash" && <Layers3 size={20} aria-hidden="true" />}
            <h2 id="git-action-title">
              {prompt === "Publish" ? "Publish branch" : prompt === "Rename" ? "Rename branch" : prompt === "Tag" ? "Create tag" : prompt === "Branch"
                ? "Create branch"
                : prompt === "Merge"
                  ? `Merge into ${currentBranch}`
                  : prompt === "Origin"
                    ? (originUrl == null ? "Add remote origin" : "Change remote origin")
                    : "Stash changes"}
            </h2>
            <button type="button" className="repo-picker-close" aria-label="Close" onClick={closePrompt}>
              <X size={17} aria-hidden="true" />
            </button>
          </header>
          <form
            className="repo-picker-content git-action-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy || (prompt !== "Stash" && !value.trim()) || value.trim() === renameBranch) return;
              if (prompt === "Publish" && canPush && !hasUpstream && remotes.includes(value))
                onAction({ kind: "publish_branch", branch: currentBranch, remote: value });
              if (prompt === "Tag" && tagCommit)
                onAction({ kind: "tag", name: value.trim(), hash: tagCommit });
              if (prompt === "Rename" && renameBranch)
                onAction({ kind: "rename_branch", branch: renameBranch, name: value.trim() });
              if (prompt === "Branch")
                onAction({ kind: "branch", name: value.trim(), start: branchCommit ?? undefined });
              if (prompt === "Merge")
                onAction({ kind: "merge", branch: value });
              if (prompt === "Stash")
                onAction({ kind: "stash", message: value });
              if (prompt === "Origin")
                onAction({ kind: "set_origin", url: value.trim() });
              closePrompt();
            }}
          >
            {prompt === "Publish" ? (
              <>
                <Dropdown
                  label="Remote"
                  options={remotes.map((remote) => ({ value: remote, label: remote }))}
                  value={value}
                  onChange={setValue}
                  autoFocus
                />
                <p>Push <code>{currentBranch}</code> and set <code>{value}/{currentBranch}</code> as its upstream.</p>
              </>
            ) : prompt === "Merge" ? (
              <div className="merge-branch-flow">
                <Dropdown
                  label="Source branch"
                  options={mergeBranches.map((branch) => ({ value: branch, label: branch }))}
                  value={value}
                  onChange={setValue}
                  autoFocus
                />
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
            ) : prompt === "Branch" || prompt === "Tag" || prompt === "Rename" ? (
              <>
                <label>
                  {renameBranch ? "New branch name" : tagCommit ? "Tag name" : "Branch name"}
                  <span className="repository-action-field">
                    <GitBranch size={15} aria-hidden="true" />
                    <input
                      autoFocus
                      value={value}
                      onChange={(event) => setValue(event.target.value)}
                      placeholder={tagCommit ? "v1.0.0" : "feature/my-branch"}
                      aria-describedby="branch-start-point"
                      required
                      spellCheck={false}
                      autoCapitalize="none"
                    />
                  </span>
                </label>
                <p id="branch-start-point" className="branch-start-point">
                  {renameBranch ? <>Current name <code>{renameBranch}</code></> : <>Starts from <code title={tagCommit ?? branchCommit ?? undefined}>{(tagCommit ?? branchCommit)?.slice(0, 12) ?? currentBranch}</code></>}
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
              <button type="button" onClick={closePrompt}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={busy || (prompt !== "Stash" && !value.trim()) || value.trim() === renameBranch}
              >
                {prompt === "Publish"
                  ? <><ArrowUpCircle size={14} aria-hidden="true" /> Publish branch</>
                  : prompt === "Origin"
                  ? originUrl == null
                    ? <><Plus size={14} aria-hidden="true" /> Add origin</>
                    : <><Save size={14} aria-hidden="true" /> Save changes</>
                  : prompt === "Rename"
                    ? <><Save size={14} aria-hidden="true" /> Rename branch</>
                  : prompt === "Tag"
                    ? <><Tag size={14} aria-hidden="true" /> Create tag</>
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
