import { useEffect, useState } from "react";
import type { Approval } from "../types.js";
import { IconChevron, IconShield } from "./Icons.js";

interface Props {
  approval: Approval;
  onDecide: (decision: "approved" | "rejected") => Promise<void>;
}

export function ApprovalCard({ approval, onDecide }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const decided = approval.status !== "pending";

  useEffect(() => {
    if (!decided) return;
    const timer = window.setTimeout(() => setVisible(false), 4000);
    return () => window.clearTimeout(timer);
  }, [decided]);

  if (!visible) return null;

  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true);
    setError(null);
    try {
      await onDecide(decision);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record decision");
    } finally {
      setBusy(false);
    }
  };

  const resultText =
    approval.status === "approved"
      ? "Approved"
      : approval.status === "rejected"
        ? "Rejected"
        : approval.status === "expired"
          ? "Expired"
          : null;

  return (
    <section className="approval-card glass" aria-label="Approval required">
      <header className="approval-header">
        <span className="approval-title">
          <IconShield size={16} />
          Approval required
        </span>
        <span className={`risk-badge risk-${approval.risk.toLowerCase()}`}>
          {approval.risk}
        </span>
        <code className="chip approval-tool">{approval.toolId}</code>
      </header>
      {approval.reason && <p className="approval-reason">{approval.reason}</p>}
      {Object.keys(approval.toolArgs).length > 0 && (
        <div className="approval-args">
          <button
            className="step-toggle"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            <IconChevron size={12} className={open ? "open" : ""} />
            {open ? "hide args" : "show args"}
          </button>
          {open && (
            <div className="step-detail">
              <pre>{JSON.stringify(approval.toolArgs, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
      {error && <p className="form-error" style={{ margin: "8px 0" }}>{error}</p>}
      {resultText ? (
        <p
          className={`approval-result ${
            approval.status === "approved"
              ? "ok"
              : approval.status === "rejected"
                ? "no"
                : "gone"
          }`}
        >
          {resultText}
        </p>
      ) : (
        <div className="approval-actions">
          <button
            className="btn btn-accent btn-sm"
            onClick={() => void decide("approved")}
            disabled={busy}
          >
            Approve
          </button>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => void decide("rejected")}
            disabled={busy}
          >
            Reject
          </button>
        </div>
      )}
    </section>
  );
}
