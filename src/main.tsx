import {
  CircleAlert,
  ChevronRight,
  CircleCheck,
  FileDiff,
  Download,
  FolderGit2,
  FileText,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequestArrow,
  History,
  Layers3,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
  Undo2,
  Sun,
  Moon,
  Monitor,
  PanelLeft,
  List,
  PanelTop,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { open, confirm } from "@tauri-apps/plugin-dialog";
import { layoutHistory, type Commit } from "./history-graph";
import { splitDiff } from "./diff-model";
import {
  RepositorySidebar,
  type Reference,
  type WorkspaceView,
} from "./RepositorySidebar";
import { RepositoryPicker } from "./RepositoryPicker";
import { CherryPickDialog } from "./CherryPickDialog";
import { GitToolbar } from "./GitToolbar";
import "./style.css";

type Change = { path: string; index: string; worktree: string };
type Snapshot = {
  root: string;
  branch: string;
  changes: Change[];
  commits: Commit[];
  branches: Reference[];
  tags: Reference[];
  remotes: string[];
  stashes: Reference[];
  submodules: string[];
  cherry_picking: boolean;
  ahead: number | null;
  behind: number | null;
};
type Selection =
  | { kind: "diff"; path: string; staged: boolean; untracked: boolean }
  | { kind: "show"; hash: string };

function repository<T>(root: string | null, action: object) {
  return invoke<T>("repository", { root, action });
}

const laneColors = [
  "#43c9df",
  "#629fff",
  "#ba82f2",
  "#ee70bd",
  "#ff887a",
  "#f4c65e",
  "#94cc73",
];
const lightLaneColors = [
  "#137084",
  "#315fb7",
  "#7549a7",
  "#a83b79",
  "#a13c34",
  "#775719",
  "#3e702c",
];
const laneStep = 18;
const halfRow = 38;
const laneX = (lane: number) => 13 + lane * laneStep;

function CommitGraphRow({
  row,
  width,
  author,
  theme,
}: {
  row: ReturnType<typeof layoutHistory>["rows"][number];
  width: number;
  author: string;
  theme: "light" | "dark";
}) {
  const colors = theme === "light" ? lightLaneColors : laneColors;
  const canvas = useRef<HTMLCanvasElement>(null);
  const graphWidth = laneX(width - 1) + 13;
  const initials = author
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toLocaleUpperCase();

  useLayoutEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const scale = window.devicePixelRatio || 1;
    element.width = Math.ceil(graphWidth * scale);
    element.height = Math.ceil(halfRow * 2 * scale);
    context.scale(scale, scale);
    context.lineJoin = "round";
    for (const edge of row.edges) {
      const from = laneX(edge.from);
      const to = laneX(edge.to);
      const start = edge.part === "top" ? 0 : halfRow;
      const end = start + halfRow;
      context.lineWidth = edge.merge ? 2.6 : 1.6;
      context.strokeStyle = colors[edge.color % colors.length];
      context.beginPath();
      context.moveTo(from, start);
      if (from !== to) {
        const bend = start + halfRow / 2;
        const step = Math.sign(to - from);
        const radius = 6;
        context.lineTo(from, bend - radius);
        context.quadraticCurveTo(from, bend, from + radius * step, bend);
        context.lineTo(to - radius * step, bend);
        context.quadraticCurveTo(to, bend, to, bend + radius);
      }
      context.lineTo(to, end);
      context.stroke();
    }
  }, [colors, graphWidth, row]);

  return (
    <span
      className="commit-graph"
      aria-hidden="true"
      style={{ width: graphWidth, height: halfRow * 2 }}
    >
      <canvas ref={canvas} />
      <span
        className={`commit-dot${row.isMerge ? " commit-dot-merge" : ""}`}
        style={{
          left: laneX(row.index),
          background: colors[row.color % colors.length],
        }}
      >
        {row.isMerge ? <GitMerge size={12} strokeWidth={2.5} /> : initials}
      </span>
    </span>
  );
}

function DiffLines({ lines }: { lines: string[] }) {
  return (
    <pre className="diff">
      {lines.map((line, index) => (
        <span
          key={index}
          className={
            line.startsWith("+++") || line.startsWith("---")
              ? "meta"
              : line.startsWith("+")
                ? "added"
                : line.startsWith("-")
                  ? "removed"
                  : line.startsWith("@@")
                    ? "hunk"
                    : ""
          }
        >
          {line || " "}
        </span>
      ))}
    </pre>
  );
}

function DiffFiles({ text, commit }: { text: string; commit?: Commit }) {
  const { intro, files } = useMemo(() => splitDiff(text), [text]);
  const sections = useRef<Array<HTMLDetailsElement | null>>([]);
  if (!files.length && !commit) return <DiffLines lines={intro} />;
  return (
    <div className="diff-files">
      {files.length > 1 && (
        <div className="diff-file-toolbar">
          <span>{files.length} changed files</span>
          <select
            aria-label="Jump to changed file"
            value=""
            onChange={(event) => {
              if (!event.target.value) return;
              const section = sections.current[Number(event.target.value)];
              if (section) {
                section.open = true;
                section.scrollIntoView({ block: "start" });
                section
                  .querySelector("summary")
                  ?.focus({ preventScroll: true });
              }
            }}
          >
            <option value="" disabled>
              Jump to file…
            </option>
            {files.map(({ path }, index) => (
              <option key={index} value={index}>
                {path}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="diff-file-scroll">
        {commit ? (
          <div className="diff-commit-card">
            <h2>{commit.subject || "Untitled commit"}</h2>
            <div className="diff-commit-meta">
              <span>{commit.author}</span>
              <time dateTime={commit.date}>{commit.date.slice(0, 10)}</time>
              <code title={commit.hash}>{commit.hash.slice(0, 12)}</code>
            </div>
            {intro.some((line) => line.trim()) && (
              <details className="diff-commit-raw">
                <summary>Commit details</summary>
                <DiffLines lines={intro} />
              </details>
            )}
            {!files.length && <p>No file diff in this view.</p>}
          </div>
        ) : (
          intro.some((line) => line.trim()) && <DiffLines lines={intro} />
        )}
        {files.map(({ path, lines, additions, deletions }, index) => (
          <details
            className="diff-file"
            open={index === 0}
            key={index}
            ref={(element) => {
              sections.current[index] = element;
            }}
          >
            <summary>
              <ChevronRight size={14} aria-hidden="true" />
              <FileText size={15} aria-hidden="true" />
              <strong title={path}>{path}</strong>
              <span
                className="diff-added"
                aria-label={`${additions} additions`}
              >
                +{additions}
              </span>
              <span
                className="diff-removed"
                aria-label={`${deletions} deletions`}
              >
                −{deletions}
              </span>
            </summary>
            <DiffLines lines={lines} />
          </details>
        ))}
      </div>
    </div>
  );
}

const recentKey = "natalie.recentRepositories";

function readRecentRepositories(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(recentKey) ?? "[]");
    return Array.isArray(value)
      ? value
          .filter((path): path is string => typeof path === "string")
          .slice(0, 20)
      : [];
  } catch {
    return [];
  }
}

type Theme = "light" | "dark";
type Appearance = Theme | "system";
const appearanceKey = "natalie.appearance";

function readAppearance(): Appearance {
  try {
    const value = localStorage.getItem(appearanceKey);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function App() {
  const [appearance, setAppearance] = useState(readAppearance);
  const [systemTheme, setSystemTheme] = useState<Theme>(() =>
    matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );
  const theme = appearance === "system" ? systemTheme : appearance;
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(appearanceKey, appearance);
    } catch {
      // The choice still applies for this session.
    }
  }, [appearance, theme]);
  const [recent, setRecent] = useState(readRecentRepositories);
  const [picker, setPicker] = useState<"repositories" | "clone" | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(recentKey, JSON.stringify(recent));
    } catch {
      // The current session can still use its repository list.
    }
  }, [recent]);
  const [repo, setRepo] = useState<Snapshot | null>(null);
  const [panels, setPanels] = useState({
    navigation: true,
    list: true,
    toolbar: true,
  });
  const [view, setView] = useState<WorkspaceView>("changes");
  const [search, setSearch] = useState("");
  const [cherryPick, setCherryPick] = useState<Commit | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [diff, setDiff] = useState("");
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const staged =
    repo?.changes.filter((item) => item.index !== " " && item.index !== "?") ??
    [];
  const unstaged = repo?.changes.filter((item) => item.worktree !== " ") ?? [];
  const root = repo?.root ?? null;
  const selectedCommit =
    selection?.kind === "show"
      ? repo?.commits.find(({ hash }) => hash === selection.hash)
      : undefined;
  const graph = useMemo(
    () => layoutHistory(repo?.commits ?? []),
    [repo?.commits],
  );

  useEffect(() => {
    setDiff("");
    setLoadingDiff(Boolean(root && selection));
    if (!root || !selection) return;
    let current = true;
    repository<string>(root, selection)
      .then(
        (result) => {
          if (current) setDiff(result);
        },
        (failure) => {
          if (current) setDiff(String(failure));
        },
      )
      .finally(() => {
        if (current) setLoadingDiff(false);
      });
    return () => {
      current = false;
    };
  }, [root, selection, repo]);

  async function update(
    action: () => Promise<Snapshot | null>,
    after?: (next: Snapshot) => void,
  ) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await action();
      if (!next) return;
      setRepo(next);
      setRecent((paths) =>
        [next.root, ...paths.filter((path) => path !== next.root)].slice(0, 20),
      );
      after?.(next);
    } catch (failure) {
      setError(String(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function runGitAction(
    action: object,
    message: string,
    showChangesOnFailure = false,
  ) {
    void update(
      async () => {
        try {
          return await repository<Snapshot>(root, action);
        } catch (failure) {
          try {
            const next = await repository<Snapshot>(null, {
              kind: "open",
              folder: root,
            });
            setRepo(next);
            if (showChangesOnFailure && next.cherry_picking) {
              setView("changes");
              setSelection(null);
            }
          } catch {
            // Preserve the original Git error.
          }
          throw failure;
        }
      },
      () => {
        setSelection(null);
        setNotice(message);
      },
    );
  }

  function enterRepository() {
    setSelection(null);
    setView("changes");
    setSearch("");
    setMessage("");
    setPicker(null);
  }

  function showPicker(view: "repositories" | "clone") {
    setError("");
    setPicker(view);
  }

  function chooseRepository() {
    void update(async () => {
      const folder = await open({ directory: true, multiple: false });
      return folder
        ? repository<Snapshot>(null, { kind: "open", folder })
        : null;
    }, enterRepository);
  }

  function changeGroup(title: string, items: Change[], inIndex: boolean) {
    return (
      <section className="change-group" aria-label={title}>
        <h2>
          {inIndex ? <Layers3 size={14} /> : <FileDiff size={14} />}
          {title} <span>{items.length}</span>
        </h2>
        {!items.length && (
          <p className="group-empty">No {title.toLowerCase()} files</p>
        )}
        {items.map((item) => {
          const selected =
            selection?.kind === "diff" &&
            selection.path === item.path &&
            selection.staged === inIndex;
          const code = inIndex ? item.index : item.worktree;
          return (
            <div
              className={`file-row${selected ? " selected" : ""}`}
              key={item.path}
            >
              <button
                className="file-name"
                title={item.path}
                onClick={() =>
                  setSelection({
                    kind: "diff",
                    path: item.path,
                    staged: inIndex,
                    untracked: code === "?",
                  })
                }
              >
                <FileText size={14} aria-hidden="true" />
                <span className="file-path">{item.path}</span>
                <span
                  className={`status status-${code === "?" ? "new" : code}`}
                >
                  {code === "?" ? "A" : code}
                </span>
              </button>
              <button
                className="file-action discard-action"
                disabled={busy || repo?.submodules.includes(item.path)}
                aria-label={`Discard changes in ${item.path}`}
                title="Discard all changes in this file"
                onClick={() => {
                  void update(async () => {
                    const approved = await confirm(
                      `Discard all staged and unstaged changes in "${item.path}"? New files will be deleted. This cannot be undone.`,
                      { title: "Discard file changes", kind: "warning", okLabel: "Discard", cancelLabel: "Cancel" },
                    );
                    return approved
                      ? repository<Snapshot>(root, { kind: "discard", path: item.path })
                      : null;
                  }, () => {
                    setSelection(null);
                    setNotice("File changes discarded.");
                  });
                }}
              >
                <Undo2 size={14} aria-hidden="true" />
              </button>
              <button
                className="file-action"
                disabled={busy}
                aria-label={`${inIndex ? "Unstage" : "Stage"} ${item.path}`}
                title={inIndex ? "Unstage" : "Stage"}
                onClick={() => {
                  void update(
                    () =>
                      repository<Snapshot>(root, {
                        kind: inIndex ? "unstage" : "stage",
                        path: item.path,
                      }),
                    (next) => {
                      const change = next.changes.find(
                        ({ path }) => path === item.path,
                      );
                      const remainsStaged =
                        change && change.index !== " " && change.index !== "?";
                      const remainsUnstaged = change && change.worktree !== " ";
                      setSelection(
                        change && (remainsStaged || remainsUnstaged)
                          ? {
                              kind: "diff",
                              path: change.path,
                              staged: inIndex
                                ? !remainsUnstaged
                                : Boolean(remainsStaged),
                              untracked: change.worktree === "?",
                            }
                          : null,
                      );
                    },
                  );
                }}
              >
                {inIndex ? <Minus size={14} /> : <Plus size={14} />}
              </button>
            </div>
          );
        })}
      </section>
    );
  }

  return (
    <main>
      <header className="app-header">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            N
          </span>
          <strong>Natalie</strong>
        </div>
        {repo && (
          <div className="repo-context" title={repo.root}>
            <strong>{repo.root.split("/").at(-1)}</strong>
            <span className="branch-pill">
              <GitBranch size={13} aria-hidden="true" />{" "}
              <span>{repo.branch}</span>
            </span>
          </div>
        )}
        <div className="header-actions">
          <div
            className="appearance-control"
            role="group"
            aria-label="Appearance"
          >
            {(
              [
                ["system", "System", Monitor],
                ["light", "Light", Sun],
                ["dark", "Dark", Moon],
              ] as const
            ).map(([mode, label, Icon]) => (
              <button
                key={mode}
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={appearance === mode}
                onClick={() => setAppearance(mode)}
              >
                <Icon size={15} aria-hidden="true" />
              </button>
            ))}
          </div>
          <button disabled={busy} onClick={() => showPicker("repositories")}>
            <FolderGit2 size={15} aria-hidden="true" /> Repositories
          </button>
          <button disabled={busy} onClick={() => showPicker("clone")}>
            <Download size={15} aria-hidden="true" /> Clone
          </button>
          {root && (
            <button
              disabled={busy}
              onClick={() =>
                void update(() =>
                  repository<Snapshot>(null, { kind: "open", folder: root }),
                )
              }
            >
              <RefreshCw size={14} aria-hidden="true" /> Refresh
            </button>
          )}
          <button
            className="primary"
            onClick={chooseRepository}
            disabled={busy}
          >
            <FolderOpen size={15} aria-hidden="true" /> Open repository
          </button>
        </div>
      </header>
      {repo && (
        <div className="workspace-strip">
          <div id="workspace-git-actions" hidden={!panels.toolbar}>
            <GitToolbar
              busy={busy}
              branches={repo.branches.map(({ name }) => name)}
              currentBranch={repo.branch}
              ahead={repo.ahead}
              behind={repo.behind}
              changes={repo.changes.length}
              onCommit={() => {
                setView("changes");
                setPanels((current) => ({ ...current, list: true }));
                setSelection(null);
                requestAnimationFrame(() =>
                  document.getElementById("commit-message")?.focus(),
                );
              }}
              onAction={(action) =>
                runGitAction(
                  action,
                  {
                    fetch: "Fetch completed.",
                    pull: "Pull completed.",
                    push: "Push completed.",
                    branch: "Branch created.",
                    merge: "Merge completed.",
                    stash: "Changes stashed.",
                  }[action.kind],
                )
              }
            />
          </div>
          <div
            className="workspace-layout"
            role="group"
            aria-label="Workspace layout"
          >
            {(
              [
                [
                  "navigation",
                  "Navigation",
                  PanelLeft,
                  "repository-navigation",
                ],
                ["list", "File and commit list", List, "workspace-list"],
                ["toolbar", "Git actions", PanelTop, "workspace-git-actions"],
              ] as const
            ).map(([key, label, Icon, target]) => (
              <button
                key={key}
                type="button"
                title={`${panels[key] ? "Hide" : "Show"} ${label}`}
                aria-label={label}
                aria-controls={target}
                aria-expanded={panels[key]}
                onClick={() =>
                  setPanels((current) => ({ ...current, [key]: !current[key] }))
                }
              >
                <Icon size={15} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      )}
      {error && !picker && (
        <div className="banner error" role="alert">
          <CircleAlert size={15} aria-hidden="true" /> <span>{error}</span>
        </div>
      )}
      {repo?.cherry_picking && (
        <div className="banner cherry-pick-status">
          <GitPullRequestArrow size={15} aria-hidden="true" />
          <span>
            Cherry-pick paused. Resolve and stage conflicts, then continue.
          </span>
          <button
            disabled={busy}
            onClick={() =>
              runGitAction(
                { kind: "continue_cherry_pick" },
                "Cherry-pick completed.",
                true,
              )
            }
          >
            Continue
          </button>
          <button
            disabled={busy}
            onClick={() =>
              runGitAction(
                { kind: "abort_cherry_pick" },
                "Cherry-pick aborted.",
              )
            }
          >
            Abort
          </button>
        </div>
      )}
      {notice && (
        <div className="banner" role="status">
          <CircleCheck size={15} aria-hidden="true" /> <span>{notice}</span>
        </div>
      )}
      {!repo ? (
        <section className="welcome">
          <span className="mark large" aria-hidden="true">
            <GitBranch size={30} strokeWidth={1.7} />
          </span>
          <h1>Open a Git repository</h1>
          <p>
            Review changes, prepare a commit, and browse your repository’s
            history.
          </p>
          <button
            className="primary"
            onClick={chooseRepository}
            disabled={busy}
          >
            <FolderOpen size={16} aria-hidden="true" />
            {busy ? "Opening…" : "Choose folder"}
          </button>
        </section>
      ) : (
        <div
          className="workspace"
          data-navigation={panels.navigation ? "open" : "closed"}
          data-list={panels.list ? "open" : "closed"}
        >
          <RepositorySidebar
            {...repo}
            hidden={!panels.navigation}
            view={view}
            onView={(next) => {
              setView(next);
              setPanels((current) => ({ ...current, list: true }));
              setSelection(null);
            }}
            onCommit={(hash) => {
              setView("history");
              setSelection({ kind: "show", hash });
            }}
          />
          <aside
            className="workspace-list"
            id="workspace-list"
            hidden={!panels.list}
            aria-label={view === "changes" ? "Changed files" : "Commits"}
          >
            <h2 className="workspace-list-title">
              {view === "changes"
                ? "File status"
                : view === "history"
                  ? "Commit history"
                  : "Search commits"}
              {view !== "changes" && (
                <span className="history-count" title="Loaded commits">{repo.commits.length}</span>
              )}
            </h2>
            {view === "history" && (
              <div className="history-context" title={repo.branch}>
                <GitBranch size={13} aria-hidden="true" />
                <span>{repo.branch}</span>
                <small>Latest {repo.commits.length} commits</small>
              </div>
            )}
            {view === "search" && (
              <input
                className="commit-search"
                autoFocus
                aria-label="Search commits"
                placeholder="Message, author or hash…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            )}
            {view === "changes" ? (
              <>
                <div className="sidebar-scroll">
                  {changeGroup("Unstaged", unstaged, false)}
                  {changeGroup("Staged", staged, true)}
                </div>
                <form
                  className="commit-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!staged.length || !message.trim()) return;
                    void update(
                      () =>
                        repository<Snapshot>(root, { kind: "commit", message }),
                      () => {
                        setMessage("");
                        setSelection(null);
                        setNotice("Commit created.");
                      },
                    );
                  }}
                >
                  <label htmlFor="commit-message">
                    <GitCommitHorizontal size={16} aria-hidden="true" /> Commit
                    message
                  </label>
                  <textarea
                    id="commit-message"
                    placeholder="Describe your changes"
                    rows={3}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                  />
                  <button
                    className="primary"
                    disabled={busy || !staged.length || !message.trim()}
                  >
                    <GitCommitHorizontal size={15} aria-hidden="true" />
                    {staged.length
                      ? `Commit ${staged.length} staged ${staged.length === 1 ? "file" : "files"}`
                      : "Commit"}
                  </button>
                </form>
              </>
            ) : (
              <div className={`sidebar-scroll history${view === "search" ? " history-search" : ""}`} tabIndex={0} aria-label="Commit history list">
                {!repo.commits.length && (
                  <p className="group-empty">No commits yet</p>
                )}
                {repo.commits.map((commit, index) => {
                  if (
                    view === "search" &&
                    !`${commit.subject} ${commit.author} ${commit.hash} ${commit.refs}`
                      .toLowerCase()
                      .includes(search.trim().toLowerCase())
                  )
                    return null;
                  return (
                    <button
                      className={
                        selection?.kind === "show" &&
                        selection.hash === commit.hash
                          ? "selected"
                          : ""
                      }
                      key={commit.hash}
                      aria-pressed={
                        selection?.kind === "show" &&
                        selection.hash === commit.hash
                      }
                      style={
                        view === "history"
                          ? { minWidth: laneX(graph.width - 1) + 135 }
                          : undefined
                      }
                      onClick={() =>
                        setSelection({ kind: "show", hash: commit.hash })
                      }
                    >
                      {view === "history" && (
                        <CommitGraphRow
                          row={graph.rows[index]}
                          width={graph.width}
                          author={commit.author}
                          theme={theme}
                        />
                      )}
                      <span className="commit-details">
                        <span className="commit-title">
                          <strong title={commit.subject}>
                            {commit.subject || "Untitled commit"}
                          </strong>
                          {graph.rows[index].isMerge && (
                            <span
                              className="merge-badge"
                              title={`Parents: ${commit.parents.map((hash) => hash.slice(0, 7)).join(", ")}`}
                            >
                              Merge
                            </span>
                          )}
                        </span>
                        <small className="commit-meta">
                          <span title={commit.author}>{commit.author}</span>
                          <code title={commit.hash}>{commit.hash.slice(0, 7)}</code>
                          <time dateTime={commit.date} title={new Date(commit.date).toLocaleString()}>
                            {commit.date.slice(0, 10)}
                          </time>
                        </small>
                        {commit.refs && (
                          <span className="commit-ref-list">
                            {commit.refs.split(", ").map((ref) => (
                              <span
                                className="commit-ref"
                                key={ref}
                                title={ref}
                              >
                                <GitBranch size={10} aria-hidden="true" />
                                <span>{ref}</span>
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </aside>
          <section className="diff-panel" aria-label="Diff">
            <header>
              {selection?.kind === "show" ? (
                <GitCommitHorizontal size={16} aria-hidden="true" />
              ) : (
                <FileDiff size={16} aria-hidden="true" />
              )}
              <strong>
                {selection?.kind === "diff"
                  ? selection.path
                  : selection?.kind === "show"
                    ? selection.hash.slice(0, 12)
                    : "Diff"}
              </strong>
              {selection?.kind === "diff" && (
                <span className="diff-context">
                  {selection.staged ? "Staged" : "Working tree"}
                </span>
              )}
              {selectedCommit && repo.branch !== "Detached HEAD" && (
                <button
                  className="diff-cherry-pick"
                  type="button"
                  disabled={busy || repo.cherry_picking}
                  onClick={() => setCherryPick(selectedCommit)}
                >
                  <GitPullRequestArrow size={14} aria-hidden="true" />{" "}
                  Cherry-pick
                </button>
              )}
            </header>
            {loadingDiff ? (
              <p className="diff-empty">
                <LoaderCircle size={24} className="spin" aria-hidden="true" />{" "}
                Loading diff…
              </p>
            ) : diff ? (
              <DiffFiles
                key={JSON.stringify(selection)}
                text={diff}
                commit={selectedCommit}
              />
            ) : (
              <p className="diff-empty">
                {view === "history" ? (
                  <History size={26} aria-hidden="true" />
                ) : (
                  <FileDiff size={26} aria-hidden="true" />
                )}
                {selection
                  ? "No textual diff available."
                  : view === "changes"
                    ? "Select a changed file to review its diff."
                    : "Select a commit to inspect its changes."}
              </p>
            )}
          </section>
        </div>
      )}
      {cherryPick && repo && (
        <CherryPickDialog
          commit={cherryPick}
          branch={repo.branch}
          onClose={() => setCherryPick(null)}
          onApply={(mainline) => {
            setCherryPick(null);
            runGitAction(
              { kind: "cherry_pick", hash: cherryPick.hash, mainline },
              "Commit cherry-picked.",
              true,
            );
          }}
        />
      )}
      {picker && (
        <RepositoryPicker
          initialView={picker}
          recent={recent}
          busy={busy}
          error={error}
          onClose={() => {
            setError("");
            setPicker(null);
          }}
          onOpen={(folder) =>
            void update(
              () => repository<Snapshot>(null, { kind: "open", folder }),
              enterRepository,
            )
          }
          onChoose={chooseRepository}
          onForget={(folder) =>
            setRecent((paths) => paths.filter((path) => path !== folder))
          }
          onClone={(target) =>
            void update(
              () => repository<Snapshot>(null, { kind: "clone", ...target }),
              () => {
                enterRepository();
                setNotice("Repository cloned.");
              },
            )
          }
        />
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
