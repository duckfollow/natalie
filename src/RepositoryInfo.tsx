import { ArrowDownCircle, Check, Cloud, FileCode2, FolderGit2, KeyRound, LockKeyhole, ArrowUpCircle, CloudDownload, GitBranch, GitCommitHorizontal, GitMerge, Info, ShieldKeyhole, Layers3, Pause, Play, Settings2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CommitGraphRow } from "./CommitGraphRow";
import { layoutHistory, type Commit } from "./history-graph";

const examples = {
  Commit: {
    description: "Save staged changes as a new commit on your local branch.",
    before: [1, 1],
    after: [2, 1],
  },
  Push: {
    description: "Send your local commits to the remote branch.",
    before: [3, 1],
    after: [3, 3],
  },
  Pull: {
    description: "Fast-forward your local branch to the remote tip when their histories have not diverged.",
    before: [1, 3],
    after: [3, 3],
  },
  Rebase: {
    description: "Replay your local commit on top of the upstream tip. The replayed commit gets a new ID.",
    before: [2, 3],
    after: [4, 3],
  },
  Fetch: {
    description: "Refresh remote-tracking references so Natalie can show incoming commits.",
    before: [1, 1],
    after: [1, 3],
  },
  Branch: {
    description: "Create a named branch at a commit so you can work on a separate line of history.",
    before: ["Current commit", "New branch"],
    after: ["Current commit", "Branch created"],
  },
  Merge: {
    description: "Combine the current branch with the selected branch and keep both histories.",
    before: ["Two branch tips", "Separate histories"],
    after: ["Both branch tips", "Merge commit"],
  },
  Stash: {
    description: "Temporarily set aside staged and unstaged changes, including untracked files.",
    before: ["Changed files", "Working tree"],
    after: ["Changed files", "Stash entry"],
  },
  Origin: {
    description: "Set the repository URL Git uses for the origin remote.",
    before: ["Local repository", "No origin"],
    after: ["Local repository", "Origin configured"],
  },
  Authentication: {
    description: "Save an HTTPS access token for a remote in macOS Keychain.",
    before: ["HTTPS remote", "Access token"],
    after: ["HTTPS remote", "macOS Keychain"],
  },
  "Force Push": {
    description: "Replace the upstream branch history only if its tip still matches the commit you reviewed.",
    before: [2, 3],
    after: [2, 2],
  },
} as const;

type Example = keyof typeof examples;

const actionIcons = {
  Commit: GitCommitHorizontal, Push: ArrowUpCircle, Pull: ArrowDownCircle,
  Rebase: GitMerge, Fetch: CloudDownload, Branch: GitBranch, Merge: GitMerge,
  Stash: Layers3, Origin: Settings2, Authentication: ShieldKeyhole, "Force Push": ArrowUpCircle,
};

const groups: { label: string; actions: Example[] }[] = [
  { label: "Changes and branches", actions: ["Commit", "Branch", "Merge", "Stash"] },
  { label: "Remote sync", actions: ["Fetch", "Pull", "Push", "Rebase", "Force Push"] },
  { label: "Remote settings", actions: ["Origin", "Authentication"] },
];

const outcomes: Record<Example, [string, string]> = {
  Commit: ["Staged changes ready", "New local commit created"],
  Push: ["2 commits ahead", "Remote branch is up to date"],
  Pull: ["2 incoming commits", "Local branch is up to date"],
  Fetch: ["Remote references need updating", "2 incoming commits discovered"],
  Branch: ["Working on main", "feature points to the same commit"],
  Merge: ["Two separate branch tips", "Both histories joined"],
  Rebase: ["Local and remote have diverged", "Local commit replayed on origin/main"],
  Stash: ["3 uncommitted files", "Clean working tree · 1 saved stash"],
  Origin: ["No remote configured", "Origin URL saved · Ready to fetch"],
  Authentication: ["Token not saved", "Token saved in macOS Keychain"],
  "Force Push": ["Reviewed remote tip required", "Remote history replaced if lease matches"],
};

function ActionIllustration({ example, played }: { example: "Stash" | "Origin" | "Authentication"; played: boolean }) {
  const stash = example === "Stash";
  const auth = example === "Authentication";
  const Source = auth ? KeyRound : FolderGit2;
  const Target = stash ? Layers3 : auth ? LockKeyhole : Cloud;
  return <div className="info-scenario" data-complete={played}>
    <div className="info-scenario-node">
      <span className="info-scenario-icon"><Source size={23} aria-hidden="true" /></span>
      <strong>{auth ? "Access token" : "Working tree"}</strong>
      <span className="info-scenario-caption">{auth ? "HTTPS authentication" : stash ? "Your local changes" : "Local repository"}</span>
      <div className="info-scenario-payload">
        {stash ? <>{["scene.tscn", "player.gd", "README.md"].map(file => <div className="info-scenario-file" key={file}><FileCode2 size={12} /><span>{file}</span><small>{played ? "—" : "M"}</small></div>)}</> : auth ? <><code>•••• •••• •••• ••••</code><small>Illustrative token</small></> : <><FolderGit2 size={15} /><code>my-project/.git</code></>}
      </div>
      <span className="info-scenario-state">{stash ? played ? "Clean working tree" : "3 changed files" : auth ? "Kept on this Mac" : "Commit history stays local"}</span>
    </div>
    <div className="info-scenario-connection" aria-hidden="true"><span>{stash ? "Save" : auth ? "Store" : "Connect"}</span><svg viewBox="0 0 80 24"><path className="info-scenario-track" d="M2 12H72" /><path className="info-scenario-stream" d="M2 12H72" /><path className="info-scenario-arrow" d="m66 7 6 5-6 5" /></svg></div>
    <div className="info-scenario-node info-scenario-destination">
      <span className="info-scenario-icon"><Target size={23} aria-hidden="true" /></span>
      <strong>{stash ? "Stash shelf" : auth ? "macOS Keychain" : "Origin remote"}</strong>
      <span className="info-scenario-caption">{stash ? "Temporary local storage" : auth ? "System credential storage" : "Repository connection"}</span>
      <div className="info-scenario-payload">{played ? <>{stash ? <><Layers3 size={15} /><code>stash@{'{0}'}</code><small>WIP · 3 saved files</small></> : auth ? <><ShieldKeyhole size={18} /><span>Token saved</span><small>Used for HTTPS requests</small></> : <><Cloud size={15} /><code>github.com/team/project.git</code><small>origin</small></>}</> : <span className="info-scenario-empty">{stash ? "No saved changes" : auth ? "No token stored" : "No URL configured"}</span>}</div>
      <span className="info-scenario-state">{played ? <><Check size={12} />{stash ? "Saved locally" : auth ? "Stored securely" : "Ready to fetch"}</> : "Awaiting setup"}</span>
    </div>
  </div>;
}

type GraphExample = Exclude<Example, "Stash" | "Origin" | "Authentication">;
const graphScenarios: Record<GraphExample, { source: string; target: string; before: [string, string]; after: [string, string]; action: string; note: string }> = {
  Commit: { source: "Staging area", target: "Local branch", before: ["2 staged files", "main · Commit A"], after: ["Staging area cleared", "main · New commit B"], action: "Create commit", note: "A commit saves staged changes locally. Push publishes it later." },
  Branch: { source: "Current branch", target: "New branch", before: ["main · Commit B", "feature does not exist"], after: ["main · Commit B", "feature · Commit B"], action: "Create reference", note: "A branch is a named reference. Creating one does not duplicate your files or commits." },
  Merge: { source: "Current branch", target: "Selected branch", before: ["main · Commit B", "feature · Commit C"], after: ["main · Merge commit M", "feature · Commit C"], action: "Join histories", note: "The merge commit has two parents. Conflicting edits may need to be resolved." },
  Fetch: { source: "Remote server", target: "Tracking reference", before: ["Server has B and C", "origin/main · Commit A"], after: ["Server unchanged", "origin/main · Commit C"], action: "Update references", note: "Fetch discovers remote commits. Your local branch and working files stay unchanged." },
  Pull: { source: "Remote branch", target: "Local branch", before: ["origin/main · Commit C", "main · Commit A"], after: ["origin/main · Commit C", "main · Commit C"], action: "Fast-forward", note: "Fast-forward moves main to the remote tip. Diverged branches need merge or rebase." },
  Push: { source: "Local branch", target: "Remote branch", before: ["main · Commit C", "origin/main · Commit A"], after: ["main · Commit C", "origin/main · Commit C"], action: "Publish commits", note: "Push sends committed history. Uncommitted files remain on your computer." },
  Rebase: { source: "Local commit", target: "New base", before: ["L based on A", "origin/main · Commit C"], after: ["L′ based on C", "origin/main · Commit C"], action: "Replay commit", note: "Rebase creates a new commit ID. Resolve any conflicts before continuing." },
  "Force Push": { source: "Local history", target: "Remote history", before: ["main · Commit B", "origin/main · Commit C"], after: ["main · Commit B", "origin/main · Commit B"], action: "Verify lease & replace", note: "Commit C leaves this remote branch. The push is rejected if the reviewed remote tip changed." },
};

function GraphScenarioSummary({ example, played }: { example: GraphExample; played: boolean }) {
  const scenario = graphScenarios[example];
  const Icon = actionIcons[example];
  const values = played ? scenario.after : scenario.before;
  return <>
    <div className="info-graph-scenario" data-complete={played}>
      {[scenario.source, scenario.target].map((label, index) => <div className="info-graph-context" key={label}><span className="info-graph-context-label">{index === 0 ? <FolderGit2 size={13} /> : <Icon size={13} />}{label}</span><strong>{values[index]}</strong></div>)}
    </div>
    <div className="info-graph-operation"><span className="info-graph-operation-icon"><Icon size={13} /></span><span>{scenario.action}</span><span className="info-graph-operation-line" aria-hidden="true" /><small>{played ? "After" : "Before"}</small></div>
    {example === "Commit" && <div className="info-staged-files"><FileCode2 size={12} /><span>player.gd</span><span>scene.tscn</span><small>{played ? "Saved in commit B" : "Ready to commit"}</small></div>}
  </>;
}

function ExampleGraph({ example, played }: { example: Example; played: boolean }) {
  const { before, after } = examples[example];
  const [local, remote] = played ? after : before;
  const branchExample = example === "Branch" || example === "Merge";
  if (example === "Stash" || example === "Origin" || example === "Authentication") {
    return <ActionIllustration example={example} played={played} />;
  }

  let localTip: string;
  let remoteTip: string;
  let history: [string, string[]][];
  if (branchExample) {
    localTip = example === "Merge" && played ? "M" : "B";
    remoteTip = "";
    history = [["B", ["A"]], ["A", []]];
    if (example === "Merge") {
      history.splice(1, 0, ["C", ["A"]]);
      if (played) history.unshift(["M", ["B", "C"]]);
    }
  } else if (example === "Rebase") {
    localTip = played ? "L′" : "L";
    remoteTip = "C";
    history = [[localTip, [played ? "C" : "A"]], ["C", ["B"]], ["B", ["A"]], ["A", []]];
  } else {
    localTip = String.fromCharCode(64 + Number(local));
    remoteTip = String.fromCharCode(64 + Number(remote));
    history = Array.from({ length: Math.max(Number(local), Number(remote)) }, (_, index) =>
      [String.fromCharCode(65 + index), index ? [String.fromCharCode(64 + index)] : []]).reverse() as [string, string[]][];
  }

  function ancestry(tip: string) {
    const reachable = new Set([tip]);
    for (const [hash, parents] of history) {
      if (reachable.has(hash)) parents.forEach((parent) => reachable.add(parent));
    }
    return reachable;
  }
  const localCommits = ancestry(localTip);
  const remoteCommits = ancestry(remoteTip);
  const commits: Commit[] = history.map(([hash, parents]) => ({
    hash, parents, author: hash, date: "", subject: ({ A: "Initialize project", B: "Add player movement", C: "Update game scene", L: "Add local changes", "L′": "Add local changes", M: "Merge feature" } as Record<string, string>)[hash] ?? `Commit ${hash}`, refs: "",
    local_only: !branchExample && !remoteCommits.has(hash),
    incoming: !branchExample && !localCommits.has(hash),
    incoming_for_pull: example === "Pull" && !localCommits.has(hash),
    incoming_branches: [],
  }));
  const graph = layoutHistory(commits);
  const step = (example === "Push" || example === "Rebase") && !played
    ? new Set(commits.filter((commit) => commit.local_only).map(({ hash }) => hash))
    : undefined;
  const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  return (
    <div className="info-graph-demo">
    <GraphScenarioSummary example={example} played={played} />
    <ol className="info-example-history" aria-label={`${played ? "After" : "Before"} ${example} commit graph`}>
      {commits.map((commit, index) => (
        <li key={commit.hash}>
          <CommitGraphRow row={graph.rows[index]} width={graph.width} author={commit.author}
            theme={theme} compact localOnly={commit.local_only} incoming={commit.incoming}
            isHead={commit.hash === localTip} pulling={example === "Pull" && !played} pushingHashes={step} />
          <span className="info-commit-label"><strong>{example === "Merge" && commit.hash === "M" ? "Merge feature into main" : example === "Rebase" && commit.hash === "L′" ? "Local commit (replayed)" : commit.subject}</strong><small>{commit.hash === localTip ? "Current branch" : commit.hash === remoteTip ? "Remote branch" : commit.local_only ? "Local commit" : commit.incoming ? "Incoming commit" : "Shared history"}</small></span>
          {commit.hash === localTip && <span className="info-graph-ref">HEAD</span>}
          {commit.hash === remoteTip && <span className="info-graph-ref remote">origin/main</span>}
          {example === "Branch" && played && commit.hash === "B" && <span className="info-graph-ref">feature</span>}
          {example === "Merge" && commit.hash === "C" && <span className="info-graph-ref">feature</span>}
        </li>
      ))}
    </ol>
    <p className="info-graph-note">{graphScenarios[example].note}</p>
    </div>
  );
}

export function RepositoryInfo() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [example, setExample] = useState<Example>("Commit");
  const [played, setPlayed] = useState(false);
  const [open, setOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = (event: MediaQueryListEvent) => setReduced(event.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!open || paused || reduced) return;
    const timer = window.setInterval(() => setPlayed((current) => !current), 2200);
    return () => window.clearInterval(timer);
  }, [open, paused, reduced, example]);
  return (
    <div className="repo-info">
      <button type="button" className="repo-info-trigger" aria-label="Git action examples" title="Git action examples"
        aria-haspopup="dialog" onClick={() => { setPlayed(false); setPaused(false); setOpen(true); dialog.current?.showModal(); }}>
        <Info size={16} aria-hidden="true" />
        <span>Git examples</span>
      </button>
      {createPortal(<dialog ref={dialog} className="repo-picker repo-settings-dialog repo-info-dialog"
        aria-labelledby="repo-info-title" onClose={() => setOpen(false)}>
        <header>
          <Info size={17} aria-hidden="true" />
          <div className="repo-settings-heading"><h2 id="repo-info-title">Git action examples</h2><span>Explore Git with animated previews</span></div>
          <button type="button" className="repo-picker-close" aria-label="Close examples"
            onClick={() => dialog.current?.close()}><X size={17} aria-hidden="true" /></button>
        </header>
        <div className="repo-settings-layout repo-info-content">
          <nav className="repo-info-actions" aria-label="Git actions">
            {groups.map(({ label, actions }) => (
              <div className="repo-info-group" role="group" aria-label={label} key={label}>
                <strong>{label}</strong>
                {actions.map((action) => {
                  const Icon = actionIcons[action];
                  return (
                    <button type="button" key={action} aria-pressed={example === action}
                      onClick={() => { setExample(action); setPlayed(false); }}>
                      <Icon size={15} aria-hidden="true" /> {action}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          <section className="repo-settings-content repo-info-detail" aria-label={example}>
            <div className="repo-settings-section-heading"><h3>{example}</h3>
            <p>{examples[example].description}</p></div>
            <div className="repo-info-example" data-paused={paused || reduced}>
              <div className="repo-info-controls">
                <div className="repo-info-stages" role="group" aria-label="Example stage">
                  {[false, true].map((after) => (
                    <button type="button" key={String(after)} aria-pressed={played === after}
                      onClick={() => { setPaused(true); setPlayed(after); }}>
                      {after ? "After" : "Before"}
                    </button>
                  ))}
                </div>
                {!reduced && (
                  <button type="button" className="repo-info-play" onClick={() => setPaused((current) => !current)}>
                    {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
                    {paused ? "Resume" : "Pause"}
                  </button>
                )}
              </div>
              <div className="repo-info-frames" key={example}>
                {[false, true].map((after) => (
                  <div className="repo-info-frame" key={String(after)}
                    data-current={played === after} aria-hidden={played !== after}>
                    <div className="info-example-status" data-after={after}><span className="info-example-status-dot" /><span>{outcomes[example][after ? 1 : 0]}</span></div>
                    <ExampleGraph example={example} played={after} />
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      <footer className="repo-settings-footer"><span>Illustrative previews · Your repository is unchanged</span><span>{reduced ? "Reduced motion enabled" : paused ? "Animation paused" : "Animation loops automatically"}</span></footer>
      </dialog>, document.body)}
    </div>
  );
}
