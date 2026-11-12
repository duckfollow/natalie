import {
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
} from "lucide-react";
import type { ReactNode } from "react";

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
  stashes: Reference[];
  submodules: string[];
  onView: (view: WorkspaceView) => void;
  onCommit: (hash: string) => void;
}) {
  const groups = new Map<string, Reference[]>();
  for (const ref of branches) {
    const slash = ref.name.indexOf("/");
    const group = slash < 0 ? "" : ref.name.slice(0, slash);
    groups.set(group, [...(groups.get(group) ?? []), ref]);
  }
  const refButton = (ref: Reference, label = ref.name, current = false) => (
    <button
      type="button"
      key={ref.name}
      className={`repo-reference${current ? " current-branch" : ""}`}
      aria-label={ref.name}
      title={ref.name}
      aria-current={current ? "true" : undefined}
      onClick={() => onCommit(ref.hash)}
    >
      <span className="repo-reference-name">{label}</span>
    </button>
  );
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
          refButton(ref, ref.name, ref.name === branch),
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
          remotes.map((name) => <span key={name}>{name}</span>)
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
    </aside>
  );
}
