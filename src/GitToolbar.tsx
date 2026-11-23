import { invoke } from "@tauri-apps/api/core";
import { Dropdown } from "./Dropdown";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowDownCircle,
  ArrowUpCircle,
  Cloud,
  CloudDownload,
  ExternalLink,
  Eye,
  EyeOff,
  LockKeyhole,
  UserRound,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  Layers3,
  ShieldKeyhole,
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
  | { kind: "set_origin"; url: string }
  | { kind: "save_https_credential"; remote: string; username: string; token: string };

const operationGroups = [
  { name: "Commit", actions: [
    { label: "Commit", icon: GitCommitHorizontal },
  ] },
  { name: "Remote sync", actions: [
    { label: "Pull", icon: ArrowDownCircle },
    { label: "Push", icon: ArrowUpCircle },
    { label: "Fetch", icon: CloudDownload },
  ] },
  { name: "Branch and worktree", actions: [
    { label: "Branch", icon: GitBranch },
    { label: "Merge", icon: GitMerge },
    { label: "Stash", icon: Layers3 },
  ] },
  { name: "Remote settings", actions: [
    { label: "Origin", icon: Settings2 },
    { label: "Authentication", icon: ShieldKeyhole },
  ] },
] as const;

function TransferIcon({ action }: { action: "Push" | "Pull" | "Fetch" }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {action === "Fetch" ? <path d="M7 17a5 5 0 1 1 2-9.6A6 6 0 0 1 21 10a4 4 0 0 1-1 7.8" /> : <circle cx="12" cy="12" r="10" />}
    <g className="toolbar-transfer-arrow">
      {action === "Push" ? <><path d="M12 16V8" /><path d="m8 12 4-4 4 4" /></> : action === "Pull" ? <><path d="M12 8v8" /><path d="m8 12 4 4 4-4" /></> : <><path d="M12 12v9" /><path d="m8 17 4 4 4-4" /></>}
    </g>
  </svg>;
}

type Prompt = "Publish" | "Branch" | "Merge" | "Stash" | "Origin" | "Authentication";

export function GitToolbar({
  busy,
  refreshing,
  networkOperation,
  authorControl,
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
  onForcePush,
  onRebase,
  onRebasePreview,
}: {
  busy: boolean;
  refreshing: boolean;
  networkOperation?: "pull" | "push" | "fetch" | null;
  authorControl?: (onAuthentication: () => void) => ReactNode;
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
  onForcePush: () => void;
  onRebase: () => void;
  onRebasePreview: (active: boolean) => void;
}) {
  const [toolbarPrompt, setPrompt] = useState<Prompt | null>(null);
  const [value, setValue] = useState("");
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [tokenHelpError, setTokenHelpError] = useState("");
  const prompt = renameBranch ? "Rename" : tagCommit ? "Tag" : branchCommit ? "Branch" : toolbarPrompt;
  function closePrompt() {
    setValue("");
    setUsername("");
    setToken("");
    setShowToken(false);
    setTokenHelpError("");
    setPrompt(null);
    onPromptClose();
  }
  async function openTokenSetup(provider: "github" | "bitbucket") {
    setTokenHelpError("");
    try {
      await invoke("open_token_setup", { provider });
    } catch (error) {
      setTokenHelpError(String(error));
    }
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
        {operationGroups.map(({ name, actions }) => (
          <div className="git-toolbar-group" role="group" aria-label={name} key={name}>
            {actions.filter(({ label }) => label !== "Authentication" || !authorControl).map(({ label, icon: Icon }) => (
              <button
                key={label}
                data-action={label === "Pull" || label === "Push" || label === "Fetch" ? label.toLowerCase() : undefined}
                data-network-active={networkOperation === label.toLowerCase() || undefined}
                aria-busy={networkOperation === label.toLowerCase() || undefined}
                type="button"
                title={
                  label === "Pull" ? "Pull using fast-forward only"
                    : label === "Push" && !canPush ? "Check out a branch with a commit to push"
                    : label === "Push" && !hasUpstream ? (remotes.length ? "Publish branch" : "Add a remote to publish")
                    : label
                }
                aria-disabled={refreshing}
                disabled={
                  (busy && !refreshing) ||
                  (label === "Push" && !canPush) ||
                  (label === "Merge" && !mergeBranches.length) ||
                  (label === "Stash" && !changes) ||
                  (label === "Authentication" && !remotes.length)
                }
                onClick={() => {
                  if (busy) return;
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
                      break;
                    case "Authentication":
                      setValue(remotes.includes("origin") ? "origin" : remotes[0] ?? "");
                      setPrompt("Authentication");
                      break;
                  }
                }}
              >
                <span className="git-toolbar-icon">
                  {label === "Push" || label === "Pull" || label === "Fetch" ? <TransferIcon action={label} /> : <Icon size={20} aria-hidden="true" />}
                </span>
                {label === "Authentication" ? "Auth" : label}
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
            {name === "Remote settings" && authorControl?.(() => {
              setValue(remotes.includes("origin") ? "origin" : remotes[0] ?? "");
              setPrompt("Authentication");
            })}
            {name === "Remote sync" && canPush && hasUpstream && (ahead ?? 0) > 0 && (behind ?? 0) > 0 && (
              <button type="button" disabled={busy} onClick={onRebase} onMouseEnter={() => onRebasePreview(true)}
                onMouseLeave={() => onRebasePreview(false)} onFocus={() => onRebasePreview(true)}
                onBlur={() => onRebasePreview(false)} title="Rebase onto upstream">
                <GitMerge size={16} aria-hidden="true" /> Rebase…
              </button>
            )}
            {name === "Remote sync" && canPush && hasUpstream && (behind ?? 0) > 0 && (
              <button type="button" disabled={busy} onClick={onForcePush} title="Force Push with Lease">
                <ArrowUpCircle size={16} aria-hidden="true" /> Force Push…
              </button>
            )}
          </div>
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
            {prompt === "Authentication" && <ShieldKeyhole size={20} aria-hidden="true" />}
            {prompt === "Origin" && <Cloud size={20} aria-hidden="true" />}
            {prompt === "Tag" && <Tag size={20} aria-hidden="true" />}
            {(prompt === "Branch" || prompt === "Rename") && <GitBranch size={20} aria-hidden="true" />}
            {prompt === "Merge" && <GitMerge size={20} aria-hidden="true" />}
            {prompt === "Stash" && <Layers3 size={20} aria-hidden="true" />}
            <h2 id="git-action-title">
              {prompt === "Authentication" ? "Authentication" : prompt === "Publish" ? "Publish branch" : prompt === "Rename" ? "Rename branch" : prompt === "Tag" ? "Create tag" : prompt === "Branch"
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
              if (prompt === "Authentication") {
                if (!remotes.includes(value) || !username.trim() || !token.trim()) return;
                onAction({ kind: "save_https_credential", remote: value, username: username.trim(), token });
              }
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
            ) : prompt === "Authentication" ? (
              <div className="credential-form">
                <Dropdown label="Remote" options={remotes.map((remote) => ({ value: remote, label: remote }))}
                  value={value} onChange={setValue} />
                <label>
                  Username
                  <span className="repository-action-field">
                    <UserRound size={15} aria-hidden="true" />
                    <input autoFocus required value={username} onChange={(event) => setUsername(event.target.value)}
                      spellCheck={false} autoCapitalize="none" autoComplete="username"
                      placeholder="Username for this Git provider" />
                  </span>
                </label>
                <label htmlFor="credential-access-token">Access token</label>
                <div className="repository-action-field credential-token-field">
                  <ShieldKeyhole size={15} aria-hidden="true" />
                  <input id="credential-access-token" type={showToken ? "text" : "password"} required
                    value={token} onChange={(event) => setToken(event.target.value)}
                    autoComplete="off" spellCheck={false} autoCapitalize="none"
                    placeholder="Paste access token" aria-describedby="credential-storage-note" />
                  <button type="button" onClick={() => setShowToken((visible) => !visible)}
                    aria-label={showToken ? "Hide access token" : "Show access token"}
                    title={showToken ? "Hide access token" : "Show access token"}>
                    {showToken ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                  </button>
                </div>
                <p id="credential-storage-note" className="credential-storage-note">
                  <LockKeyhole size={13} aria-hidden="true" />
                  Saved in macOS Keychain for this remote’s HTTPS push URL.
                </p>
                <details className="credential-token-help">
                  <summary>Where do I get a token?</summary>
                  <div className="credential-provider">
                    <button type="button" onClick={() => void openTokenSetup("github")}>
                      <span className="credential-brand" data-provider="github" aria-hidden="true" />
                      GitHub <ExternalLink size={12} aria-hidden="true" />
                    </button>
                    <p>Create a fine-grained token for this repo with <strong>Contents: Read and write</strong>. Use your GitHub username.</p>
                  </div>
                  <div className="credential-provider">
                    <button type="button" onClick={() => void openTokenSetup("bitbucket")}>
                      <span className="credential-brand" data-provider="bitbucket" aria-hidden="true" />
                      Bitbucket Cloud <ExternalLink size={12} aria-hidden="true" />
                    </button>
                    <p>Create an API token with repository read and write scopes. Use <code>x-bitbucket-api-token-auth</code> as the username.</p>
                  </div>
                  {tokenHelpError && <p role="alert">{tokenHelpError}</p>}
                </details>
              </div>
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
                disabled={busy || (prompt !== "Stash" && !value.trim()) || value.trim() === renameBranch || (prompt === "Authentication" && (!username.trim() || !token.trim()))}
              >
                {prompt === "Authentication" ? <><Save size={14} aria-hidden="true" /> Save authentication</> : prompt === "Publish"
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
