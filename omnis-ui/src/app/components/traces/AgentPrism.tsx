import { CheckCircle2, Clock3, LoaderCircle, XCircle } from "lucide-react";

export type TraceStatus = "pending" | "running" | "completed" | "failed";

export interface TraceStep {
  id: string;
  title: string;
  node: string;
  status: TraceStatus;
  startedAt?: number;
  endedAt?: number;
  data?: Record<string, unknown>;
}

function StatusIcon({ status }: { status: TraceStatus }) {
  if (status === "completed") {
    return <CheckCircle2 size={14} style={{ color: "var(--success)" }} />;
  }
  if (status === "running") {
    return (
      <LoaderCircle
        size={14}
        className="animate-spin"
        style={{ color: "var(--accent-teal)" }}
      />
    );
  }
  if (status === "failed") {
    return <XCircle size={14} style={{ color: "var(--danger)" }} />;
  }
  return <Clock3 size={14} style={{ color: "var(--text-tertiary)" }} />;
}

function durationLabel(step: TraceStep): string {
  if (!step.startedAt) {
    return "-";
  }
  const end = step.endedAt ?? Date.now();
  return `${Math.max(0, end - step.startedAt)}ms`;
}

export function SpanCard({ step }: { step: TraceStep }) {
  return (
    <div
      className="rounded-lg p-3"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center gap-2">
        <StatusIcon status={step.status} />
        <div
          className="text-[12px]"
          style={{
            color: "var(--text-primary)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {step.title}
        </div>
        <div
          className="ml-auto text-[10px]"
          style={{
            color: "var(--text-tertiary)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {durationLabel(step)}
        </div>
      </div>
      {step.data && Object.keys(step.data).length > 0 ? (
        <div
          className="mt-2 rounded p-2 text-[10px] overflow-x-auto"
          style={{
            color: "var(--text-secondary)",
            fontFamily: "var(--font-mono)",
            background: "var(--elevated)",
            border: "1px solid var(--border)",
          }}
        >
          {JSON.stringify(step.data, null, 2)}
        </div>
      ) : null}
    </div>
  );
}

export function TreeView({ steps }: { steps: TraceStep[] }) {
  return (
    <div className="space-y-2">
      {steps.map((step) => (
        <div key={step.id} className="flex gap-2">
          <div className="pt-4">
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: "var(--border-hover)" }}
            />
          </div>
          <div className="flex-1">
            <SpanCard step={step} />
          </div>
        </div>
      ))}
    </div>
  );
}
