import { RepositorySettings } from "./RepositorySettings";
import { buildBranchTree, type BranchFolder } from "./branch-tree";
import { RepositoryInfo } from "./RepositoryInfo";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Cloud,
  FileDiff,
  Folder,
  GitBranch,
  History,
  Layers3,
  Monitor,
  Package,
  Pencil,
  Search,
  Tag,
  Trash2,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { createPortal } from "react-dom";

export type WorkspaceView = "changes" | "history" | "search";
export type Reference = { name: string; hash: string };
export type RecentOriginBranch = Reference & { author: string; date: string };
export type LocalBranch = Reference & { ahead: number | null; behind: number | null };

function Section({
  label,
  icon,
  children,
  open = false,
  onExpand,
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
  open?: boolean;
  onExpand?: () => void;
}) {
  return (
    <details className="repo-nav-section" open={open}>
      <summary
        title={label}
        aria-label={label}
        onClick={(event) => {
          if (!onExpand) return;
          event.preventDefault();
          const section = event.currentTarget.parentElement as HTMLDetailsElement;
          section.open = true;
          onExpand();
        }}
      >
        {icon}
        <span>{label}</span>
        <ChevronRight size={13} />
      </summary>
      <div className="repo-nav-items">{children}</div>
    </details>
  );
}

export function RepositorySidebar({
  root,
  view,
  collapsed,
  onExpand,
  branch,
  branches,
  tags,
  remotes,
  remote_branches,
  recent_origin_branches,
  newOriginBranches,
  historyBranch,
  onRemoteBranch,
  onPullPreview,
  onCheckoutBranch,
  onRenameBranch,
  onDeleteBranch,
  onDeleteTag,
  onApplyStash,
  onDeleteStash,
  busy,
  stashes,
  submodules,
  onView,
  onCommit,
}: {
  root: string;
  view: WorkspaceView;
  collapsed: boolean;
  onExpand: () => void;
  branch: string;
  branches: LocalBranch[];
  tags: Reference[];
  remotes: string[];
  remote_branches: Reference[];
  recent_origin_branches: RecentOriginBranch[];
  newOriginBranches: string[];
  historyBranch: string | null;
  onPullPreview: (branch: string | null) => void;
  onRemoteBranch: (ref: Reference) => void;
  onDeleteTag: (tag: string) => void;
  onApplyStash: (stash: Reference) => void;
  onDeleteStash: (stash: Reference) => void;
  onRenameBranch: (branch: string) => void;
  onDeleteBranch: (branch: string) => void;
  onCheckoutBranch: (branch: string, remote?: string) => void;
  busy: boolean;
  stashes: Reference[];
  submodules: string[];
  onView: (view: WorkspaceView) => void;
  onCommit: (hash: string) => void;
}) {
  const [menu, setMenu] = useState<{
    tag: boolean;
    stash?: Reference;
    remote?: string;
    branch: string;
    x: number;
    y: number;
    trigger: HTMLButtonElement;
  } | null>(null);
  const menuContainer = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = menuContainer.current;
    if (!menu || !container) return;
    const { width, height } = container.getBoundingClientRect();
    container.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - width - 8))}px`;
    container.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - height - 8))}px`;
    container.querySelector("button")?.focus({ preventScroll: true });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    function dismiss(event: PointerEvent) {
      if (!menuContainer.current?.contains(event.target as Node)) setMenu(null);
    }
    function close() {
      setMenu(null);
    }
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  function openCheckoutMenu(
    trigger: HTMLButtonElement,
    remote: string | undefined,
    branch: string,
    x: number,
    y: number,
    tag = false,
  ) {
    setMenu({
      trigger,
      tag,
      remote,
      branch,
      x,
      y,
    });
  }

  const refButton = (ref: Reference & Partial<LocalBranch>, label = ref.name, current = false, activate = () => onCommit(ref.hash), checkout?: { branch: string; remote?: string; tag?: boolean }) => {
    const behind = ref.behind ?? 0;
    const ahead = ref.ahead ?? 0;
    const recent = recent_origin_branches.find((branch) => branch.name === ref.name);
    const description = [
      ref.name,
      recent ? `Latest commit by ${recent.author} · ${new Date(recent.date).toLocaleString()}` : "",
      newOriginBranches.includes(ref.name) ? "New branch" : "",
      behind > 0 ? `Pull ${behind}` : "",
      ahead > 0 ? `Push ${ahead}` : "",
    ].filter(Boolean).join(" · ");
    return (
      <button
        type="button"
        key={ref.name}
        className={`repo-reference${current ? " current-branch" : ""}`}
        aria-label={description}
        title={description}
        aria-current={current ? "true" : undefined}
        onClick={activate}
        aria-haspopup={checkout ? "menu" : undefined}
        onContextMenu={checkout ? (event: MouseEvent<HTMLButtonElement>) => {
          event.preventDefault();
          openCheckoutMenu(event.currentTarget, checkout.remote, checkout.branch, event.clientX, event.clientY, checkout.tag);
        } : undefined}
        onKeyDown={checkout ? (event) => {
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
          event.preventDefault();
          const bounds = event.currentTarget.getBoundingClientRect();
          openCheckoutMenu(event.currentTarget, checkout.remote, checkout.branch, bounds.left, bounds.bottom, checkout.tag);
        } : undefined}
      >
        {checkout && !checkout.tag && !checkout.remote && <span className="checked-out-dot" aria-hidden="true" />}
        <span className="repo-reference-name">{label}</span>
        {newOriginBranches.includes(ref.name) && <span className="new-origin-branch">New branch</span>}
        {(behind > 0 || ahead > 0) && (
          <span className="repo-branch-status" aria-hidden="true">
            {behind > 0 && <span
              data-pull-count
              title={`Pull ${behind}`}
              onMouseEnter={() => onPullPreview(ref.name)}
              onMouseLeave={() => onPullPreview(null)}
            >
              <ArrowDown size={11} />{behind}
            </span>}
            {ahead > 0 && <span title={`Push ${ahead}`}><ArrowUp size={11} />{ahead}</span>}
          </span>
        )}
      </button>
    );
  };
  const remoteGroups = new Map<string, Reference[]>();
  const remoteNames = [...remotes].sort((a, b) => b.length - a.length);
  for (const ref of remote_branches) {
    const remote = remoteNames.find((name) => ref.name.startsWith(name + "/"));
    if (remote) remoteGroups.set(remote, [...(remoteGroups.get(remote) ?? []), ref]);
  }
  function renderBranches<T extends Reference>(tree: BranchFolder<T>, remote?: string): ReactNode {
    const selected = remote ? historyBranch : branch;
    return <>
      {tree.branches.map((ref) => refButton(
        ref,
        ref.name.split("/").at(-1)!,
        ref.name === selected,
        remote ? () => onRemoteBranch(ref) : undefined,
        { branch: remote ? ref.name.slice(remote.length + 1) : ref.name, remote },
      ))}
      {[...tree.folders.values()].map((folder) => (
        <details className="repo-branch-folder" key={folder.path}
          open={!!selected && selected.startsWith(folder.path + "/")}>
          <summary title={folder.path}>
            <ChevronRight size={12} />
            <Folder size={14} />
            <span className="repo-reference-name">{folder.name}</span>
            {remote && newOriginBranches.some((name) => name.startsWith(folder.path + "/")) &&
              <span className="branch-folder-new" title="Contains new branches" aria-label="Contains new branches" />}
          </summary>
          <div className="repo-branch-children">{renderBranches(folder, remote)}</div>
        </details>
      ))}
    </>;
  }
  const expandSection = collapsed ? onExpand : undefined;
  return (
    <aside
      id="repository-navigation"
      className="repo-navigation"
      aria-label="Repository navigation"
      tabIndex={0}
    >
      <div className="repo-navigation-scroll">
        <div className="repo-nav-section">
          <h2>
            <Monitor size={15} /> Workspace
          </h2>
          <div className="repo-nav-items" role="group" aria-label="Workspace">
            <button
              aria-pressed={view === "changes"}
              aria-label="File status"
              title="File status"
              onClick={() => onView("changes")}
            >
              <FileDiff size={14} aria-hidden="true" /> <span>File status</span>
            </button>
            <button
              aria-pressed={view === "history"}
              aria-label="History"
              title="History"
              onClick={() => onView("history")}
            >
              <History size={14} aria-hidden="true" /> <span>History</span>
            </button>
            <button
              aria-pressed={view === "search"}
              aria-label="Search"
              title="Search"
              onClick={() => onView("search")}
            >
              <Search size={14} aria-hidden="true" /> <span>Search</span>
            </button>
          </div>
        </div>
        <Section onExpand={expandSection} label="Branches" icon={<GitBranch size={15} />} open>
          {!branches.length && <small>No branches yet</small>}
          {renderBranches(buildBranchTree(branches))}
        </Section>
        <Section onExpand={expandSection} label="Tags" icon={<Tag size={15} />}>
          {tags.length ? (
            tags.map((ref) => refButton(ref, ref.name, false, undefined, { branch: ref.name, tag: true }))
          ) : (
            <small>No tags</small>
          )}
        </Section>
        <Section onExpand={expandSection} label="Remotes" icon={<Cloud size={15} />}>
          {remotes.length ? (
            remotes.map((name) => (
              <details className="repo-branch-folder" key={name} open={!!historyBranch && historyBranch.startsWith(name + "/")}>
                <summary>
                  <ChevronRight size={12} />
                  <Cloud size={14} />
                  <span className="repo-reference-name">{name}</span>
                  {newOriginBranches.some((branch) => branch.startsWith(name + "/")) &&
                    <span className="branch-folder-new" title="Contains new branches" aria-label="Contains new branches" />}
                </summary>
                <div className="repo-branch-children">
                  {renderBranches(buildBranchTree(remoteGroups.get(name) ?? [], name), name)}
                </div>
                {!remoteGroups.has(name) && <small>No fetched branches</small>}
              </details>
            ))
          ) : (
            <small>No remotes</small>
          )}
        </Section>
        <Section onExpand={expandSection} label="Stashes" icon={<Layers3 size={15} />}>
          {stashes.length ? (
            stashes.map((ref) => {
              const match = ref.name.match(/^(stash@\{(\d+)\}) · (?:(?:WIP on|On) ([^:]+): )?(.*)$/s);
              const branchName = match?.[3];
              const message = match?.[4]?.trim() || ref.name;
              return <button type="button" key={ref.hash + ref.name} className="repo-reference repo-stash-row"
                title={ref.name} aria-label={ref.name} onClick={() => onCommit(ref.hash)} aria-haspopup="menu"
                onContextMenu={(event) => { event.preventDefault(); setMenu({ tag: false, stash: ref, branch: ref.name, trigger: event.currentTarget, x: event.clientX, y: event.clientY }); }}
                onKeyDown={(event) => {
                  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
                  event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect();
                  setMenu({ tag: false, stash: ref, branch: ref.name, trigger: event.currentTarget, x: bounds.left, y: bounds.bottom });
                }}>
                <Layers3 className="repo-stash-icon" size={13} aria-hidden="true" />
                <span className="repo-stash-content">
                  <span className="repo-stash-message">{message}</span>
                  <span className="repo-stash-meta">{branchName && <span className="repo-stash-branch"><GitBranch size={10} aria-hidden="true" /><span>{branchName}</span></span>}</span>
                </span>
              </button>;
            })
          ) : (
            <small>No stashes</small>
          )}
        </Section>
        <Section onExpand={expandSection} label="Submodules" icon={<Package size={15} />}>
          {submodules.length ? (
            submodules.map((name) => <span key={name}>{name}</span>)
          ) : (
            <small>No submodules</small>
          )}
        </Section>
      </div>
      <div className="repo-footer-tools"><RepositoryInfo /><RepositorySettings key={root} root={root} /></div>
      {menu && createPortal(
        <div
          ref={menuContainer}
          className="repo-checkout-menu"
          role="menu"
          aria-label={menu.remote ? `${menu.remote}/${menu.branch}` : menu.branch}
          onKeyDown={(event) => {
            if (event.key === "Tab") {
              setMenu(null);
              return;
            }
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              const buttons = Array.from(event.currentTarget.querySelectorAll("button"));
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const direction = event.key === "ArrowUp" ? -1 : 1;
              buttons[(index + direction + buttons.length) % buttons.length]?.focus();
              return;
            }
            if (event.key !== "Escape") return;
            event.preventDefault();
            menu.trigger.focus();
            setMenu(null);
          }}
        >
          <div className="repo-menu-branch" aria-hidden="true" title={menu.remote ? `${menu.remote}/${menu.branch}` : menu.branch}>
            <span>{menu.remote ? `${menu.remote}/${menu.branch}` : menu.branch}</span>
          </div>
          {menu.stash && <>
            <button type="button" role="menuitem" tabIndex={-1} aria-disabled={busy} onClick={() => { if (busy) return; menu.trigger.focus(); setMenu(null); onApplyStash(menu.stash!); }}><Layers3 size={15} />Apply stash</button>
            <button type="button" role="menuitem" className="repo-menu-delete" tabIndex={-1} aria-disabled={busy} onClick={() => { if (busy) return; menu.trigger.focus(); setMenu(null); onDeleteStash(menu.stash!); }}><Trash2 size={15} />Delete stash…</button>
          </>}
          {!menu.stash && !menu.tag && (
          <button
            tabIndex={-1}
            type="button"
            role="menuitem"
            aria-disabled={busy || branch === menu.branch}
            onClick={() => {
              if (busy || branch === menu.branch) return;
              menu.trigger.focus();
              setMenu(null);
              onCheckoutBranch(menu.branch, menu.remote);
            }}
          >
            {branch === menu.branch ? <Check size={15} aria-hidden="true" /> : <GitBranch size={15} aria-hidden="true" />}
            {branch === menu.branch ? "Already checked out" : "Checkout"}
          </button>
          )}
          {!menu.stash && !menu.remote && !menu.tag && (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-disabled={busy}
              onClick={() => {
                if (busy) return;
                menu.trigger.focus();
                setMenu(null);
                onRenameBranch(menu.branch);
              }}
            >
              <Pencil size={15} aria-hidden="true" />
              Rename branch
            </button>
          )}
          {!menu.stash && !menu.remote && (
            <button
              type="button"
              role="menuitem"
              className="repo-menu-delete"
              tabIndex={-1}
              aria-disabled={busy || (!menu.tag && branch === menu.branch)}
              onClick={() => {
                if (busy || (!menu.tag && branch === menu.branch)) return;
                menu.trigger.focus();
                setMenu(null);
                if (menu.tag) onDeleteTag(menu.branch);
                else onDeleteBranch(menu.branch);
              }}
            >
              <Trash2 size={15} aria-hidden="true" />
              {menu.tag ? "Delete tag" : "Delete branch"}
            </button>
          )}
        </div>,
        document.body,
      )}
    </aside>
  );
}
