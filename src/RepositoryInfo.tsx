import { ArrowDownCircle, ArrowRight, ArrowUpCircle, ChevronRight, CloudDownload, GitBranch, GitCommitHorizontal, GitMerge, Info, KeyRound, Layers3, Pause, Play, Settings2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  Credentials: {
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
  Stash: Layers3, Origin: Settings2, Credentials: KeyRound, "Force Push": ArrowUpCircle,
};

const groups: { label: string; actions: Example[] }[] = [
  { label: "Changes and branches", actions: ["Commit", "Branch", "Merge", "Stash"] },
  { label: "Remote sync", actions: ["Fetch", "Pull", "Push", "Rebase", "Force Push"] },
  { label: "Remote settings", actions: ["Origin", "Credentials"] },
];

function ExampleGraph({ example, played }: { example: Example; played: boolean }) {
  const { before, after } = examples[example];
  const [local, remote] = played ? after : before;
  const branchExample = example === "Branch" || example === "Merge";
  if ((typeof local !== "number" || typeof remote !== "number") && !branchExample) {
    return (
      <div className="info-action-flow">
        <span>{local}</span><ArrowRight size={16} aria-hidden="true" />
        <strong>{remote}</strong>
      </div>
    );
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
    hash, parents, author: hash, date: "", subject: `Commit ${hash}`, refs: "",
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
    <ol className="info-example-history" aria-label={`Commit graph after selecting ${example}`}>
      {commits.map((commit, index) => (
        <li key={commit.hash}>
          <CommitGraphRow row={graph.rows[index]} width={graph.width} author={commit.author}
            theme={theme} compact localOnly={commit.local_only} incoming={commit.incoming}
            isHead={commit.hash === localTip} pulling={example === "Pull" && !played} pushingHashes={step} />
          <strong>{commit.subject}</strong>
          {commit.hash === localTip && <span className="info-graph-ref">HEAD</span>}
          {commit.hash === remoteTip && <span className="info-graph-ref remote">origin/main</span>}
          {example === "Branch" && played && commit.hash === "B" && <span className="info-graph-ref">feature</span>}
          {example === "Merge" && commit.hash === "C" && <span className="info-graph-ref">feature</span>}
        </li>
      ))}
    </ol>
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
        <ChevronRight className="repo-info-chevron" size={13} aria-hidden="true" />
      </button>
      <dialog ref={dialog} className="repo-picker repository-action-picker repo-info-dialog"
        aria-labelledby="repo-info-title" onClose={() => setOpen(false)}>
        <header>
          <Info size={17} aria-hidden="true" />
          <h2 id="repo-info-title">Git action examples</h2>
          <button type="button" className="repo-picker-close" aria-label="Close examples"
            onClick={() => dialog.current?.close()}><X size={17} aria-hidden="true" /></button>
        </header>
        <div className="repo-picker-content repo-info-content">
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
          <section className="repo-info-detail" aria-label={example}>
            <h3>{example}</h3>
            <p>{examples[example].description}</p>
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
                    <ExampleGraph example={example} played={after} />
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </dialog>
    </div>
  );
}
