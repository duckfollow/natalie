export type Commit = {
  hash: string;
  author: string;
  date: string;
  subject: string;
  parents: string[];
  refs: string;
  local_only: boolean;
};

type Lane = { hash: string; color: number; dashed?: boolean };
type Edge = {
  from: number;
  to: number;
  color: number;
  part: "top" | "bottom";
  merge?: boolean;
  dashed?: boolean;
};

export function layoutHistory(commits: Commit[]) {
  const remaining = new Set(commits.map(({ hash }) => hash));
  let lanes: Lane[] = [];
  let nextColor = 0;
  let width = 1;
  const rows = commits.map((commit) => {
    remaining.delete(commit.hash);
    let index = lanes.findIndex(({ hash }) => hash === commit.hash);
    const entering = index !== -1;
    if (!entering) {
      index = lanes.length;
      lanes.push({ hash: commit.hash, color: nextColor++ });
    }
    const current = lanes[index];
    const next = lanes.filter(({ hash }) => hash !== commit.hash);
    const edges: Edge[] = [];
    for (const [from, lane] of lanes.entries()) {
      if (from !== index || entering) {
        edges.push({ from, to: from, color: lane.color, dashed: lane.dashed, part: "top" });
      }
    }
    const isMerge = commit.parents.length > 1;
    const parents = commit.parents.filter((hash) => remaining.has(hash));
    parents.forEach((hash, parentIndex) => {
      if (next.some((lane) => lane.hash === hash)) return;
      const lane = {
        hash,
        dashed: commit.local_only,
        color: parentIndex === 0 ? current.color : nextColor++,
      };
      if (parentIndex === 0) next.splice(index, 0, lane);
      else next.push(lane);
    });
    for (const [from, lane] of lanes.entries()) {
      if (from === index) continue;
      const to = next.indexOf(lane);
      edges.push({ from, to, color: lane.color, dashed: lane.dashed, part: "bottom" });
    }
    for (const hash of parents) {
      const to = next.findIndex((lane) => lane.hash === hash);
      edges.push({
        from: index,
        to,
        color: next[to].color,
        part: "bottom",
        merge: isMerge,
        dashed: commit.local_only,
      });
    }
    width = Math.max(width, lanes.length, next.length);
    lanes = next;
    return { index, color: current.color, edges, isMerge };
  });
  return { width, rows };
}
