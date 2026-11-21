import { Crown } from "lucide-react";
import { Fragment } from "react";
import type { layoutHistory } from "./history-graph";

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
export const lanePadding = 17;
export const laneX = (lane: number, compact = false) => lanePadding + lane * (compact ? 18 : laneStep);

export function CommitGraphRow({
  row,
  width,
  author,
  theme,
  compact,
  localOnly,
  incoming = false,
  incomingForPull = false,
  incomingBranches = [],
  pullPreviewBranch,
  syncedHashes,
  pulling,
  pushingHashes,
  rebaseHashes,
  isHead,
  checkoutPulse,
  onCheckoutPulseEnd,
}: {
  row: ReturnType<typeof layoutHistory>["rows"][number];
  width: number;
  author: string;
  compact: boolean;
  localOnly: boolean;
  incoming?: boolean;
  incomingForPull?: boolean;
  incomingBranches?: string[];
  pullPreviewBranch?: string;
  syncedHashes?: ReadonlySet<string>;
  pulling?: boolean;
  pushingHashes?: ReadonlySet<string>;
  rebaseHashes?: ReadonlySet<string>;
  isHead: boolean;
  checkoutPulse?: number;
  onCheckoutPulseEnd?: () => void;
  theme: "light" | "dark";
}) {
  const colors = theme === "light" ? lightLaneColors : laneColors;
  const nodeColor = colors[row.color % colors.length];
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
          const replaying = edge.sourceHash != null && rebaseHashes?.has(edge.sourceHash);
          return (
            <Fragment key={index}>
              <path
                d={path}
                stroke={colors[edge.color % colors.length]}
                className={edge.incoming ? "commit-edge-incoming" : undefined}
                data-pulling={pulling && edge.incomingForPull ? true : undefined}
                data-pushing={edge.dashed && edge.sourceHash && pushingHashes?.has(edge.sourceHash) ? true : undefined}
                data-rebase-flow={replaying ? true : undefined}
                data-syncing={!edge.dashed && edge.sourceHash && syncedHashes?.has(edge.sourceHash) ? true : undefined}
                data-incoming-for-pull={edge.incomingForPull || undefined}
                data-branch-pull-preview={pullPreviewBranch && edge.incomingBranches?.includes(pullPreviewBranch) ? true : undefined}
                opacity={compact ? 0.7 : undefined}
                strokeDasharray={edge.dashed || replaying ? "4 3" : undefined}
                strokeWidth={edge.merge && !compact ? 3 : 2}
              />
              {replaying && [1, 2, 3].map((phase) => (
                <path key={phase} className="rebase-flow-layer" data-phase={phase}
                  d={path} stroke={colors[edge.color % colors.length]}
                  strokeWidth={edge.merge && !compact ? 3 : 2}
                  strokeDasharray="4 3" strokeDashoffset={phase * 7 / 4} />
              ))}
            </Fragment>
          );
        })}
      </svg>
      <span
        className={`commit-dot${row.isMerge ? " commit-dot-merge" : ""}${incoming ? " commit-dot-incoming" : ""}`}
        data-incoming-for-pull={incomingForPull || undefined}
        data-branch-pull-preview={pullPreviewBranch && incomingBranches.includes(pullPreviewBranch) ? true : undefined}
        style={{
          left: laneX(row.index, compact),
          background: (localOnly || incoming) ? (compact ? "var(--surface)" : "var(--panel)") : nodeColor,
          border: localOnly || incoming ? `2px solid ${nodeColor}` : undefined,
          color: localOnly || incoming ? nodeColor : undefined,
        }}
      >
        {isHead && (
          <span className="commit-head-crown" aria-hidden="true">
            <Crown size={compact ? 8 : 11} fill="currentColor" />
          </span>
        )}
        {isHead && checkoutPulse != null && <span key={checkoutPulse} className="commit-checkout-pulse" onAnimationEnd={onCheckoutPulseEnd} />}
        {row.isMerge || compact ? null : initials}
      </span>
    </span>
  );
}
