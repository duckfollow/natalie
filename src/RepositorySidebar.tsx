import {
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
  Search,
  Tag,
  Trash2,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { createPortal } from "react-dom";

export type WorkspaceView = "changes" | "history" | "search";
export type Reference = { name: string; hash: string };

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
  view,
  collapsed,
  onExpand,
  branch,
  branches,
  tags,
  remotes,
  remote_branches,
  historyBranch,
  onRemoteBranch,
  onCheckoutBranch,
  onDeleteBranch,
  busy,
  stashes,
  submodules,
  onView,
  onCommit,
}: {
  view: WorkspaceView;
  collapsed: boolean;
  onExpand: () => void;
  branch: string;
  branches: Reference[];
  tags: Reference[];
  remotes: string[];
  remote_branches: Reference[];
  historyBranch: string | null;
  onRemoteBranch: (ref: Reference) => void;
  onDeleteBranch: (branch: string) => void;
  onCheckoutBranch: (branch: string, remote?: string) => void;
  busy: boolean;
  stashes: Reference[];
  submodules: string[];
  onView: (view: WorkspaceView) => void;
  onCommit: (hash: string) => void;
}) {
  const [menu, setMenu] = useState<{
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
  ) {
    setMenu({
      trigger,
      remote,
      branch,
      x,
      y,
    });
  }

  const groups = new Map<string, Reference[]>();
  for (const ref of branches) {
    const slash = ref.name.indexOf("/");
    const group = slash < 0 ? "" : ref.name.slice(0, slash);
    groups.set(group, [...(groups.get(group) ?? []), ref]);
  }
  const refButton = (ref: Reference, label = ref.name, current = false, activate = () => onCommit(ref.hash), checkout?: { branch: string; remote?: string }) => (
    <button
      type="button"
      key={ref.name}
      className={`repo-reference${current ? " current-branch" : ""}`}
      aria-label={ref.name}
      title={ref.name}
      aria-current={current ? "true" : undefined}
      onClick={activate}
      aria-haspopup={checkout ? "menu" : undefined}
      onContextMenu={checkout ? (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        openCheckoutMenu(event.currentTarget, checkout.remote, checkout.branch, event.clientX, event.clientY);
      } : undefined}
      onKeyDown={checkout ? (event) => {
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        openCheckoutMenu(event.currentTarget, checkout.remote, checkout.branch, bounds.left, bounds.bottom);
      } : undefined}
    >
      <span className="repo-reference-name">{label}</span>
    </button>
  );
  const remoteGroups = new Map<string, Reference[]>();
  const remoteNames = [...remotes].sort((a, b) => b.length - a.length);
  for (const ref of remote_branches) {
    const remote = remoteNames.find((name) => ref.name.startsWith(name + "/"));
    if (remote) remoteGroups.set(remote, [...(remoteGroups.get(remote) ?? []), ref]);
  }
  const expandSection = collapsed ? onExpand : undefined;
  return (
    <aside
      id="repository-navigation"
      className="repo-navigation"
      aria-label="Repository navigation"
      tabIndex={0}
    >
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
        {(groups.get("") ?? []).map((ref) =>
          refButton(ref, ref.name, ref.name === branch, undefined, { branch: ref.name }),
        )}
        {[...groups]
          .filter(([group]) => group)
          .map(([group, refs]) => (
            <details
              className="repo-branch-folder"
              key={group}
              open={refs.some((ref) => ref.name === branch)}
            >
              <summary title={group}>
                <ChevronRight size={12} />
                <Folder size={14} />
                <span className="repo-reference-name">{group}</span>
              </summary>
              {refs.map((ref) =>
                refButton(
                  ref,
                  ref.name.slice(group.length + 1),
                  ref.name === branch,
                  undefined,
                  { branch: ref.name },
                ),
              )}
            </details>
          ))}
      </Section>
      <Section onExpand={expandSection} label="Tags" icon={<Tag size={15} />}>
        {tags.length ? (
          tags.map((ref) => refButton(ref))
        ) : (
          <small>No tags</small>
        )}
      </Section>
      <Section onExpand={expandSection} label="Remotes" icon={<Cloud size={15} />}>
        {remotes.length ? (
          remotes.map((name) => (
            <details className="repo-branch-folder" key={name}>
              <summary>
                <ChevronRight size={12} />
                <Cloud size={14} />
                <span className="repo-reference-name">{name}</span>
              </summary>
              {(remoteGroups.get(name) ?? []).map((ref) => {
                const label = ref.name.slice(name.length + 1);
                return refButton(ref, label, ref.name === historyBranch, () => onRemoteBranch(ref), { remote: name, branch: label });
              })}
              {!remoteGroups.has(name) && <small>No fetched branches</small>}
            </details>
          ))
        ) : (
          <small>No remotes</small>
        )}
      </Section>
      <Section onExpand={expandSection} label="Stashes" icon={<Layers3 size={15} />}>
        {stashes.length ? (
          stashes.map((ref) => refButton(ref))
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
          {!menu.remote && (
            <button
              type="button"
              role="menuitem"
              className="repo-menu-delete"
              tabIndex={-1}
              aria-disabled={busy || branch === menu.branch}
              onClick={() => {
                if (busy || branch === menu.branch) return;
                menu.trigger.focus();
                setMenu(null);
                onDeleteBranch(menu.branch);
              }}
            >
              <Trash2 size={15} aria-hidden="true" />
              Delete branch
            </button>
          )}
        </div>,
        document.body,
      )}
    </aside>
  );
}
