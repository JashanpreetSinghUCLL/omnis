import { useRef, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import AuthLayout from "../../layouts/AuthLayout";
import {
  FormField,
  Input,
  CtaButton,
  SelectField,
  StepIndicator,
} from "./AuthShared";

type Plan = "starter" | "pro";

const USE_CASES = [
  { value: "engineering",  label: "Engineering documentation"     },
  { value: "legal",        label: "Legal & compliance research"   },
  { value: "internal",     label: "Internal knowledge base"       },
  { value: "academic",     label: "Academic research"             },
  { value: "product",      label: "Product & customer support"    },
  { value: "other",        label: "Other"                         },
];

export default function Plan() {
  const navigate   = useNavigate();
  const nameRef    = useRef<HTMLInputElement>(null);

  const [plan,          setPlan]          = useState<Plan>("starter");
  const [workspaceName, setWorkspaceName] = useState("");
  const [useCase,       setUseCase]       = useState("");

  useEffect(() => { nameRef.current?.focus(); }, []);

  const canLaunch = workspaceName.trim().length > 0;

  return (
    <AuthLayout
      headline="Pick the plan that fits you."
      subtext="Start free on Starter and upgrade when you need more power."
      features={[
        "Upgrade or downgrade anytime",
        "Annual billing saves 30%",
        "SOC 2 compliant on all plans",
      ]}
    >
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        style={{ padding: "48px 40px", maxWidth: "380px", margin: "0 auto", width: "100%" }}
      >
        <StepIndicator current={2} total={2} label="Step 2 of 2 — choose your plan" />

        {/* Heading */}
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "20px",
            fontWeight: 700,
            color: "var(--text-primary)",
            letterSpacing: "-0.025em",
            lineHeight: 1.2,
          }}
        >
          Choose your plan
        </h2>
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            color: "var(--text-secondary)",
            marginTop: "5px",
          }}
        >
          You can always upgrade later from settings
        </p>

        {/* Plan cards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "24px" }}>
          <PlanCard
            id="starter"
            name="Starter"
            price="$0/mo"
            features={["3 documents", "50K tokens/day", "Graph explorer"]}
            selected={plan === "starter"}
            onSelect={() => setPlan("starter")}
          />
          <PlanCard
            id="pro"
            name="Pro"
            price="$29/mo"
            features={["Unlimited docs", "500K tokens/day", "Priority support"]}
            selected={plan === "pro"}
            onSelect={() => setPlan("pro")}
            badge="Most popular"
          />
        </div>

        {/* Workspace name */}
        <FormField label="Workspace name">
          <Input
            ref={nameRef}
            type="text"
            placeholder="Acme Corp Knowledge Hub"
            value={workspaceName}
            onChange={e => setWorkspaceName(e.target.value)}
          />
        </FormField>

        {/* Use case */}
        <FormField label="Primary use case">
          <SelectField
            value={useCase}
            onChange={setUseCase}
            options={USE_CASES}
            placeholder="Select a use case…"
          />
        </FormField>

        {/* CTA */}
        <CtaButton
          disabled={!canLaunch}
          style={{ marginTop: "28px" }}
        >
          Launch my workspace <ArrowRight size={14} />
        </CtaButton>

        {/* Back link */}
        <div style={{ textAlign: "center", marginTop: "16px" }}>
          <button
            type="button"
            onClick={() => navigate("/auth/register")}
            style={{
              background: "none",
              border: "none",
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              color: "var(--text-tertiary)",
              cursor: "pointer",
              padding: 0,
            }}
            onMouseEnter={e => (e.currentTarget.style.color = "var(--text-secondary)")}
            onMouseLeave={e => (e.currentTarget.style.color = "var(--text-tertiary)")}
          >
            ← Back to details
          </button>
        </div>
      </motion.div>
    </AuthLayout>
  );
}

// ── PlanCard ──────────────────────────────────────────────────────────────────
function PlanCard({
  name,
  price,
  features,
  selected,
  onSelect,
  badge,
}: {
  id: string;
  name: string;
  price: string;
  features: string[];
  selected: boolean;
  onSelect: () => void;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        textAlign: "left",
        padding: "14px",
        borderRadius: "8px",
        border: `${selected ? "1px" : "0.5px"} solid ${selected ? "var(--accent-teal)" : "var(--border)"}`,
        background: selected ? "rgba(0,217,192,0.07)" : "var(--elevated)",
        cursor: "pointer",
        transition: "border-color 150ms, background 150ms",
        position: "relative",
      }}
      onMouseEnter={e => {
        if (!selected) e.currentTarget.style.borderColor = "var(--border-hover)";
      }}
      onMouseLeave={e => {
        if (!selected) e.currentTarget.style.borderColor = "var(--border)";
      }}
    >
      {/* Most popular badge */}
      {badge && (
        <div
          style={{
            position: "absolute",
            top: "10px",
            right: "10px",
            padding: "2px 7px",
            borderRadius: "4px",
            background: "rgba(255,181,71,0.12)",
            border: "0.5px solid rgba(255,181,71,0.3)",
            fontFamily: "var(--font-mono)",
            fontSize: "9.5px",
            color: "var(--accent-amber)",
            letterSpacing: "0.03em",
          }}
        >
          {badge}
        </div>
      )}

      {/* Plan name */}
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          color: "var(--text-secondary)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          marginBottom: "6px",
        }}
      >
        {name}
      </div>

      {/* Price */}
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "18px",
          fontWeight: 700,
          color: "var(--accent-teal)",
          letterSpacing: "-0.02em",
          lineHeight: 1,
          marginBottom: "10px",
        }}
      >
        {price}
      </div>

      {/* Features */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {features.map((f, i) => (
          <div
            key={i}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              color: "var(--text-tertiary)",
              lineHeight: 1.5,
            }}
          >
            {f}
          </div>
        ))}
      </div>

      {/* Selected indicator */}
      {selected && (
        <div
          style={{
            position: "absolute",
            top: "10px",
            left: "10px",
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: "var(--accent-teal)",
          }}
        />
      )}
    </button>
  );
}
