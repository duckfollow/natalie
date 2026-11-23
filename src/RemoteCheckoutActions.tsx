import { Cloud } from "lucide-react";

type Reference = { name: string; hash: string };
export function RemoteCheckoutActions({ hash, references, branches, currentBranch, disabled, onCheckout }: {
  hash: string; references: Reference[]; branches: Reference[]; currentBranch: string;
  disabled: boolean; onCheckout: (branch: string) => void;
}) {
  const matches = references.filter(ref => ref.hash === hash && ref.name.startsWith("origin/") && ref.name !== "origin/HEAD");
  return <>{matches.map(ref => {
    const branch = ref.name.slice("origin/".length);
    const local = branches.find(ref => ref.name === branch);
    const current = local != null && currentBranch === branch;
    return <button type="button" key={ref.name} className="commit-checkout-origin" disabled={disabled || current}
      title={current ? `Already on ${branch}` : local ? `Switch to ${branch}. Existing local commits are preserved.` : `Create ${branch} tracking ${ref.name}`}
      onClick={() => onCheckout(branch)}>
      <Cloud size={14} aria-hidden="true" /><span>Checkout origin<span className="checkout-origin-branch">{branch}</span></span>
    </button>;
  })}</>;
}
