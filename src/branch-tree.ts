export interface BranchFolder<T> {
  name: string;
  path: string;
  folders: Map<string, BranchFolder<T>>;
  branches: T[];
}

const names = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function buildBranchTree<T extends { name: string }>(references: readonly T[], prefix = ""): BranchFolder<T> {
  const root: BranchFolder<T> = { name: prefix, path: prefix, folders: new Map(), branches: [] };
  for (const reference of references) {
    const relative = prefix ? reference.name.slice(prefix.length + 1) : reference.name;
    const parts = relative.split("/");
    let folder = root;
    for (const name of parts.slice(0, -1)) {
      let child = folder.folders.get(name);
      if (!child) {
        child = { name, path: folder.path ? `${folder.path}/${name}` : name, folders: new Map(), branches: [] };
        folder.folders.set(name, child);
      }
      folder = child;
    }
    folder.branches.push(reference);
  }
  function sort(folder: BranchFolder<T>) {
    folder.branches.sort((a, b) => names.compare(a.name, b.name) || a.name.localeCompare(b.name));
    folder.folders = new Map([...folder.folders].sort(([a], [b]) => names.compare(a, b) || a.localeCompare(b)));
    folder.folders.forEach(sort);
  }
  sort(root);
  return root;
}
