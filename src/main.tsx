import { RemoteCheckoutActions } from "./RemoteCheckoutActions";
import { centerHistoryRow } from "./scroll-history";
import { StashPreviewDialog } from "./StashPreviewDialog";
import { CommitIdentityDialog } from "./CommitIdentityDialog";
import { CommitGenerateButton } from "./CommitGenerateButton";
import { useGenerateCommitMessage } from "./use-generate-commit-message";
import {
  CircleAlert,
  ArrowDownToLine,
  TriangleAlert,
  ChevronRight,
  Ellipsis,
  CircleCheck,
  Cloud,
  FileDiff,
  Download,
  FolderGit2,
  FileText,
  FolderOpen,
  GitBranch,
  GitMerge,
  GitCommitHorizontal,
  GitPullRequestArrow,
  History,
  Image as ImageIcon,
  Maximize2,
  X,
  Layers3,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
  Undo2,
  Trash2,
  Tag,
  Sun,
  Moon,
  Monitor,
  PanelLeft,
  PanelRightOpen,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import type { CSSProperties } from "react";
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { open, confirm } from "@tauri-apps/plugin-dialog";
import { CommitGraphRow, lanePadding, laneX } from "./CommitGraphRow";
import { layoutHistory, type Commit } from "./history-graph";
import { splitDiff } from "./diff-model";
import {
  RepositorySidebar,
  type LocalBranch,
  type Reference,
  type RecentOriginBranch,
  type WorkspaceView,
} from "./RepositorySidebar";
import { RepositoryPicker } from "./RepositoryPicker";
import { CherryPickDialog } from "./CherryPickDialog";
import { UpdateNotice } from "./UpdateNotice";
import { GitToolbar } from "./GitToolbar";
import "./style.css";

type Change = { path: string; index: string; worktree: string };
const isConflict = ({ index, worktree }: Change) =>
  index === "U" || worktree === "U" || (index === worktree && (index === "A" || index === "D"));

type Snapshot = {
  root: string;
  repo_version: string;
  branch: string;
  head: string | null;
  changes: Change[];
  commits: Commit[];
  branches: LocalBranch[];
  tags: Reference[];
  remotes: string[];
  remote_branches: Reference[];
  recent_origin_branches: RecentOriginBranch[];
  origin_url: string | null;
  commit_author: string | null;
  stashes: Reference[];
  submodules: string[];
  cherry_picking: boolean;
  rebasing: boolean;
  has_upstream: boolean;
  ahead: number | null;
  behind: number | null;
};
type RebasePreview = { upstream: string; upstream_ref: string; commits: string[] };

function RebaseSequence({ preview, theme, commits }: {
  preview: RebasePreview;
  theme: "light" | "dark";
  commits?: Commit[];
}) {
  const shown = preview.commits.slice(0, 8);
  const remaining = preview.commits.length - shown.length;
  const hashes = [preview.upstream, ...shown];
  if (remaining) hashes.push("remaining");
  const rows: Commit[] = hashes.map((hash, index) => ({
    hash,
    author: "",
    date: "",
    refs: "",
    subject: hash === "remaining" ? `${remaining} more commits`
      : index === 0 ? preview.upstream_ref
      : commits?.find((commit) => commit.hash === hash)?.subject || "Replayed commit",
    parents: index ? [hashes[index - 1]] : [],
    local_only: index > 0,
    incoming: false,
    incoming_for_pull: false,
    incoming_branches: [],
  })).reverse();
  const graph = layoutHistory(rows);
  const replayed = new Set(hashes.slice(1));
  return (
    <ol className="rebase-sequence" aria-label="Projected commit graph, newest first">
      {rows.map((commit, index) => (
        <li key={commit.hash}>
          <CommitGraphRow row={graph.rows[index]} width={graph.width} author="" theme={theme}
            compact localOnly={commit.local_only} isHead={false} pushingHashes={replayed} />
          <strong title={commit.subject}>{commit.subject}</strong>
          {commit.hash !== "remaining" && (
            <code title={commit.hash}>{commit.hash.slice(0, 7)}{commit.local_only ? "′" : ""}</code>
          )}
        </li>
      ))}
    </ol>
  );
}

type Selection =
  | { kind: "diff"; path: string; staged: boolean; untracked: boolean }
  | { kind: "show"; hash: string };

function animateRefreshIcon(button: HTMLButtonElement | null) {
  const icon = button?.querySelector("svg");
  if (icon && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    icon.getAnimations().forEach((animation) => animation.cancel());
    icon.animate(
      [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
      { duration: 450, easing: "ease-in-out" },
    );
  }
}

function repository<T>(root: string | null, action: object) {
  return invoke<T>("repository", { root, action });
}

function CommitActions({ children, inert }: { children: React.ReactNode; inert?: boolean }) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function dismissOutside(event: PointerEvent) {
      const menu = menuRef.current;
      if (menu?.open && !event.composedPath().includes(menu)) menu.open = false;
    }
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, []);

  return (
    <details
      ref={menuRef}
      inert={inert}
      className="diff-commit-menu"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !event.currentTarget.open) return;
        event.stopPropagation();
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }}
    >
      <summary title="Commit actions" aria-label="Commit actions">
        <Ellipsis size={17} aria-hidden="true" />
      </summary>
      <div
        className="diff-commit-menu-items"
        onClick={(event) => {
          if (!event.nativeEvent.composedPath().some(
            (element) => element instanceof HTMLButtonElement && !element.disabled,
          )) return;
          const menu = event.currentTarget.parentElement as HTMLDetailsElement;
          menu.querySelector("summary")?.focus();
          menu.open = false;
        }}
      >
        {children}
      </div>
    </details>
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

function CommitMetadata({ lines, subject }: { lines: string[]; subject: string }) {
  const separator = lines.indexOf("");
  const header = (separator === -1 ? lines : lines.slice(0, separator)).join("\n");
  const fields = /^commit ([0-9a-f]+)\n(?:Merge: +([^\n]+)\n)?Author: +([^\n]+)\nAuthorDate: +([^\n]+)\nCommit: +([^\n]+)\nCommitDate: +([^\n]+)$/.exec(header);
  if (!fields) return <DiffLines lines={lines} />;

  const [, hash, parents, author, authored, committer, committed] = fields;
  const message = separator === -1 ? "" : lines.slice(separator + 1)
    .map((line) => line.replace(/^ {4}/, ""))
    .join("\n").trimEnd();
  const body = message.startsWith(subject + "\n")
    ? message.slice(subject.length + 1).replace(/^\n+/, "")
    : message === subject ? "" : message;

  return (
    <>
      <dl className="diff-metadata-fields">
        <dt>Commit</dt><dd><code>{hash}</code></dd>
        {parents && <><dt>Merge parents</dt><dd><code>{parents}</code></dd></>}
        <dt>Author</dt><dd>{author}</dd>
        <dt>Authored</dt><dd>{authored}</dd>
        <dt>Committer</dt><dd>{committer}</dd>
        <dt>Committed</dt><dd>{committed}</dd>
      </dl>
      {body && <p className="commit-metadata-message">{body}</p>}
    </>
  );
}

const patchMetadataLabels = [
  ["diff --git ", "Paths"],
  ["index ", "Blob IDs"],
  ["--- ", "Before"],
  ["+++ ", "After"],
  ["old mode ", "Previous mode"],
  ["new mode ", "New mode"],
  ["new file mode ", "New file mode"],
  ["deleted file mode ", "Deleted file mode"],
  ["similarity index ", "Similarity"],
  ["dissimilarity index ", "Dissimilarity"],
  ["rename from ", "Renamed from"],
  ["rename to ", "Renamed to"],
  ["copy from ", "Copied from"],
  ["copy to ", "Copied to"],
] as const;

function PatchMetadata({ lines }: { lines: string[] }) {
  return (
    <dl className="diff-metadata-fields">
      {lines.filter((line) => line.trim()).map((line, index) => {
        const field = patchMetadataLabels.find(([prefix]) => line.startsWith(prefix));
        const value = field ? line.slice(field[0].length) : line;
        return (
          <Fragment key={index}>
            <dt>{field?.[1] ?? "Git detail"}</dt>
            <dd><code>{value}</code></dd>
          </Fragment>
        );
      })}
    </dl>
  );
}

const imageTypes: Readonly<Partial<Record<string, string>>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};

function imageType(path: string) {
  const extension = path.match(/\.([a-z0-9]+)"?$/i)?.[1].toLowerCase();
  return extension && Object.hasOwn(imageTypes, extension) ? imageTypes[extension] : undefined;
}

type ImageRequest =
  | { kind: "image_preview"; path: string; staged: boolean }
  | { kind: "commit_image_preview"; before: string; after: string };

function ImageVersion({ data, mime, label, source }: {
  data: string | null; mime: string; label: string; source?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [dimensions, setDimensions] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const src = data && !failed ? `data:${mime};base64,${data}` : undefined;

  return (
    <figure className="image-version">
      <figcaption>
        <span className="image-version-label">
          <strong>{label}</strong>
          {source && <span>{source}</span>}
        </span>
        {dimensions && !failed && <span className="image-dimensions">{dimensions}</span>}
      </figcaption>
      {src ? (
        <button
          className="image-preview-canvas image-checkerboard"
          type="button"
          ref={expandButton}
          aria-label={`Enlarge ${label.toLowerCase()} image`}
          title="Enlarge image"
          onClick={() => {
            setActualSize(false);
            dialog.current?.showModal();
            setExpanded(true);
          }}
        >
          <img src={src} alt={`${label} version`} onError={() => setFailed(true)} onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget;
            setDimensions(`${naturalWidth} × ${naturalHeight}`);
          }} />
          <span className="image-expand-icon" aria-hidden="true"><Maximize2 size={14} /></span>
        </button>
      ) : (
        <div className="image-preview-placeholder">
          <ImageIcon size={22} aria-hidden="true" />
          <p>{failed ? "Image could not be displayed." : `No image ${label.toLowerCase()} this change.`}</p>
        </div>
      )}
      <dialog
        ref={dialog}
        className="image-viewer"
        aria-labelledby={titleId}
        onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}
        onClose={() => {
          setExpanded(false);
          expandButton.current?.focus({ preventScroll: true });
        }}
      >
        <div className="image-viewer-body">
          <header>
            <strong id={titleId}>{label} image</strong>
            {dimensions && <span className="image-dimensions">{dimensions}</span>}
            <div className="image-viewer-controls" role="group" aria-label="Image size">
              <button type="button" aria-pressed={!actualSize} onClick={() => setActualSize(false)}>Fit</button>
              <button type="button" aria-pressed={actualSize} onClick={() => setActualSize(true)}>Actual size</button>
            </div>
            <button type="button" aria-label="Close image viewer" onClick={() => dialog.current?.close()}>
              <X size={16} aria-hidden="true" />
            </button>
          </header>
          <div className="image-viewer-canvas image-checkerboard" data-actual-size={actualSize}>
            {expanded && src && <img src={src} alt={`${label} version`} />}
          </div>
        </div>
      </dialog>
    </figure>
  );
}

function ImagePreview({ root, request, mime }: {
  root: string; request: ImageRequest; mime: string;
}) {
  const [images, setImages] = useState<{ before: string | null; after: string | null } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    repository<{ before: string | null; after: string | null }>(root, request)
      .then(
        (preview) => { if (active) setImages(preview); },
        (failure) => { if (active) setError(String(failure)); },
      );
    return () => { active = false; };
  }, [root, request]);

  if (error || !images) return <p className="image-preview-status" role="status">{error || "Loading image preview…"}</p>;
  return (
    <section className="image-preview" aria-label="Image preview">
      <ImageVersion
        data={images.before}
        mime={mime}
        label="Before"
        source={request.kind === "image_preview" ? (request.staged ? "HEAD" : "Index") : undefined}
      />
      <ImageVersion
        data={images.after}
        mime={mime}
        label="After"
        source={request.kind === "image_preview" ? (request.staged ? "Index" : "Working tree") : undefined}
      />
    </section>
  );
}

function DiffFiles({ text, commit, hunkAction, preview, historyRoot }: {
  historyRoot?: string;
  preview?: React.ReactNode;
  text: string;
  commit?: Commit;
  hunkAction?: { label: string; disabled: boolean; apply: (index: number) => void };
}) {
  const { intro, files } = useMemo(() => splitDiff(text), [text]);
  const metadata = files[0]?.metadata;
  const canApplyHunks = hunkAction && files.length === 1 && metadata?.length === 4
    && / 100(?:644|755)$/.test(metadata[1])
    && /^--- "?a\//.test(metadata[2]) && /^\+\+\+ "?b\//.test(metadata[3])
    && !text.includes("\uFFFD");
  const hunkStarts = canApplyHunks
    ? files[0].lines.flatMap((line, index) => line.startsWith("@@ ") ? [index] : [])
    : [];
  const [fileQuery, setFileQuery] = useState("");
  const [historyImage, setHistoryImage] = useState<{ index: number; mime: string; request: ImageRequest } | null>(null);
  const filePicker = useRef<HTMLDialogElement>(null);
  const matchingFiles = files.map((file, index) => ({ ...file, index }))
    .filter(({ path }) => path.toLowerCase().includes(fileQuery.trim().toLowerCase()));

  function jumpToFile(index: number) {
    filePicker.current?.close();
    const section = sections.current[index];
    if (!section) return;
    section.open = true;
    section.scrollIntoView({ block: "start", inline: "nearest" });
    section.querySelector("summary")?.focus({ preventScroll: true });
  }

  const sections = useRef<Array<HTMLDetailsElement | null>>([]);
  const totals = files.reduce(
    (total, file) => ({
      additions: total.additions + file.additions,
      deletions: total.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
  if (!files.length && !commit && !preview) return <DiffLines lines={intro} />;
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
            <button type="button" className="diff-file-jump" aria-haspopup="dialog" onClick={() => {
              setFileQuery("");
              filePicker.current?.showModal();
            }}>
              <FileText size={14} aria-hidden="true" /> Jump to file…
            </button>
          )}
        </div>
      )}
      {files.length > 1 && (
        <dialog ref={filePicker} className="repo-picker diff-jump-dialog" aria-labelledby="diff-jump-title">
          <header>
            <FileText size={18} aria-hidden="true" />
            <h2 id="diff-jump-title">Jump to file</h2>
            <button type="button" className="repo-picker-close" aria-label="Close file picker" onClick={() => filePicker.current?.close()}>×</button>
          </header>
          <div className="repo-picker-content">
            <input
              autoFocus
              type="search"
              aria-label="Search changed files"
              placeholder="Search by name or path"
              value={fileQuery}
              onChange={(event) => setFileQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && matchingFiles.length) jumpToFile(matchingFiles[0].index);
              }}
            />
            {matchingFiles.length ? (
              <ul className="repo-list">
                {matchingFiles.map(({ path, index }) => (
                  <li key={index}>
                    <button type="button" className="repo-list-item" title={path} onClick={() => jumpToFile(index)}>
                      <FileText size={15} aria-hidden="true" />
                      <span className="repo-list-details">
                        <strong>{path.slice(path.lastIndexOf("/") + 1)}</strong>
                        {path.includes("/") && <small>{path.slice(0, path.lastIndexOf("/"))}</small>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p role="status">No matching files.</p>}
          </div>
        </dialog>
      )}
      <div className="diff-file-scroll">
        {preview}
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
                <CommitMetadata lines={intro} subject={commit.subject} />
              </details>
            )}
            {!files.length && <p>No file diff in this view.</p>}
          </div>
        ) : (
          intro.some((line) => line.trim()) && <DiffLines lines={intro} />
        )}
        {files.map(({ path, lines, metadata, additions, deletions, imageBlobs }, index) => (
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
            {historyRoot && imageBlobs && imageType(path) && (
              historyImage?.index === index ? (
                <ImagePreview
                  key={index}
                  root={historyRoot}
                  request={historyImage.request}
                  mime={historyImage.mime}
                />
              ) : (
                <button type="button" className="diff-image-button" onClick={() => {
                  const mime = imageType(path);
                  if (mime) setHistoryImage({
                    index,
                    mime,
                    request: { kind: "commit_image_preview", before: imageBlobs[0], after: imageBlobs[1] },
                  });
                }}><ImageIcon size={14} aria-hidden="true" /> View image</button>
              )
            )}
            {canApplyHunks ? hunkStarts.map((start, hunk) => {
              return (
                <div className="diff-hunk" key={start}>
                  <div className="diff-hunk-header">
                    <code>{lines[start]}</code>
                    <button type="button" disabled={hunkAction.disabled} onClick={() => hunkAction.apply(hunk)}>
                      {hunkAction.label}
                    </button>
                  </div>
                  <DiffLines lines={lines.slice(start + 1, hunkStarts[hunk + 1])} patch />
                </div>
              );
            }) : <DiffLines lines={lines} patch={metadata.length > 0} />}
            {metadata.length > 0 && (
              <details className="diff-patch-metadata">
                <summary>Patch metadata</summary>
                <PatchMetadata lines={metadata} />
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
    const root = document.documentElement;
    if (root.dataset.theme === theme) return;

    if (
      !root.dataset.theme ||
      typeof document.startViewTransition !== "function" ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      root.dataset.theme = theme;
      return;
    }

    let current = true;
    const transition = document.startViewTransition(() => {
      if (current) root.dataset.theme = theme;
    });
    return () => {
      current = false;
      transition.skipTransition();
    };
  }, [theme]);

  useLayoutEffect(() => {
    try {
      localStorage.setItem(appearanceKey, appearance);
    } catch {
      // The choice still applies for this session.
    }
  }, [appearance]);
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
  const [tagCommit, setTagCommit] = useState<string | null>(null);
  const [renameBranch, setRenameBranch] = useState<string | null>(null);
  const [branchCommit, setBranchCommit] = useState<string | null>(null);
  const [appliedPicks, setAppliedPicks] = useState<{ root: string; head: string | null; picks: Commit[] } | null>(null);
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
  const [loadedDiff, setLoadedDiff] = useState<{
    repo: Snapshot; selection: Selection; text: string;
  } | null>(null);
  const [conflictMenu, setConflictMenu] = useState<{ file: Change; x: number; y: number; trigger: HTMLButtonElement } | null>(null);
  const conflictMenuRef = useRef<HTMLDivElement>(null);
  const conflictFile = conflictMenu?.file;
  useLayoutEffect(() => {
    const menu = conflictMenuRef.current;
    if (!conflictMenu || !menu) return;
    menu.style.left = `${Math.max(8, Math.min(conflictMenu.x, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(conflictMenu.y, window.innerHeight - menu.offsetHeight - 8))}px`;
    menu.querySelector("button")?.focus({ preventScroll: true });
    function dismiss(event: PointerEvent) {
      if (!event.composedPath().includes(menu!)) setConflictMenu(null);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [conflictMenu]);
  const [discarding, setDiscarding] = useState<{ paths: string[]; mode: "file" | "selected" | "all" } | null>(null);
  const [discardSelection, setDiscardSelection] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [resetWarning, setResetWarning] = useState("");

  useEffect(() => {
    if (!notice && !resetWarning) return;
    const timer = window.setTimeout(() => {
      setNotice("");
      setResetWarning("");
    }, 4200);
    return () => window.clearTimeout(timer);
  }, [notice, resetWarning]);
  const [error, setError] = useState("");
  const [networkOperation, setNetworkOperation] = useState<"pull" | "push" | "fetch" | null>(null);
  const [pullingRoot, setPullingRoot] = useState<string | null>(null);
  const [stashReview, setStashReview] = useState<{ root: string; stash: Reference } | null>(null);
  const pendingCheckoutPulse = useRef<{ root: string; hash: string; id: number } | null>(null);
  const [checkoutPulse, setCheckoutPulse] = useState<{ root: string; hash: string; id: number } | null>(null);
  const [graphSync, setGraphSync] = useState<{ root: string; hashes: Set<string> } | null>(null);
  useEffect(() => {
    if (!graphSync) return;
    const timer = window.setTimeout(() => setGraphSync(null), 900);
    return () => window.clearTimeout(timer);
  }, [graphSync]);
  const [busy, setBusy] = useState(false);
  const [pushingHashes, setPushingHashes] = useState<Set<string>>();
  const seenOriginBranches = useRef(new Map<string, Set<string>>());
  const [newOriginBranches, setNewOriginBranches] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!repo) return;
    const names = new Set(repo.remote_branches.filter((ref) => ref.name.startsWith("origin/")).map((ref) => ref.name));
    const previous = seenOriginBranches.current.get(repo.root);
    seenOriginBranches.current.set(repo.root, names);
    if (!previous) return;
    const added = [...names].filter((name) => !previous.has(name));
    if (added.length) setNotice(`Found ${added.length} new ${added.length === 1 ? "branch" : "branches"} on origin.`);
    setNewOriginBranches((current) => {
      const before = current[repo.root] ?? [];
      const next = [...new Set([...before.filter((name) => names.has(name)), ...added])];
      return next.length === before.length && next.every((name, i) => name === before[i]) ? current : { ...current, [repo.root]: next };
    });
  }, [repo]);
  function acknowledgeOriginBranch(name: string) {
    if (!repo) return;
    setNewOriginBranches((current) => ({ ...current, [repo.root]: (current[repo.root] ?? []).filter((branch) => branch !== name) }));
  }
  const [refreshing, setRefreshing] = useState(false);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const conflicts = repo?.changes.filter(isConflict) ?? [];
  const staged =
    repo?.changes.filter((item) => !isConflict(item) && item.index !== " " && item.index !== "?") ??
    [];
  const unstaged = repo?.changes.filter((item) => !isConflict(item) && item.worktree !== " ") ?? [];
  const root = repo?.root ?? null;
  const generatedMessage = useGenerateCommitMessage({
    root, enabled: staged.length > 0 && !busy && !repo?.rebasing && conflicts.length === 0,
    message, setMessage,
  });
  const [previewingRebase, setPreviewingRebase] = useState(false);
  const [hoverRebase, setHoverRebase] = useState<{ repo: Snapshot; preview: RebasePreview } | null>(null);
  const [rebaseReview, setRebaseReview] = useState<{ repo: Snapshot; preview: RebasePreview } | null>(null);
  const rebaseDialog = useRef<HTMLDialogElement>(null);
  const rebaseGraph = previewingRebase && hoverRebase?.repo === repo ? hoverRebase?.preview : undefined;
  const rebaseHashes = useMemo(() => new Set(rebaseGraph?.commits), [rebaseGraph]);

  useEffect(() => {
    if (!previewingRebase || !repo || hoverRebase?.repo === repo) return;
    let active = true;
    void repository<RebasePreview>(repo.root, { kind: "rebase_preview" }).then((preview) => {
      if (active) setHoverRebase({ repo, preview });
    }).catch(() => {});
    return () => { active = false; };
  }, [previewingRebase, repo, hoverRebase]);

  useEffect(() => {
    if (rebaseReview) rebaseDialog.current?.showModal();
  }, [rebaseReview]);

  useEffect(() => {
    if (!root || !repo) return;
    let active = true;
    let checking = false;
    const version = repo.repo_version;

    async function checkForChanges() {
      if (document.hidden || pending.current || checking) return;
      checking = true;
      try {
        animateRefreshIcon(refreshButton.current);
        const next = await repository<Snapshot | null>(root, {
          kind: "refresh_if_changed",
          repo_version: version,
        });
        if (active && next && !pending.current) {
          setRepo((current) => current === repo ? next : current);
        }
      } catch {
        // Keep the current view on transient errors. Manual refresh reports errors.
      } finally {
        checking = false;
      }
    }

    const interval = window.setInterval(checkForChanges, 5000);
    window.addEventListener("focus", checkForChanges);
    document.addEventListener("visibilitychange", checkForChanges);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", checkForChanges);
      document.removeEventListener("visibilitychange", checkForChanges);
    };
  }, [root, repo]);

  const pendingPicks = staged.length && appliedPicks && appliedPicks.root === root && appliedPicks.head === repo?.head
    ? appliedPicks.picks
    : [];
  useEffect(() => {
    if (appliedPicks && !pendingPicks.length) setAppliedPicks(null);
  }, [appliedPicks, pendingPicks.length]);

  const [pullPreview, setPullPreview] = useState<{ root: string | null; branch: string } | null>(null);
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
  const firstPage = remoteHash ? loadedHistory?.commits : repo?.commits;
  const [olderHistory, setOlderHistory] = useState<{
    base: Commit[]; commits: Commit[]; done: boolean; loading: boolean; error?: string;
  } | null>(null);
  const older = olderHistory?.base === firstPage ? olderHistory : null;
  const commits = older?.commits ?? firstPage;
  const canLoadOlder = (firstPage?.length ?? 0) === 100 && !older?.done;
  const [historyScroll, setHistoryScroll] = useState<{ hash: string } | null>(null);
  const historyEnd = useRef<HTMLDivElement>(null);
  const historyTarget = selection?.kind === "show" && selection.hash === historyScroll?.hash
    ? historyScroll
    : null;
  const jumpNeedsPage = view === "history" && historyTarget != null
    && repo?.branches.some(({ hash }) => hash === historyTarget.hash)
    && !commits?.some(({ hash }) => hash === historyTarget.hash);
  const rebaseNeedsPage = view === "history" && !remoteHash && !!rebaseGraph
    && (!commits?.some(({ hash }) => hash === rebaseGraph.upstream)
      || !commits?.some(({ hash }) => hash === rebaseGraph.commits[0]));
  const locatingRebase = rebaseNeedsPage && canLoadOlder && !older?.error;
  const locatingCommit = view === "history" && historyTarget != null
    && (Boolean(remoteHash && !loadedHistory)
      || (jumpNeedsPage && canLoadOlder && !older?.error));


  useEffect(() => {
    if (view === "changes" || !root || !firstPage || !commits?.length || !canLoadOlder || older?.error || older?.loading) return;
    async function loadPage(base: Commit[], loaded: Commit[], repositoryRoot: string, targets: string[] = []) {
      setOlderHistory({ base, commits: loaded, done: false, loading: true });
      const combined = [...loaded];
      const missing = new Set(targets);
      for (const { hash } of loaded) missing.delete(hash);
      let done = false;
      try {
        do {
          const page = await repository<Commit[]>(repositoryRoot, {
            kind: "older_history", hash: remoteHash ?? null, offset: combined.length,
            anchor: combined[combined.length - 1].hash,
          });
          combined.push(...page);
          for (const { hash } of page) missing.delete(hash);
          done = page.length < 100;
        } while (!done && missing.size);
        setOlderHistory((current) => current?.base === base
          ? { base, commits: combined, done, loading: false }
          : current);
      } catch (failure) {
        setOlderHistory((current) => current?.base === base
          ? { base, commits: combined, done, loading: false, error: String(failure) }
          : current);
      }
    }
    if (rebaseNeedsPage && rebaseGraph) {
      const target = rebaseGraph.commits[0];
      void loadPage(firstPage, commits, root, target ? [rebaseGraph.upstream, target] : [rebaseGraph.upstream]);
      return;
    }
    if (jumpNeedsPage) {
      void loadPage(firstPage, commits, root);
      return;
    }
    const marker = historyEnd.current;
    if (!marker) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      void loadPage(firstPage, commits, root);
    }, { root: marker.parentElement, rootMargin: "0px 0px 160px 0px" });
    observer.observe(marker);
    return () => observer.disconnect();
  }, [view, root, remoteHash, firstPage, commits, canLoadOlder, older, jumpNeedsPage, rebaseNeedsPage, rebaseGraph]);


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

  const diffIsCurrent = loadedDiff?.repo === repo && loadedDiff?.selection === selection;
  const showingPreviousCommit = selection?.kind === "show" && loadedDiff?.selection.kind === "show"
    && loadedDiff.repo.root === root;
  const displayedDiff = diffIsCurrent || showingPreviousCommit ? loadedDiff : null;
  const diffSelection = displayedDiff?.selection ?? selection;
  const diff = displayedDiff?.text ?? "";
  const loadingDiff = Boolean(root && selection && !diffIsCurrent);
  const selectedCommit = diffSelection?.kind === "show"
    ? commits?.find(({ hash }) => hash === diffSelection.hash)
    : undefined;
  const cancelHistoryScroll = useRef<(() => void) | null>(null);
  useLayoutEffect(() => () => { cancelHistoryScroll.current?.(); }, [root, view]);
  useLayoutEffect(() => {
    if (view !== "history" || !historyTarget) return;
    const row = listPanel.current?.querySelector<HTMLButtonElement>(
      `[data-commit-hash="${CSS.escape(historyTarget.hash)}"]`,
    );
    if (row) {
      cancelHistoryScroll.current?.();
      const scroller = row.closest<HTMLElement>(".history");
      const arrival = pendingCheckoutPulse.current;
      pendingCheckoutPulse.current = null;
      const onArrive = () => {
        if (arrival?.root === root && arrival.hash === historyTarget.hash) setCheckoutPulse(arrival);
      };
      if (scroller) cancelHistoryScroll.current = centerHistoryRow(scroller, row, onArrive);
      else { row.scrollIntoView({ block: "center", inline: "nearest" }); onArrive(); }
      row.focus({ preventScroll: true });
      setHistoryScroll(null);
    }
  }, [view, commits, historyTarget]);

  const [graphMenu, setGraphMenu] = useState<{ commit: Commit; x: number; y: number; trigger: HTMLButtonElement } | null>(null);
  const graphMenuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!graphMenu) return;
    const menu = graphMenuRef.current;
    if (!menu) return;
    menu.style.left = `${Math.max(4, Math.min(graphMenu.x, window.innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(graphMenu.y, window.innerHeight - menu.offsetHeight - 4))}px`;
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    function dismiss(event: PointerEvent) {
      if (!event.composedPath().includes(menu!)) setGraphMenu(null);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [graphMenu]);

  function graphMenuEvents(commit: Commit) {
    function open(trigger: HTMLButtonElement, x: number, y: number) {
      if (commit.hash !== previewHash) setSelection({ kind: "show", hash: commit.hash });
      setGraphMenu({ commit, x, y, trigger });
    }
    return {
      "aria-haspopup": "true" as const,
      onContextMenu(event: React.MouseEvent<HTMLButtonElement>) {
        event.preventDefault();
        open(event.currentTarget, event.clientX, event.clientY);
      },
      onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        open(event.currentTarget, bounds.left, bounds.bottom);
      },
    };
  }

  const pendingPickDialog = useRef<HTMLDialogElement>(null);
  const previewHash = "pending-cherry-pick";
  const query = search.trim().toLowerCase();
  const graphHead = repo?.head;
  const hasPendingPick = pendingPicks.length > 0;
  const pendingPickSubject = hasPendingPick ? message.trim().split("\n")[0] || "Pending commit" : "";
  const { graphCommits, graph } = useMemo(() => {
    const rows = view === "search" && query
      ? (commits ?? []).filter((commit) =>
          `${commit.subject} ${commit.author} ${commit.hash} ${commit.refs}`.toLowerCase().includes(query),
        )
      : [...(commits ?? [])];
    const headIndex = rows.findIndex(({ hash }) => hash === graphHead);
    if (view === "history" && !remoteHash && hasPendingPick && headIndex >= 0) {
      rows.splice(headIndex, 0, {
        hash: previewHash,
        parents: [rows[headIndex].hash],
        subject: pendingPickSubject,
        author: "",
        date: "",
        refs: "",
        local_only: true,
        incoming: false,
        incoming_for_pull: false,
        incoming_branches: [],
      });
    }
    return { graphCommits: rows, graph: layoutHistory(rows) };
  }, [commits, graphHead, hasPendingPick, pendingPickSubject, query, remoteHash, view]);

  const history = view === "history";
  const graphWidth = laneX(graph.width - 1) + lanePadding;
  const graphThreshold = Math.max(180, graphWidth + 122);
  const historyWidth = root ? historyWidths[root] : undefined;
  const graphOnly = history && historyWidth != null && historyWidth < graphThreshold;
  const [historyListVisible, setHistoryListVisible] = useState(true);
  const listVisible = history ? historyListVisible : panels.list;
  const preferredWidth = history ? historyWidth : listWidth;

  useEffect(() => {
    if (view !== "history" || !listVisible || !rebaseGraph || locatingRebase) return;
    const scroller = listPanel.current?.querySelector(".sidebar-scroll.history");
    if (!scroller) return;
    const rows = scroller.querySelectorAll("button:has(path[data-rebase-flow])");
    const observer = new IntersectionObserver((entries) => {
      for (const { target, isIntersecting } of entries) {
        target.toggleAttribute("data-rebase-visible", isIntersecting);
      }
    }, { root: scroller });
    rows.forEach((row) => observer.observe(row));
    return () => {
      observer.disconnect();
      rows.forEach((row) => row.removeAttribute("data-rebase-visible"));
    };
  }, [view, listVisible, rebaseGraph, locatingRebase, graph]);

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

  const imageMime = selection?.kind === "diff" ? imageType(selection.path) : undefined;
  const imageRequest = useMemo<ImageRequest | null>(() => selection?.kind === "diff"
    ? { kind: "image_preview", path: selection.path, staged: selection.staged }
    : null, [selection]);
  const imagePreview = root && imageRequest && imageMime
    ? <ImagePreview key={JSON.stringify([root, imageRequest])} root={root} request={imageRequest} mime={imageMime} />
    : undefined;

  useEffect(() => {
    if (!repo || !selection) return;
    let current = true;
    repository<string>(repo.root, selection).then(
      (text) => {
        if (current) setLoadedDiff({ repo, selection, text });
      },
      (failure) => {
        if (current) setLoadedDiff({ repo, selection, text: String(failure) });
      },
    );
    return () => {
      current = false;
    };
  }, [selection, repo]);

  async function update(
    action: () => Promise<Snapshot | null>,
    after?: (next: Snapshot) => void,
  ) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setResetWarning("");
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

  async function refreshRepository() {
    if (!root || pending.current) return;
    animateRefreshIcon(refreshButton.current);
    setRefreshing(true);
    try {
      await update(async () => {
        try {
          return await repository<Snapshot>(root, { kind: "fetch" });
        } catch (failure) {
          // Keep showing local changes when the remote is unavailable.
          const next = await repository<Snapshot>(null, {
            kind: "open",
            folder: root,
          }).catch(() => null);
          if (next) setRepo(next);
          throw failure;
        }
      });
    } finally {
      setRefreshing(false);
    }
  }

  function runGitAction(
    action: object,
    message: string,
    showChangesOnFailure = false,
    stagedCommit?: Commit,
  ) {
    const isPull = "kind" in action && action.kind === "pull";
    const isPush = "kind" in action && (action.kind === "push" || action.kind === "publish_branch");
    void update(
      async () => {
        const networkKind = isPull ? "pull" : isPush ? "push" : "kind" in action && action.kind === "fetch" ? "fetch" : null;
        if (networkKind) setNetworkOperation(networkKind);
        if (isPull) setPullingRoot(root);
        if (isPush && repo?.head) {
          const reachable = new Set([repo.head]);
          const outgoing = new Set<string>();
          for (const commit of commits ?? []) {
            if (!reachable.has(commit.hash)) continue;
            if (commit.local_only) outgoing.add(commit.hash);
            for (const parent of commit.parents) reachable.add(parent);
          }
          setPushingHashes(outgoing);
        }
        try {
          return await repository<Snapshot>(root, action);
        } catch (failure) {
          try {
            const next = await repository<Snapshot>(null, {
              kind: "open",
              folder: root,
            });
            setRepo(next);
            if (showChangesOnFailure && (next.cherry_picking || next.rebasing)) {
              setView("changes");
              setSelection(null);
            }
          } catch {
            // Preserve the original Git error.
          }
          throw failure;
        } finally {
          if (networkKind) setNetworkOperation(null);
          if (isPull) setPullingRoot(null);
          if (isPush) setPushingHashes(undefined);
        }
      },
      (next) => {
        if (repo?.root === next.root && "kind" in action && (action.kind === "pull" || action.kind === "push")) {
          const pendingHashes = new Set(graphCommits.filter((commit) =>
            action.kind === "pull" ? commit.incoming : commit.local_only,
          ).map(({ hash }) => hash));
          const hashes = new Set(next.commits.filter((commit) =>
            pendingHashes.has(commit.hash) && !commit.local_only && !commit.incoming,
          ).map(({ hash }) => hash));
          setGraphSync(hashes.size ? { root: next.root, hashes } : null);
        }
        if ("kind" in action && (action.kind === "checkout_remote" || action.kind === "checkout_branch" || action.kind === "checkout_commit")) {
          if (next.head && (repo?.head !== next.head || repo?.branch !== next.branch)) {
            setCheckoutPulse(null);
            pendingCheckoutPulse.current = { root: next.root, hash: next.head, id: Date.now() };
          }
          setHistoryBranch(null);
          setView("history");
          setHistoryListVisible(true);
          setHistoryScroll(next.head ? { hash: next.head } : null);
          setSelection(next.head ? { kind: "show", hash: next.head } : null);
        } else {
          setSelection(null);
        }
        if (stagedCommit) {
          const subject = stagedCommit.subject || stagedCommit.hash.slice(0, 7);
          setMessage((draft) => draft.trim() ? `${draft.trimEnd()}\n${subject}` : subject);
          setAppliedPicks((previous) => ({
            root: next.root,
            head: next.head,
            picks: [...(previous?.root === next.root && previous.head === next.head ? previous.picks : []), stagedCommit],
          }));
        }
        setNotice(message);
      },
    );
  }

  function enterRepository() {
    setAppliedPicks(null);
    setHistoryScroll(null);
    setDiscardSelection(new Set());
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

  function canDiscard(change: Change) {
    return !repo?.submodules.includes(change.path)
      && !isConflict(change);
  }

  const discardable = repo?.changes.filter(canDiscard).map(({ path }) => path) ?? [];
  const selectedForDiscard = discardable.filter((path) => discardSelection.has(path));

  function discardFiles(paths: string[], mode: "file" | "selected" | "all" = "file") {
    const label = paths.length === 1 ? `"${paths[0]}"` : `${paths.length} files`;
    void update(async () => {
      const approved = await confirm(
        `Discard staged and unstaged changes in ${label}? New files in this selection will be deleted. This cannot be undone.`,
        { title: "Discard file changes", kind: "warning", okLabel: "Discard", cancelLabel: "Cancel" },
      );
      if (!approved) return null;
      setDiscarding({ paths, mode });
      try {
        return await repository<Snapshot>(root, { kind: "discard_many", paths });
      } catch (failure) {
        try {
          setRepo(await repository<Snapshot>(null, { kind: "open", folder: root }));
        } catch {
          // Preserve the original Git error.
        }
        throw failure;
      } finally {
        setDiscarding(null);
      }
    }, () => {
      setDiscardSelection(new Set());
      setSelection(null);
      setNotice("File changes discarded.");
    });
  }

  function changeGroup(title: string, items: Change[], inIndex: boolean, conflicting = false) {
    return (
      <section className={conflicting ? "change-group conflict-group" : "change-group"} aria-label={title}>
        <h2>
          {conflicting ? <CircleAlert size={14} aria-hidden="true" /> : inIndex ? (
            <Layers3 size={14} aria-hidden="true" />
          ) : (
            <FileDiff size={14} aria-hidden="true" />
          )}
          {title} <span>{items.length}</span>
          {!conflicting && (
            <button
              type="button"
              className="stage-all-action"
              disabled={busy || !items.length}
              onClick={() => void update(
                () => repository<Snapshot>(root, { kind: inIndex ? "unstage_all" : "stage_all" }),
                (next) => {
                  setSelection((current) => {
                    if (current?.kind !== "diff" || current.staged !== inIndex) return current;
                    const change = next.changes.find(({ path }) => path === current.path);
                    if (!change) return null;
                    if (inIndex && change.worktree !== " ") {
                      return { ...current, staged: false, untracked: change.worktree === "?" };
                    }
                    if (!inIndex && change.worktree === " " && change.index !== " ") {
                      return { ...current, staged: true, untracked: false };
                    }
                    return current;
                  });
                  setNotice(inIndex ? "Staged files unstaged." : "Unstaged files staged.");
                },
              )}
            >
              {inIndex ? <Minus size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
              {inIndex ? "Unstage all" : "Stage all"}
            </button>
          )}
        </h2>
        {!items.length && (
          <p className="group-empty">No {title.toLowerCase()} files</p>
        )}
        {items.map((item) => {
          const selected =
            selection?.kind === "diff" &&
            selection.path === item.path &&
            selection.staged === inIndex;
          const code = conflicting ? "U" : inIndex ? item.index : item.worktree;
          const separator = item.path.lastIndexOf("/");
          const name = item.path.slice(separator + 1);
          const directory = item.path.slice(0, separator);
          return (
            <div
              className={`file-row${selected ? " selected" : ""}`}
              key={item.path}
            >
              <input
                type="checkbox"
                className="discard-checkbox"
                aria-label={`Select ${item.path} for discard (${title.toLowerCase()})`}
                checked={discardSelection.has(item.path) && canDiscard(item)}
                disabled={busy || !canDiscard(item)}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setDiscardSelection((previous) => {
                    const next = new Set(previous);
                    if (checked) next.add(item.path);
                    else next.delete(item.path);
                    return next;
                  });
                }}
              />
              <button
                onKeyDown={conflicting ? (event) => {
                  if (busy || (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))) return;
                  event.preventDefault();
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setConflictMenu({ file: item, x: bounds.left, y: bounds.bottom, trigger: event.currentTarget });
                } : undefined}
                onContextMenu={conflicting ? (event) => {
                  event.preventDefault();
                  if (!busy) setConflictMenu({ file: item, x: event.clientX, y: event.clientY, trigger: event.currentTarget });
                } : undefined}
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
                {conflicting ? <TriangleAlert size={14} className="conflict-file-icon" aria-label="Conflict" /> : <FileText size={14} aria-hidden="true" />}
                <span className="file-path">
                  <span className="file-basename">{name}</span>
                  {separator >= 0 && (
                    <span className="file-directory">{directory}/</span>
                  )}
                </span>
                {!conflicting && (
                  <span className={`status status-${code === "?" ? "new" : code}`}>
                    {code === "?" ? "A" : code}
                  </span>
                )}
              </button>
              <button
                className="file-action discard-action"
                type="button"
                disabled={busy || !canDiscard(item)}
                aria-label={`Discard changes in ${item.path}`}
                aria-busy={discarding?.paths.includes(item.path)}
                title="Discard all changes in this file"
                onClick={() => discardFiles([item.path])}
              >
                {discarding?.paths.includes(item.path)
                  ? <LoaderCircle size={14} className="spin" aria-hidden="true" />
                  : <Undo2 size={14} aria-hidden="true" />}
              </button>
              <button
                className="file-action stage-action"
                type="button"
                disabled={busy}
                aria-label={`${inIndex ? "Unstage" : "Stage"} ${item.path}`}
                title={inIndex ? "Unstage" : "Stage"}
                onClick={(event) => {
                  if (conflicting) {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setConflictMenu({ file: item, x: bounds.left, y: bounds.bottom, trigger: event.currentTarget });
                    return;
                  }
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

  function commitCommands(repo: Snapshot, hash: string, commit?: Commit) {
    return (
      <>
                  <button
                    type="button"
                    disabled={busy || repo.cherry_picking || (repo.branch === "Detached HEAD" && repo.head === hash)}
                    onClick={() => runGitAction({ kind: "checkout_commit", hash: hash }, `Checked out ${hash.slice(0, 7)} (detached HEAD).`)}
                  >
                    <GitCommitHorizontal size={14} aria-hidden="true" />
                    Checkout commit
                  </button>
                  <RemoteCheckoutActions hash={hash} references={repo.remote_branches} branches={repo.branches}
                    currentBranch={repo.branch} disabled={busy || repo.cherry_picking || repo.rebasing}
                    onCheckout={(branch) => runGitAction({ kind: "checkout_remote", remote: "origin", branch }, `Checked out ${branch} from origin.`)} />
                  <button
                    type="button"
                    disabled={busy || repo.cherry_picking}
                    onClick={() => setBranchCommit(hash)}
                  >
                    <GitBranch size={14} aria-hidden="true" />
                    Create branch
                  </button>
                  <button type="button" disabled={busy || repo.cherry_picking} onClick={() => setTagCommit(hash)}>
                    <Tag size={14} aria-hidden="true" />
                    Create tag
                  </button>
                  {commit && repo.branch !== "Detached HEAD" && <>
                  <button
                    type="button"
                    disabled={busy || repo.cherry_picking}
                    onClick={() => setCherryPick(commit)}
                  >
                    <GitPullRequestArrow size={14} aria-hidden="true" />
                    Cherry-pick
                  </button>
                  <button
                    type="button"
                    className="commit-reset-action"
                    disabled={busy || repo.cherry_picking || !repo.head || repo.head === commit.hash}
                    onClick={() => {
                      const { branch, head } = repo;
                      if (!head) return;
                      const { subject } = commit;
                      void update(async () => {
                        try {
                          await repository<null>(root, { kind: "check_soft_reset", hash, branch, head });
                        } catch (failure) {
                          setResetWarning(String(failure));
                          return null;
                        }
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
                  </>}
      </>
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
            data-appearance={appearance}
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
          <button className="header-secondary" disabled={(busy && !refreshing) || gitStatus !== "ready"} aria-disabled={refreshing} onClick={() => { if (!pending.current) showPicker("repositories"); }}>
            <FolderGit2 size={15} aria-hidden="true" /> Repositories
          </button>
          <button className="header-secondary" disabled={(busy && !refreshing) || gitStatus !== "ready"} aria-disabled={refreshing} onClick={() => { if (!pending.current) showPicker("clone"); }}>
            <Download size={15} aria-hidden="true" /> Clone
          </button>
          {root && (
            <button
              ref={refreshButton}
              className="header-secondary header-refresh"
              title="Refresh repository and fetch remote commits"
              aria-label="Refresh repository"
              aria-disabled={busy}
              onClick={refreshRepository}
            >
              <RefreshCw size={15} aria-hidden="true" />
            </button>
          )}
          <button
            className="primary"
            onClick={chooseRepository}
            disabled={(busy && !refreshing) || gitStatus !== "ready"}
            aria-disabled={refreshing}
          >
            <FolderOpen size={15} aria-hidden="true" /> Open repo
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
              refreshing={refreshing}
              networkOperation={networkOperation ?? (refreshing ? "fetch" : null)}
              authorControl={(onAuthentication) =>
                <CommitIdentityDialog key={repo.root} identity={repo.commit_author} disabled={busy} onAuthentication={onAuthentication} canAuthenticate={repo.remotes.length > 0}
                      onSave={async (name, email) => {
                        let saved = false;
                        let failure: unknown;
                        await update(
                          async () => {
                            try {
                              return await repository<Snapshot>(root, { kind: "set_commit_identity", name, email });
                            } catch (error) { failure = error; throw error; }
                          },
                          () => { saved = true; setNotice("Commit author updated for this repository."); },
                        );
                        if (!saved) throw Error(failure ? String(failure) : "Could not save author. Try again.");
                        return true;
                      }} />
              }
              branches={repo.branches.map(({ name }) => name)}
              currentBranch={repo.branch}
              remotes={repo.remotes}
              canPush={!!repo.head && repo.branch !== "Detached HEAD"}
              hasUpstream={repo.has_upstream}
              tagCommit={tagCommit}
              branchCommit={branchCommit}
              renameBranch={renameBranch}
              onPromptClose={() => {
                setBranchCommit(null);
                setTagCommit(null);
                setRenameBranch(null);
              }}
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
              onRebasePreview={setPreviewingRebase}
              onRebase={() => {
                void repository<RebasePreview>(repo.root, { kind: "rebase_preview" })
                  .then((preview) => setRebaseReview({ repo, preview }))
                  .catch((failure) => setError(String(failure)));
              }}
              onForcePush={() => {
                void update(async () => {
                  const plan = await repository<{
                    branch: string; head: string; remote: string; destination: string; expected: string; removed: number;
                  }>(root, { kind: "force_push_plan" });
                  if (!plan.removed) return null;
                  const target = `${plan.remote}/${plan.destination.replace(/^refs\/heads\//, "")}`;
                  const approved = await confirm(
                    `Replace ${target} (${plan.expected.slice(0, 7)}) with ${plan.branch} (${plan.head.slice(0, 7)})? This removes ${plan.removed} commit(s) from the remote branch’s history. Git cancels if the remote tip has changed.`,
                    { title: "Force Push with Lease", kind: "warning", okLabel: "Force Push", cancelLabel: "Cancel" },
                  );
                  return approved ? repository<Snapshot>(root, { kind: "force_push", plan }) : null;
                }, () => setNotice("Force push completed."));
              }}
              onAction={(action) =>
                runGitAction(
                  action,
                  {
                    save_https_credential: "HTTPS credentials saved. Try Push again.",
                    set_origin: "Origin updated. Fetch to refresh remote commits.",
                    fetch: "Fetch completed.",
                    pull: "Pull completed.",
                    push: "Push completed.",
                    publish_branch: "Branch published and upstream set.",
                    branch: "Branch created.",
                    rename_branch: "Branch renamed.",
                    tag: "Tag created.",
                    merge: "Merge completed.",
                    stash: "Changes stashed.",
                  }[action.kind],
                )
              }
            />
          </div>
        </div>
      )}
      {stashReview && stashReview.root === root && <StashPreviewDialog key={stashReview.root + stashReview.stash.hash}
        root={stashReview.root} stash={stashReview.stash} disabled={busy}
        onClose={() => setStashReview(null)}
        onApply={async () => {
          let applied = false;
          await update(async () => {
            setView("changes"); setSelection(null);
            try { return await repository<Snapshot>(stashReview.root, { kind: "apply_stash", hash: stashReview.stash.hash }); }
            catch (failure) {
              const next = await repository<Snapshot>(null, { kind: "open", folder: stashReview.root }).catch(() => null);
              if (next) setRepo(next);
              setStashReview(null);
              throw failure;
            }
          }, () => { applied = true; setStashReview(null); setNotice("Stash applied. The saved stash was kept."); });
          return applied;
        }} />}
      {error && !picker && (
        <div className="banner error" role="alert">
          <CircleAlert size={15} aria-hidden="true" /> <span>{error}</span>
        </div>
      )}
      {repo?.rebasing && (
        <div className="banner cherry-pick-status">
          <GitMerge size={15} aria-hidden="true" />
          <span>Rebase paused. Resolve and stage conflicts in File Status, then continue.</span>
          {view !== "changes" && <button type="button" onClick={() => {
            setView("changes");
            setPanels((current) => ({ ...current, list: true }));
            setSelection(null);
          }}>File Status</button>}
          <button type="button" disabled={busy || conflicts.length > 0}
            onClick={() => runGitAction({ kind: "continue_rebase" }, "Rebase completed.", true)}>
            Continue rebase
          </button>
          <button type="button" disabled={busy}
            onClick={() => runGitAction({ kind: "abort_rebase" }, "Rebase aborted.")}>
            Abort rebase
          </button>
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
      {(notice || resetWarning) && (
        <div className="success-notice" key={resetWarning || notice}>
          <div className="success-notice-content">
            <div className={resetWarning ? "banner error" : "banner"} role={resetWarning ? "alert" : "status"}>
              {resetWarning ? <CircleAlert size={15} aria-hidden="true" /> : <CircleCheck size={15} aria-hidden="true" />}
              <span>{resetWarning || notice}</span>
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
          data-list={listVisible ? (graphOnly ? "graph" : "open") : "closed"}
          data-resizing-diff={resizingDiff}
          style={{
            "--graph-list-width": `${laneX(graph.width - 1, true) + lanePadding + 20}px`,
            "--history-list-width": view === "history" ? `${laneX(graph.width - 1) + lanePadding + 245}px` : undefined,
            "--preferred-list-width": preferredWidth == null ? undefined : `${preferredWidth}px`,
          } as CSSProperties}
        >
          <RepositorySidebar
            {...repo}
            newOriginBranches={newOriginBranches[repo.root] ?? []}
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
            onDeleteTag={(name) => {
              void update(async () => {
                const approved = await confirm(
                  `Delete the local tag "${name}"?`,
                  { title: "Delete tag", kind: "warning", okLabel: "Delete tag", cancelLabel: "Cancel" },
                );
                return approved ? repository<Snapshot>(root, { kind: "delete_tag", name }) : null;
              }, () => setNotice(`Deleted local tag ${name}.`));
            }}
            onApplyStash={(stash) => setStashReview({ root: repo.root, stash })}
            onDeleteStash={(stash) => {
              void update(async () => {
                const approved = await confirm(`Delete "${stash.name}"? This permanently removes the saved stash.`,
                  { title: "Delete stash", kind: "warning", okLabel: "Delete stash", cancelLabel: "Cancel" });
                return approved ? repository<Snapshot>(root, { kind: "delete_stash", hash: stash.hash }) : null;
              }, () => { setSelection(null); setNotice("Stash deleted."); });
            }}
            onRenameBranch={setRenameBranch}
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
            onPullPreview={(branch) => setPullPreview(branch ? { root, branch } : null)}
            onRemoteBranch={(ref) => {
              acknowledgeOriginBranch(ref.name);
              setHistoryListVisible(true);
              setHistoryScroll({ hash: ref.hash });
              setHistoryBranch(ref.name);
              setView("history");
              setPanels((current) => ({ ...current, list: true }));
              setSelection({ kind: "show", hash: ref.hash });
            }}
            onView={(next) => {
              setHistoryScroll(null);
              setHistoryBranch(null);
              setView(next);
              setPanels((current) => ({ ...current, list: true }));
              setSelection(null);
            }}
            onCommit={(hash) => {
              setHistoryListVisible(true);
              setHistoryScroll({ hash });
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
                <span className="history-count" title={locatingRebase ? "Finding rebase commits…" : locatingCommit ? "Finding branch commit…" : "Loaded commits"}>
                  {(locatingCommit || locatingRebase) && (
                    <span role="status" aria-label={locatingRebase ? "Finding rebase commits" : "Finding branch commit"}>
                      <LoaderCircle size={11} className="spin" aria-hidden="true" />
                    </span>
                  )}
                  {commits?.length ?? 0}
                </span>
              )}
            </h2>
            {view === "history" && !graphOnly && (
              <div className="history-context" title={remoteHash ? historyBranch ?? repo.branch : repo.branch}>
                <GitBranch size={13} aria-hidden="true" />
                <span>{remoteHash ? historyBranch : repo.branch}</span>
                <small>{commits?.length ?? 0} commits loaded</small>
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
                {discardable.length > 0 && (
                  <div className="discard-toolbar" role="group" aria-label="Discard changes">
                    <div className="discard-toolbar-status">
                      <span role="status">
                        <strong>{selectedForDiscard.length}</strong> of {discardable.length} selected
                      </span>
                      {selectedForDiscard.length > 0 && (
                        <button type="button" className="discard-clear-selection" disabled={busy}
                          onClick={() => setDiscardSelection(new Set())}>
                          Clear selection
                        </button>
                      )}
                    </div>
                    <div className="discard-toolbar-actions">
                      <button type="button" className="discard-selected-button"
                        disabled={busy || !selectedForDiscard.length}
                        aria-busy={discarding?.mode === "selected"}
                        onClick={() => discardFiles(selectedForDiscard, "selected")}>
                        {discarding?.mode === "selected"
                          ? <LoaderCircle size={13} className="spin" aria-hidden="true" />
                          : <Undo2 size={13} aria-hidden="true" />}
                        Discard selected
                      </button>
                      <button type="button" className="discard-all-button"
                        disabled={busy}
                        aria-busy={discarding?.mode === "all"}
                        onClick={() => discardFiles(discardable, "all")}>
                        {discarding?.mode === "all"
                          ? <LoaderCircle size={13} className="spin" aria-hidden="true" />
                          : <Trash2 size={13} aria-hidden="true" />}
                        Discard all
                      </button>
                    </div>
                  </div>
                )}
                <div className="sidebar-scroll file-status-list">
                  {conflicts.length > 0 && changeGroup("Conflicts", conflicts, false, true)}
                  {changeGroup("Unstaged", unstaged, false)}
                  {changeGroup("Staged", staged, true)}
                </div>
                <form
                  className="commit-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (busy || generatedMessage.working || repo.rebasing || conflicts.length || !staged.length || !message.trim()) return;
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
                  <div className="commit-message-header">
                    <label htmlFor="commit-message">
                      <GitCommitHorizontal size={16} aria-hidden="true" /> Commit message
                    </label>
                    <CommitGenerateButton
                      disabled={busy || generatedMessage.working || repo.rebasing || conflicts.length > 0 || !staged.length}
                      working={generatedMessage.working} ready={generatedMessage.aiReady}
                      useModel={generatedMessage.useModel} onGenerator={generatedMessage.setUseModel}
                      modelId={generatedMessage.modelId} onModel={generatedMessage.setModelId}
                      detail={generatedMessage.detail} onDetail={generatedMessage.setDetail}
                      onGenerate={() => void generatedMessage.generate()} />
                  </div>
                  {generatedMessage.error && (
                    <div className="commit-message-error" role="alert">
                      <CircleAlert size={13} aria-hidden="true" />
                      <span>{generatedMessage.error}</span>
                    </div>
                  )}
                  {generatedMessage.modelResponse && (
                    <details className="commit-model-response">
                      <summary>View AI response</summary>
                      <pre>{generatedMessage.modelResponse}</pre>
                    </details>
                  )}
                  <textarea
                    id="commit-message"
                    placeholder="Describe your changes"
                    rows={generatedMessage.detail === "short" ? 3 : 7}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                  />
                  <button
                    className="primary"
                    disabled={busy || generatedMessage.working || repo.rebasing || conflicts.length > 0 || !staged.length || !message.trim()}
                    aria-describedby={conflicts.length ? "commit-conflict-help" : undefined}
                  >
                    <GitCommitHorizontal size={15} aria-hidden="true" />
                    {staged.length
                      ? `Commit ${staged.length} staged ${staged.length === 1 ? "file" : "files"}`
                      : "Commit"}
                  </button>
                  {conflicts.length > 0 && (
                    <p className="commit-conflict-help" id="commit-conflict-help" role="status">
                      Resolve {conflicts.length} {conflicts.length === 1 ? "conflict" : "conflicts"} before committing.
                    </p>
                  )}
                </form>
              </>
            ) : (
              <div className={`sidebar-scroll history${view === "search" ? " history-search" : ""}`} tabIndex={0} aria-label="Commit history list">
                {!commits?.length && (
                  <p className="group-empty">
                    {loadedHistory?.error ?? (remoteHash && !loadedHistory ? "Loading history…" : "No commits yet")}
                  </p>
                )}
                {graphCommits.map((commit, index) => {
                  if (commit.hash === previewHash) {
                    const description = `${pendingPicks.length} staged cherry-pick${pendingPicks.length === 1 ? "" : "s"}`;
                    return (
                      <button type="button" {...graphMenuEvents(commit)} key={previewHash} title={`Pending commit · ${description}`}
                        aria-label={`Review pending commit · ${description}`}
                        onClick={() => pendingPickDialog.current?.showModal()}>
                        <CommitGraphRow row={graph.rows[index]} width={graph.width} compact={graphOnly}
                          localOnly isHead={false} author="" theme={theme} />
                        {!graphOnly && <span className="commit-details">
                          <strong>Pending commit</strong>
                          <small className="commit-meta">{description} · View sources</small>
                        </span>}
                      </button>
                    );
                  }
                  const incomingLabel = commit.incoming ? "Incoming · " : "";
                  const pickOrder = pendingPicks.findIndex((pick) => pick.hash === commit.hash) + 1;
                  return (
                    <button
                      className={
                        selection?.kind === "show" &&
                        selection.hash === commit.hash
                          ? "selected"
                          : ""
                      }
                      key={commit.hash}
                      {...(view === "history" ? graphMenuEvents(commit) : {})}
                      data-commit-hash={commit.hash}
                      data-pending-pick={pickOrder || undefined}
                      data-head={commit.hash === repo.head ? "true" : undefined}
                      aria-current={commit.hash === repo.head ? "true" : undefined}
                      aria-label={graphOnly ? `${incomingLabel}${commit.subject || "Untitled commit"} · ${commit.hash.slice(0, 7)}` : undefined}
                      title={graphOnly ? `${commit.hash === repo.head ? "HEAD · " : ""}${incomingLabel}${commit.subject || "Untitled commit"} · ${commit.hash.slice(0, 7)}` : undefined}
                      aria-pressed={
                        selection?.kind === "show" &&
                        selection.hash === commit.hash
                      }
                      style={
                        view === "history" && !graphOnly
                          ? { minWidth: laneX(graph.width - 1) + lanePadding + 122 }
                          : undefined
                      }
                      onClick={() => {
                        setNewOriginBranches((current) => {
                          const matching = new Set(repo.remote_branches.filter((ref) => ref.hash === commit.hash).map((ref) => ref.name));
                          return { ...current, [repo.root]: (current[repo.root] ?? []).filter((name) => !matching.has(name)) };
                        });
                        setSelection({ kind: "show", hash: commit.hash });
                      }}
                    >
                      {view === "history" && (
                        <CommitGraphRow
                          row={graph.rows[index]}
                          width={graph.width}
                          compact={graphOnly}
                          localOnly={commit.local_only}
                          incoming={commit.incoming}
                          incomingForPull={commit.incoming_for_pull}
                          incomingBranches={commit.incoming_branches}
                          pullPreviewBranch={pullPreview?.root === root ? pullPreview?.branch : undefined}
                          pulling={pullingRoot === repo.root}
                          pushingHashes={pushingHashes}
                          rebaseHashes={rebaseGraph && !locatingRebase ? rebaseHashes : undefined}
                          syncedHashes={graphSync?.root === repo.root ? graphSync.hashes : undefined}
                          onCheckoutPulseEnd={() => setCheckoutPulse((current) => current?.id === checkoutPulse?.id ? null : current)}
                          checkoutPulse={checkoutPulse?.root === repo.root && checkoutPulse.hash === commit.hash ? checkoutPulse.id : undefined}
                          isHead={commit.hash === repo.head}
                          author={commit.author}
                          theme={theme}
                        />
                      )}
                      {pickOrder > 0 && (
                        <span className="pending-pick-marker" title={`Cherry-pick ${pickOrder} · pending commit`}>
                          <GitPullRequestArrow size={11} aria-hidden="true" />
                          {pickOrder}
                        </span>
                      )}
                      {!graphOnly && <span className="commit-details">
                        <span className="commit-title">
                          <strong title={view === "search" ? commit.subject : undefined}>
                            {commit.subject || "Untitled commit"}
                          </strong>
                          {commit.incoming && (
                            <span className="merge-badge incoming-badge" title="Commit available from the tracked branch">
                              <ArrowDownToLine size={11} aria-hidden="true" />
                              Incoming
                            </span>
                          )}
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
                              const recent = repo.recent_origin_branches.find((branch) => branch.name === ref);
                              const Icon = kind === "tag" ? Tag : kind === "remote" ? Cloud : GitBranch;
                              const label = {
                                tag: "Tag",
                                current: "Current checkout",
                                remote: "Remote branch",
                                local: "Local branch",
                              }[kind];
                              return (
                                <span className="commit-ref" data-kind={kind} key={ref} title={`${label} · ${ref}${recent ? ` · Latest commit by ${recent.author} · ${new Date(recent.date).toLocaleString()}` : ""}`}>
                                  <Icon size={10} aria-hidden="true" />
                                  <span><span className="commit-ref-kind">{label} </span>{ref}</span>
                                  {(newOriginBranches[repo.root] ?? []).includes(ref) && <span className="new-origin-branch">New branch</span>}
                                </span>
                              );
                            })}
                          </span>
                        )}
                      </span>}
                    </button>
                  );
                })}
                {view === "search" && !!commits?.length && !graphCommits.length && !canLoadOlder && (
                  <p className="group-empty">No matching commits.</p>
                )}
                {!!commits?.length && (
                  <div className="history-pagination" ref={historyEnd}>
                    {older?.error ? (
                      <button type="button" title={older.error} onClick={() => setOlderHistory({ ...older, error: undefined })}>Retry</button>
                    ) : older?.loading ? (
                      <span role="status" aria-label="Loading older commits">
                        <LoaderCircle size={16} className="spin" aria-hidden="true" />
                      </span>
                    ) : !canLoadOlder ? <span role="img" aria-label="End of history" title="End of history">
                      <ArrowDownToLine size={15} aria-hidden="true" />
                    </span> : null}
                  </div>
                )}
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
          <section className="diff-panel" aria-label="Diff" aria-busy={loadingDiff} ref={diffPanel}>
            <header>
              <button
                className="diff-list-toggle"
                type="button"
                title={`${listVisible ? "Hide" : "Show"} ${history ? "commit list" : "file and commit list"}`}
                aria-label={`${listVisible ? "Hide" : "Show"} ${history ? "commit list" : "file and commit list"}`}
                aria-controls="workspace-list"
                aria-expanded={listVisible}
                onClick={() => {
                  if (history) setHistoryListVisible((visible) => !visible);
                  else setPanels((current) => ({ ...current, list: !current.list }));
                }}
              >
                {listVisible ? <PanelLeftClose size={15} aria-hidden="true" /> : <PanelLeftOpen size={15} aria-hidden="true" />}
              </button>
              {diffSelection?.kind === "show" ? (
                <GitCommitHorizontal size={16} aria-hidden="true" />
              ) : (
                <FileDiff size={16} aria-hidden="true" />
              )}
              <strong>
                {diffSelection?.kind === "diff"
                  ? diffSelection.path
                  : diffSelection?.kind === "show"
                    ? <code title={diffSelection.hash}>{diffSelection.hash.slice(0, 12)}</code>
                    : "Diff"}
              </strong>
              {diffSelection?.kind === "diff" && (
                <span className="diff-context">
                  {diffSelection.staged ? "Staged" : "Working tree"}
                </span>
              )}
              {diffSelection?.kind === "show" && diff && (
                <CommitActions key={diffSelection.hash} inert={loadingDiff}>
                  {commitCommands(repo, diffSelection.hash, selectedCommit)}
                </CommitActions>
              )}
            </header>
            {loadingDiff && !displayedDiff ? (
              <p className="diff-empty">
                <LoaderCircle size={24} className="spin" aria-hidden="true" />{" "}
                Loading diff…
              </p>
            ) : diff || imagePreview ? (
              <DiffFiles
                key={JSON.stringify(diffSelection)}
                text={diff}
                preview={imagePreview}
                historyRoot={diffSelection?.kind === "show" ? root ?? undefined : undefined}
                commit={selectedCommit}
                hunkAction={diffSelection?.kind === "diff" && !diffSelection.untracked ? {
                  label: diffSelection.staged ? "Unstage hunk" : "Stage hunk",
                  disabled: busy,
                  apply: (hunk) => void update(
                    () => repository<Snapshot>(root, {
                      kind: "apply_hunk",
                      path: diffSelection.path,
                      staged: diffSelection.staged,
                      expected_diff: diff,
                      hunk,
                    }),
                    () => setNotice(diffSelection.staged ? "Hunk unstaged." : "Hunk staged."),
                  ),
                } : undefined}
              />
            ) : (
              <p className="diff-empty">
                {view === "history" ? (
                  <History size={26} aria-hidden="true" />
                ) : (
                  <FileDiff size={26} aria-hidden="true" />
                )}
                {diffSelection
                  ? "No textual diff available."
                  : view === "changes"
                    ? "Select a changed file to review its diff."
                    : "Select a commit to inspect its changes."}
              </p>
            )}
          </section>
        </div>
      )}
      {rebaseReview && (
        <dialog ref={rebaseDialog} className="repo-picker repository-action-picker"
          aria-labelledby="rebase-review-title" onClose={() => setRebaseReview(null)}>
          <header>
            <GitMerge size={18} aria-hidden="true" />
            <h2 id="rebase-review-title">Rebase onto upstream</h2>
          </header>
          <div className="repo-picker-content git-action-form">
            <p>Reapply {rebaseReview.preview.commits.length} local commit(s) on the upstream of <strong>{rebaseReview.repo.branch}</strong>. Replayed commits receive new IDs.</p>
            <RebaseSequence preview={rebaseReview.preview} theme={theme} commits={commits} />
            <footer>
              <button type="button" onClick={() => rebaseDialog.current?.close()}>Cancel</button>
              <button type="button" className="primary" disabled={busy || repo !== rebaseReview.repo || !rebaseReview.preview.commits.length} onClick={() => {
                const { branch, head } = rebaseReview.repo;
                if (!head) return;
                rebaseDialog.current?.close();
                runGitAction({ kind: "rebase_upstream", branch, head, upstream: rebaseReview.preview.upstream }, "Rebase completed.", true);
              }}>Rebase</button>
            </footer>
          </div>
        </dialog>
      )}
      {graphMenu && repo && createPortal(
        <div
          ref={graphMenuRef}
          className="diff-commit-menu-items graph-context-menu"
          role="group"
          aria-label="Commit actions"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            graphMenu.trigger.focus();
            setGraphMenu(null);
          }}
          onClick={(event) => {
            if (!(event.target as Element).closest("button:not(:disabled)")) return;
            setGraphMenu(null);
          }}
        >
          <div className="graph-menu-heading">
            <strong title={graphMenu.commit.subject}>
              {graphMenu.commit.hash === previewHash ? "Pending commit" : graphMenu.commit.subject || "Untitled commit"}
            </strong>
            {graphMenu.commit.hash !== previewHash && <code>{graphMenu.commit.hash.slice(0, 7)}</code>}
          </div>
          {graphMenu.commit.hash === previewHash ? (
            <>
              <button type="button" onClick={() => pendingPickDialog.current?.showModal()}><GitPullRequestArrow size={14} aria-hidden="true" /> View sources</button>
              <button type="button" onClick={() => {
                setSelection(null);
                setPanels((current) => ({ ...current, list: true }));
                setView("changes");
              }}><FileDiff size={14} aria-hidden="true" /> Review staged files</button>
            </>
          ) : commitCommands(repo, graphMenu.commit.hash, graphMenu.commit)}
        </div>,
        document.body,
      )}
      {pendingPicks.length > 0 && (
        <dialog ref={pendingPickDialog} className="repo-picker repository-action-picker pending-pick-dialog" aria-labelledby="pending-pick-title">
          <header>
            <GitPullRequestArrow size={18} aria-hidden="true" />
            <h2 id="pending-pick-title">Pending commit</h2>
            <button type="button" className="repo-picker-close" aria-label="Close pending commit" onClick={() => pendingPickDialog.current?.close()}>×</button>
          </header>
          <div className="repo-picker-content git-action-form">
            <div className="pending-pick-target">
              <GitBranch size={16} aria-hidden="true" />
              <div>
                <small>Destination branch</small>
                <strong>{repo?.branch}</strong>
              </div>
            </div>
            <h3 id="pending-pick-sources-title">
              Applied cherry-picks <span>{pendingPicks.length}</span>
            </h3>
            <ol className="pending-pick-sources" aria-labelledby="pending-pick-sources-title">
              {pendingPicks.map((pick, index) => (
                <li key={`${pick.hash}-${index}`}>
                  <span className="pending-pick-order" aria-hidden="true">{index + 1}</span>
                  <div>
                    <strong>{pick.subject || "Untitled commit"}</strong>
                    <code title={pick.hash}>{pick.hash.slice(0, 7)}</code>
                  </div>
                </li>
              ))}
            </ol>
            <footer>
              <button type="button" className="primary" onClick={() => {
                pendingPickDialog.current?.close();
                setSelection(null);
                setPanels((current) => ({ ...current, list: true }));
                setView("changes");
              }}><FileDiff size={15} aria-hidden="true" /> Review staged files</button>
            </footer>
          </div>
        </dialog>
      )}
      {conflictMenu && conflictFile && createPortal(
        <div ref={conflictMenuRef} className="graph-context-menu diff-commit-menu-items resolve-context-menu"
          role="group" aria-label="Resolve conflict"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            conflictMenu.trigger.focus({ preventScroll: true });
            setConflictMenu(null);
          }}>
          <div className="graph-menu-heading">
            <strong>Resolve conflict</strong>
            <code>{conflictFile.path}</code>
          </div>
            {([
              ["current", repo?.rebasing ? "Keep upstream side" : "Keep current", repo?.rebasing ? "Use the file from the rebased history so far, then stage it." : `Use the entire file from ${repo?.branch ?? "the current branch"}, then stage it.`, GitBranch, conflictFile.index === "D"],
              ["incoming", repo?.rebasing ? "Keep replayed commit" : "Accept incoming", repo?.rebasing ? "Use the file from the local commit being replayed, then stage it." : "Use the entire file from the incoming commit, then stage it.", Download, conflictFile.worktree === "D"],
              ["mark_resolved", "Mark as resolved", "Stage the file as it is now. Choose this after editing it yourself.", CircleCheck, false],
            ] as const).map(([resolution, label, description, Icon, deletes]) => (
              <button key={resolution} className="resolve-option" type="button" disabled={busy} onClick={() => {
                const { path } = conflictFile;
                conflictMenu.trigger.focus({ preventScroll: true });
                setConflictMenu(null);
                void update(async () => {
                  if (resolution !== "mark_resolved") {
                    const approved = await confirm(
                      deletes ? `Delete "${path}" and stage the deletion?` : `Replace "${path}" with the selected version and stage it?`,
                      { title: label, kind: "warning", okLabel: label, cancelLabel: "Cancel" },
                    );
                    if (!approved) return null;
                  }
                  return repository<Snapshot>(root, { kind: "resolve_conflict", path, resolution });
                }, () => {
                  setSelection(null);
                  setNotice(`Resolved ${path}.`);
                });
              }}>
                <Icon size={17} aria-hidden="true" />
                <span>
                  <strong>{label}</strong>
                  <small>{deletes ? "Remove this file and stage the deletion." : description}</small>
                </span>
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            ))}
        </div>,
        document.body,
      )}
      {cherryPick && repo && (
        <CherryPickDialog
          commit={cherryPick}
          branch={repo.branch}
          head={repo.head}
          onClose={() => setCherryPick(null)}
          onApply={(mainline, noCommit) => {
            setCherryPick(null);
            runGitAction(
              { kind: "cherry_pick", hash: cherryPick.hash, mainline, no_commit: noCommit },
              noCommit ? "Cherry-pick changes staged for review." : "Commit cherry-picked.",
              true,
              noCommit ? cherryPick : undefined,
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
