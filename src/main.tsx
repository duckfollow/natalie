import {
  CircleAlert,
  ChevronRight,
  CircleCheck,
  Cloud,
  FileDiff,
  Download,
  FolderGit2,
  FileText,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequestArrow,
  History,
  Layers3,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
  Undo2,
  Tag,
  Sun,
  Moon,
  Monitor,
  PanelLeft,
  PanelRightOpen,
  List,
} from "lucide-react";
import type { CSSProperties } from "react";
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
import { UpdateNotice } from "./UpdateNotice";
import { GitToolbar } from "./GitToolbar";
import "./style.css";

type Change = { path: string; index: string; worktree: string };
type Snapshot = {
  root: string;
  branch: string;
  head: string | null;
  changes: Change[];
  commits: Commit[];
  branches: Reference[];
  tags: Reference[];
  remotes: string[];
  remote_branches: Reference[];
  origin_url: string | null;
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
const laneStep = 28;
const lanePadding = 17;
const laneX = (lane: number, compact = false) => lanePadding + lane * (compact ? 18 : laneStep);

function CommitGraphRow({
  row,
  width,
  author,
  theme,
  compact,
}: {
  row: ReturnType<typeof layoutHistory>["rows"][number];
  width: number;
  author: string;
  compact: boolean;
  theme: "light" | "dark";
}) {
  const colors = theme === "light" ? lightLaneColors : laneColors;
  const halfRow = compact ? 16 : 38;
  const graphWidth = laneX(width - 1, compact) + lanePadding;
  const initials = author
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toLocaleUpperCase();

  return (
    <span
      className="commit-graph"
      aria-hidden="true"
      style={{ width: graphWidth, height: halfRow * 2 }}
    >
      <svg width={graphWidth} height={halfRow * 2} fill="none" strokeLinejoin="round">
        {row.edges.map((edge, index) => {
          const from = laneX(edge.from, compact);
          const to = laneX(edge.to, compact);
          const start = edge.part === "top" ? 0 : halfRow;
          const end = start + halfRow;
          let path = `M ${from} ${start} V ${end}`;
          if (from !== to) {
            const bend = start + halfRow / 2;
            const radius = compact ? 4 : 6;
            const offset = radius * Math.sign(to - from);
            path = [
              `M ${from} ${start} V ${bend - radius}`,
              `Q ${from} ${bend} ${from + offset} ${bend}`,
              `H ${to - offset}`,
              `Q ${to} ${bend} ${to} ${bend + radius} V ${end}`,
            ].join(" ");
          }
          return (
            <path
              key={index}
              d={path}
              stroke={colors[edge.color % colors.length]}
              opacity={compact ? 0.7 : undefined}
              strokeDasharray={edge.dashed ? "4 3" : undefined}
              strokeWidth={edge.merge && !compact ? 2.6 : 1.6}
            />
          );
        })}
      </svg>
      <span
        className={`commit-dot${row.isMerge ? " commit-dot-merge" : ""}`}
        style={{
          left: laneX(row.index, compact),
          background: colors[row.color % colors.length],
        }}
      >
        {row.isMerge || compact ? null : initials}
      </span>
    </span>
  );
}

function DiffLines({ lines, patch = false }: { lines: string[]; patch?: boolean }) {
  return (
    <pre className="diff">
      {lines.map((line, index) => (
        <span
          key={index}
          className={
            !patch && (line.startsWith("+++ ") || line.startsWith("--- "))
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
  const totals = files.reduce(
    (total, file) => ({
      additions: total.additions + file.additions,
      deletions: total.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
  if (!files.length && !commit) return <DiffLines lines={intro} />;
  return (
    <div className="diff-files">
      {files.length > 0 && (
        <div className="diff-file-toolbar">
          <span className="diff-change-summary">
            <strong>{files.length} {files.length === 1 ? "changed file" : "changed files"}</strong>
            <span className="diff-added" aria-label={`${totals.additions} additions`}>+{totals.additions}</span>
            <span className="diff-removed" aria-label={`${totals.deletions} deletions`}>−{totals.deletions}</span>
          </span>
          {files.length > 1 && (
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
          )}
        </div>
      )}
      <div className="diff-file-scroll">
        {commit ? (
          <div className="diff-commit-card">
            <h2>{commit.subject || "Untitled commit"}</h2>
            <div className="diff-commit-meta">
              <span>{commit.author}</span>
              <time dateTime={commit.date}>{commit.date.slice(0, 10)}</time>

            </div>
            {intro.some((line) => line.trim()) && (
              <details className="diff-commit-raw">
                <summary>Commit metadata</summary>
                <DiffLines lines={intro} />
              </details>
            )}
            {!files.length && <p>No file diff in this view.</p>}
          </div>
        ) : (
          intro.some((line) => line.trim()) && <DiffLines lines={intro} />
        )}
        {files.map(({ path, lines, metadata, additions, deletions }, index) => (
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
              <span className="diff-file-path" title={path}>
                <strong>{path.split("/").at(-1)}</strong>
                {path.includes("/") && <small>{path.slice(0, path.lastIndexOf("/"))}</small>}
              </span>
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
            <DiffLines lines={lines} patch={metadata.length > 0} />
            {metadata.length > 0 && (
              <details className="diff-patch-metadata">
                <summary>Patch metadata</summary>
                <DiffLines lines={metadata} />
              </details>
            )}
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
const sidebarCollapsedKey = "natalie.sidebarCollapsed";
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
  const [gitStatus, setGitStatus] = useState<"checking" | "ready" | "missing" | "error">("checking");
  const [gitSetupMessage, setGitSetupMessage] = useState("");
  const [installingGit, setInstallingGit] = useState(false);

  async function checkGit() {
    setGitStatus("checking");
    setGitSetupMessage("");
    try {
      setGitStatus(await invoke<boolean>("git_available") ? "ready" : "missing");
    } catch (error) {
      setGitSetupMessage(String(error));
      setGitStatus("error");
    }
  }

  useEffect(() => {
    void checkGit();
  }, []);

  async function installGit() {
    setInstallingGit(true);
    setGitSetupMessage("");
    try {
      await invoke("install_command_line_tools");
      setGitSetupMessage("After installation finishes, select Check again.");
    } catch (error) {
      setGitSetupMessage(String(error));
    } finally {
      setInstallingGit(false);
    }
  }

  const [repo, setRepo] = useState<Snapshot | null>(null);
  const [panels, setPanels] = useState(() => {
    let navigation = true;
    try {
      navigation = localStorage.getItem(sidebarCollapsedKey) !== "true";
    } catch {
      // Start with the sidebar open when storage is unavailable.
    }
    return { navigation, list: true };
  });
  useEffect(() => {
    try {
      localStorage.setItem(sidebarCollapsedKey, String(!panels.navigation));
    } catch {
      // The choice still applies for this session.
    }
  }, [panels.navigation]);
  const listPanel = useRef<HTMLElement>(null);
  const diffPanel = useRef<HTMLElement>(null);
  const resizeStart = useRef({ x: 0, width: 0 });
  const [listWidth, setListWidth] = useState<number>();
  const [historyWidths, setHistoryWidths] = useState<Record<string, number>>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("natalie.historyWidths") ?? "{}");
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
      return Object.fromEntries(Object.entries(saved).filter(
        ([, width]) => typeof width === "number" && Number.isFinite(width) && width >= 0,
      ));
    } catch {
      return {};
    }
  });
  const [resizingDiff, setResizingDiff] = useState(false);

  function constrainListWidth(width: number) {
    const list = listPanel.current;
    const diff = diffPanel.current;
    if (!list || !diff) return width;
    const maxWidth = list.offsetWidth + diff.offsetWidth - 280;
    return Math.max(view === "history" ? 0 : 180, Math.min(width, maxWidth));
  }

  const [view, setView] = useState<WorkspaceView>("changes");

  const [search, setSearch] = useState("");
  const [cherryPick, setCherryPick] = useState<Commit | null>(null);
  useEffect(() => {
    if (!repo || picker || cherryPick) return;
    function handleSidebarShortcut(event: KeyboardEvent) {
      if (
        !event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "b" ||
        event.defaultPrevented
      ) return;
      event.preventDefault();
      if (!event.repeat) toggleSidebar();
    }
    window.addEventListener("keydown", handleSidebarShortcut);
    return () => window.removeEventListener("keydown", handleSidebarShortcut);
  }, [repo, picker, cherryPick]);

  function toggleSidebar() {
    setPanels((current) => ({ ...current, navigation: !current.navigation }));
  }

  const [selection, setSelection] = useState<Selection | null>(null);
  const [diff, setDiff] = useState("");
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const staged =
    repo?.changes.filter((item) => item.index !== " " && item.index !== "?") ??
    [];
  const unstaged = repo?.changes.filter((item) => item.worktree !== " ") ?? [];
  const root = repo?.root ?? null;
  const [historyBranch, setHistoryBranch] = useState<string | null>(null);
  const [remoteHistory, setRemoteHistory] = useState<{
    root: string;
    hash: string;
    commits: Commit[];
    error?: string;
  } | null>(null);
  const remoteHash = view === "history"
    ? repo?.remote_branches.find(({ name }) => name === historyBranch)?.hash
    : undefined;
  const loadedHistory = remoteHistory && remoteHistory.root === root && remoteHistory.hash === remoteHash
    ? remoteHistory
    : null;
  const commits = remoteHash ? loadedHistory?.commits : repo?.commits;

  useEffect(() => {
    if (!root || !remoteHash) return;
    let current = true;
    repository<Commit[]>(root, { kind: "history", hash: remoteHash }).then(
      (commits) => {
        if (current) setRemoteHistory({ root, hash: remoteHash, commits });
      },
      (failure) => {
        if (current) setRemoteHistory({ root, hash: remoteHash, commits: [], error: String(failure) });
      },
    );
    return () => {
      current = false;
    };
  }, [root, remoteHash]);

  const selectedCommit =
    selection?.kind === "show"
      ? commits?.find(({ hash }) => hash === selection.hash)
      : undefined;
  const graph = useMemo(
    () => layoutHistory(commits ?? []),
    [commits],
  );

  const history = view === "history";
  const graphWidth = laneX(graph.width - 1) + lanePadding;
  const graphThreshold = Math.max(180, graphWidth + 122);
  const historyWidth = root ? historyWidths[root] : undefined;
  const graphOnly = history && historyWidth != null && historyWidth < graphThreshold;
  const listVisible = history || panels.list;
  const preferredWidth = history ? historyWidth : listWidth;

  useEffect(() => {
    if (resizingDiff) return;
    try {
      localStorage.setItem("natalie.historyWidths", JSON.stringify(historyWidths));
    } catch {
      // Keep the current session's widths when storage is unavailable.
    }
  }, [historyWidths, resizingDiff]);

  function resizeList(width: number) {
    const next = constrainListWidth(width);
    if (history && root) {
      setHistoryWidths((widths) => ({ ...widths, [root]: next }));
    } else setListWidth(next);
  }

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
        if ("kind" in action && (action.kind === "checkout_remote" || action.kind === "checkout_branch")) {
          setHistoryBranch(null);
        }
        setNotice(message);
      },
    );
  }

  function enterRepository() {
    setHistoryBranch(null);
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
          {inIndex ? (
            <Layers3 size={14} aria-hidden="true" />
          ) : (
            <FileDiff size={14} aria-hidden="true" />
          )}
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
          const separator = item.path.lastIndexOf("/");
          const name = item.path.slice(separator + 1);
          const directory = item.path.slice(0, separator);
          return (
            <div
              className={`file-row${selected ? " selected" : ""}`}
              key={item.path}
            >
              <button
                className="file-name"
                type="button"
                title={item.path}
                aria-pressed={selected}
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
                <span className="file-path">
                  <span className="file-basename">{name}</span>
                  {separator >= 0 && (
                    <span className="file-directory">{directory}/</span>
                  )}
                </span>
                <span
                  className={`status status-${code === "?" ? "new" : code}`}
                >
                  {code === "?" ? "A" : code}
                </span>
              </button>
              <button
                className="file-action discard-action"
                type="button"
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
                className="file-action stage-action"
                type="button"
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
          <img className="mark" src="/natalie-mark.svg" alt="" />
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
          <UpdateNotice />
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
          <button className="header-secondary" disabled={busy || gitStatus !== "ready"} onClick={() => showPicker("repositories")}>
            <FolderGit2 size={15} aria-hidden="true" /> Repositories
          </button>
          <button className="header-secondary" disabled={busy || gitStatus !== "ready"} onClick={() => showPicker("clone")}>
            <Download size={15} aria-hidden="true" /> Clone
          </button>
          {root && (
            <button
              className="header-secondary header-refresh"
              title="Refresh repository"
              aria-label="Refresh repository"
              disabled={busy}
              onClick={() =>
                void update(() =>
                  repository<Snapshot>(null, { kind: "open", folder: root }),
                )
              }
            >
              <RefreshCw size={15} aria-hidden="true" />
            </button>
          )}
          <button
            className="primary"
            onClick={chooseRepository}
            disabled={busy || gitStatus !== "ready"}
          >
            <FolderOpen size={15} aria-hidden="true" /> Open repository
          </button>
        </div>
      </header>
      {repo && (
        <div className="workspace-strip">
          <button
            className="sidebar-toggle"
            type="button"
            aria-label={panels.navigation ? "Collapse sidebar" : "Expand sidebar"}
            aria-controls="repository-navigation"
            aria-expanded={panels.navigation}
            aria-keyshortcuts="Meta+B"
            title={`${panels.navigation ? "Collapse" : "Expand"} sidebar (⌘ B)`}
            onClick={toggleSidebar}
          >
            <PanelLeft size={18} aria-hidden="true" />
          </button>
          <div id="workspace-git-actions">
            <GitToolbar
              busy={busy}
              branches={repo.branches.map(({ name }) => name)}
              currentBranch={repo.branch}
              originUrl={repo.origin_url}
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
                    set_origin: "Origin updated. Fetch to refresh remote commits.",
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
          {!history && <div
            className="workspace-layout"
            role="group"
            aria-label="Workspace layout"
          >
            <button
              type="button"
              title={`${panels.list ? "Hide" : "Show"} File and commit list`}
              aria-label="File and commit list"
              aria-controls="workspace-list"
              aria-expanded={panels.list}
              onClick={() =>
                setPanels((current) => ({ ...current, list: !current.list }))
              }
            >
              <List size={15} aria-hidden="true" />
            </button>
          </div>}
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
        <div className="success-notice" key={notice}>
          <div className="success-notice-content">
            <div className="banner" role="status">
              <CircleCheck size={15} aria-hidden="true" /> <span>{notice}</span>
            </div>
          </div>
        </div>
      )}
      {!repo ? (
        <section className="welcome">
          <img className="mark large" src="/natalie-mark.svg" alt="" />
          <h1>Open a Git repository</h1>
          <p>
            Review changes, prepare a commit, and browse your repository’s
            history.
          </p>
          {gitStatus === "ready" ? (
            <button className="primary" onClick={chooseRepository} disabled={busy}>
              <FolderOpen size={16} aria-hidden="true" />
              {busy ? "Opening…" : "Choose folder"}
            </button>
          ) : gitStatus === "checking" ? (
            <p role="status">Checking Git availability…</p>
          ) : (
            <div className="welcome-git-setup">
              <strong>{gitStatus === "missing" ? "Git is required to open or clone a repository" : "Could not check Git availability"}</strong>
              {gitStatus === "missing" && <p>Install Apple’s Command Line Tools to enable Git.</p>}
              {gitSetupMessage && <p role="status">{gitSetupMessage}</p>}
              <div className="welcome-git-actions">
                {gitStatus === "missing" && (
                  <button className="primary" disabled={installingGit} onClick={() => void installGit()}>
                    <Download size={15} aria-hidden="true" /> Install Command Line Tools
                  </button>
                )}
                <button disabled={installingGit} onClick={() => void checkGit()}>
                  <RefreshCw size={15} aria-hidden="true" /> Check again
                </button>
              </div>
            </div>
          )}
        </section>
      ) : (
        <div
          className="workspace"
          data-navigation={panels.navigation ? "open" : "collapsed"}
          data-list={graphOnly ? "graph" : listVisible ? "open" : "closed"}
          data-resizing-diff={resizingDiff}
          style={{
            "--graph-list-width": `${laneX(graph.width - 1, true) + lanePadding + 20}px`,
            "--history-list-width": view === "history" ? `${laneX(graph.width - 1) + lanePadding + 245}px` : undefined,
            "--preferred-list-width": preferredWidth == null ? undefined : `${preferredWidth}px`,
          } as CSSProperties}
        >
          <RepositorySidebar
            {...repo}
            collapsed={!panels.navigation}
            onExpand={toggleSidebar}
            view={view}
            historyBranch={remoteHash ? historyBranch : null}
            busy={busy}
            onCheckoutBranch={(branch, remote) =>
              runGitAction(
                remote ? { kind: "checkout_remote", remote, branch } : { kind: "checkout_branch", branch },
                `Checked out ${branch}`,
              )
            }
            onDeleteBranch={(branch) => {
              void update(async () => {
                const approved = await confirm(
                  `Delete the local branch "${branch}"?`,
                  { title: "Delete branch", kind: "warning", okLabel: "Delete branch", cancelLabel: "Cancel" },
                );
                return approved
                  ? repository<Snapshot>(root, { kind: "delete_branch", branch })
                  : null;
              }, () => {
                setSelection(null);
                setNotice(`Deleted local branch ${branch}.`);
              });
            }}
            onRemoteBranch={(ref) => {
              setHistoryBranch(ref.name);
              setView("history");
              setPanels((current) => ({ ...current, list: true }));
              setSelection({ kind: "show", hash: ref.hash });
            }}
            onView={(next) => {
              setHistoryBranch(null);
              setView(next);
              setPanels((current) => ({ ...current, list: true }));
              setSelection(null);
            }}
            onCommit={(hash) => {
              setHistoryBranch(null);
              setView("history");
              setSelection({ kind: "show", hash });
            }}
          />
          <aside
            className="workspace-list"
            id="workspace-list"
            ref={listPanel}
            hidden={!listVisible}
            aria-label={graphOnly ? "Commit graph" : view === "changes" ? "Changed files" : "Commits"}
          >
            <h2 className="workspace-list-title">
              {graphOnly ? (
                <>
                  <span>Graph</span>
                  <button
                    type="button"
                    className="restore-graph"
                    aria-label="Restore full commit history"
                    title="Restore full commit history"
                    onClick={() => {
                      if (!root) return;
                      setHistoryWidths((widths) => {
                        const next = { ...widths };
                        delete next[root];
                        return next;
                      });
                    }}
                  >
                    <PanelRightOpen size={13} aria-hidden="true" />
                  </button>
                </>
              ) : view === "changes"
                ? "File status"
                : view === "history"
                  ? "Commit history"
                  : "Search commits"}
              {!graphOnly && view !== "changes" && (
                <span className="history-count" title="Loaded commits">{commits?.length ?? 0}</span>
              )}
            </h2>
            {view === "history" && !graphOnly && (
              <div className="history-context" title={remoteHash ? historyBranch ?? repo.branch : repo.branch}>
                <GitBranch size={13} aria-hidden="true" />
                <span>{remoteHash ? historyBranch : repo.branch}</span>
                <small>Latest {commits?.length ?? 0} commits</small>
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
                <div className="sidebar-scroll file-status-list">
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
                {!commits?.length && (
                  <p className="group-empty">
                    {loadedHistory?.error ?? (remoteHash && !loadedHistory ? "Loading history…" : "No commits yet")}
                  </p>
                )}
                {commits?.map((commit, index) => {
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
                      aria-label={graphOnly ? `${commit.subject || "Untitled commit"} · ${commit.hash.slice(0, 7)}` : undefined}
                      title={graphOnly ? `${commit.subject || "Untitled commit"} · ${commit.hash.slice(0, 7)}` : undefined}
                      aria-pressed={
                        selection?.kind === "show" &&
                        selection.hash === commit.hash
                      }
                      style={
                        view === "history" && !graphOnly
                          ? { minWidth: laneX(graph.width - 1) + lanePadding + 122 }
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
                          compact={graphOnly}
                          author={commit.author}
                          theme={theme}
                        />
                      )}
                      {!graphOnly && <span className="commit-details">
                        <span className="commit-title">
                          <strong title={view === "search" ? commit.subject : undefined}>
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
                            {commit.refs.split(", ").map((ref) => {
                              const kind = ref.startsWith("tag: ") ? "tag"
                                : ref === "HEAD" || ref.startsWith("HEAD -> ") ? "current"
                                : repo.remote_branches.some(({ name }) => name === ref)
                                  || repo.remotes.some((remote) => ref === `${remote}/HEAD`) ? "remote"
                                : "local";
                              const Icon = kind === "tag" ? Tag : kind === "remote" ? Cloud : GitBranch;
                              const label = {
                                tag: "Tag",
                                current: "Current checkout",
                                remote: "Remote branch",
                                local: "Local branch",
                              }[kind];
                              return (
                                <span className="commit-ref" data-kind={kind} key={ref} title={`${label} · ${ref}`}>
                                  <Icon size={10} aria-hidden="true" />
                                  <span><span className="commit-ref-kind">{label} </span>{ref}</span>
                                </span>
                              );
                            })}
                          </span>
                        )}
                      </span>}
                    </button>
                  );
                })}
              </div>
            )}
          </aside>
          {listVisible && (
            <div
              className="diff-resize-handle"
              role="separator"
              aria-label="Resize Diff"
              aria-orientation="vertical"
              aria-controls="workspace-list"
              tabIndex={0}
              onPointerDown={(event) => {
                if (!event.isPrimary || event.button !== 0 || !listPanel.current) return;
                event.preventDefault();
                resizeStart.current = {
                  x: event.clientX,
                  width: listPanel.current.offsetWidth,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
                setResizingDiff(true);
              }}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                const { x, width } = resizeStart.current;
                resizeList(width + event.clientX - x);
              }}
              onLostPointerCapture={() => setResizingDiff(false)}
              onDragStart={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const width = listPanel.current?.offsetWidth;
                if (width != null) {
                  resizeList(graphOnly && event.key === "ArrowRight"
                    ? graphThreshold + 20
                    : width + (event.key === "ArrowLeft" ? -20 : 20));
                }
              }}
            />
          )}
          <section className="diff-panel" aria-label="Diff" ref={diffPanel}>
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
                    ? <code title={selection.hash}>{selection.hash.slice(0, 12)}</code>
                    : "Diff"}
              </strong>
              {selection?.kind === "diff" && (
                <span className="diff-context">
                  {selection.staged ? "Staged" : "Working tree"}
                </span>
              )}
              {selectedCommit && repo.branch !== "Detached HEAD" && (
                <div className="diff-commit-actions">
                  <button
                    type="button"
                    disabled={busy || repo.cherry_picking}
                    onClick={() => setCherryPick(selectedCommit)}
                  >
                    <GitPullRequestArrow size={14} aria-hidden="true" />
                    Cherry-pick
                  </button>
                  <button
                    type="button"
                    disabled={busy || repo.cherry_picking || !repo.head || repo.head === selectedCommit.hash}
                    onClick={() => {
                      const { branch, head } = repo;
                      if (!head) return;
                      const { hash, subject } = selectedCommit;
                      void update(async () => {
                        const approved = await confirm(
                          `Move ${branch} to ${hash.slice(0, 7)} · ${subject}? The index and working tree stay as they are. This changes the local branch history.`,
                          { title: "Reset (Soft)", kind: "warning", okLabel: "Reset (Soft)", cancelLabel: "Cancel" },
                        );
                        return approved
                          ? repository<Snapshot>(root, { kind: "reset_soft", hash, branch, head })
                          : null;
                      }, () => {
                        setView("changes");
                        setPanels((current) => ({ ...current, list: true }));
                        setSelection(null);
                        setNotice("Soft reset completed.");
                      });
                    }}
                  >
                    <Undo2 size={14} aria-hidden="true" />
                    Reset (Soft)
                  </button>
                </div>
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
          currentPath={repo?.root}
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
