import { ReactNode } from "react";

interface AuthLayoutProps {
  headline: string;
  subtext: string;
  features: string[];
  centerRight?: boolean;
  children: ReactNode;
}

export default function AuthLayout({ headline, subtext, features, centerRight, children }: AuthLayoutProps) {
  return (
    <div className="min-h-screen flex" style={{ background: "var(--background)" }}>

      {/* ── Left decorative panel — always dark ─────────────────────────────── */}
      <div
        className="hidden lg:flex flex-col flex-1 relative overflow-hidden"
        style={{ background: "#05101C", borderRight: "1px solid rgba(0,217,192,0.08)" }}
      >
        {/* ── Amazing animated knowledge-graph ── */}
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 520 750"
          preserveAspectRatio="xMidYMid slice"
          style={{ pointerEvents: "none" }}
        >
          <defs>
            {/* Background */}
            <radialGradient id="ag-bg" cx="50%" cy="54%" r="72%">
              <stop offset="0%" stopColor="#0D2035" />
              <stop offset="55%" stopColor="#071624" />
              <stop offset="100%" stopColor="#030B14" />
            </radialGradient>

            {/* Central teal aura */}
            <radialGradient id="ag-aura" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#00D9C0" stopOpacity="0.16" />
              <stop offset="60%" stopColor="#00D9C0" stopOpacity="0.04" />
              <stop offset="100%" stopColor="#00D9C0" stopOpacity="0" />
            </radialGradient>

            {/* Node halo gradients */}
            <radialGradient id="ag-nt" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#00D9C0" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#00D9C0" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="ag-ni" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#6B7FFF" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#6B7FFF" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="ag-na" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFB547" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#FFB547" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="ag-np" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#B47FFF" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#B47FFF" stopOpacity="0" />
            </radialGradient>

            {/* Dot grid */}
            <pattern id="ag-grid" x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
              <circle cx="14" cy="14" r="0.7" fill="#1A3352" opacity="0.6" />
            </pattern>

            {/* Glow filters */}
            <filter id="ag-glow-xl" x="-150%" y="-150%" width="400%" height="400%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="ag-glow-md" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="4.5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="ag-glow-sm" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="ag-glow-edge" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* ── Background layers ── */}
          <rect width="520" height="750" fill="url(#ag-bg)" />
          <rect width="520" height="750" fill="url(#ag-grid)" />

          {/* ── Central ambient glow ── */}
          <circle cx="260" cy="400" r="220" fill="url(#ag-aura)" />

          {/* ── Soft colored ambient blobs behind inner nodes ── */}
          <circle cx="260" cy="265" r="55" fill="#6B7FFF" fillOpacity="0.03" />
          <circle cx="375" cy="333" r="50" fill="#B47FFF" fillOpacity="0.03" />
          <circle cx="375" cy="467" r="50" fill="#FFB547" fillOpacity="0.03" />
          <circle cx="145" cy="467" r="50" fill="#6B7FFF" fillOpacity="0.03" />

          {/* ════════════════════════════════════
              EDGES — outer ring (very dim)
          ═════════════════════════════════════ */}
          <g opacity="0.35" stroke="#0D2038" strokeWidth="0.5">
            <line x1="260" y1="160" x2="430" y2="215" />
            <line x1="430" y1="215" x2="465" y2="400" />
            <line x1="465" y1="400" x2="405" y2="560" />
            <line x1="405" y1="560" x2="185" y2="575" />
            <line x1="185" y1="575" x2="65" y2="455" />
            <line x1="65"  y1="455" x2="72" y2="250" />
            <line x1="72"  y1="250" x2="195" y2="148" />
            <line x1="195" y1="148" x2="260" y2="160" />
          </g>

          {/* ════════════════════════════════════
              EDGES — middle to outer
          ═════════════════════════════════════ */}
          <g opacity="0.28" stroke="#122035" strokeWidth="0.6">
            <line x1="260" y1="265" x2="260" y2="160" />
            <line x1="260" y1="265" x2="430" y2="215" />
            <line x1="260" y1="265" x2="195" y2="148" />
            <line x1="375" y1="333" x2="430" y2="215" />
            <line x1="375" y1="333" x2="465" y2="400" />
            <line x1="375" y1="467" x2="465" y2="400" />
            <line x1="375" y1="467" x2="405" y2="560" />
            <line x1="260" y1="535" x2="405" y2="560" />
            <line x1="260" y1="535" x2="185" y2="575" />
            <line x1="145" y1="467" x2="185" y2="575" />
            <line x1="145" y1="467" x2="65"  y2="455" />
            <line x1="145" y1="333" x2="65"  y2="455" />
            <line x1="145" y1="333" x2="72"  y2="250" />
          </g>

          {/* ════════════════════════════════════
              EDGES — inner hexagon ring
          ═════════════════════════════════════ */}
          <g stroke="#1E3A58" strokeWidth="0.75">
            <line x1="260" y1="265" x2="375" y2="333" opacity="0.7" />
            <line x1="375" y1="333" x2="375" y2="467" opacity="0.7" />
            <line x1="375" y1="467" x2="260" y2="535" opacity="0.6" />
            <line x1="260" y1="535" x2="145" y2="467" opacity="0.6" />
            <line x1="145" y1="467" x2="145" y2="333" opacity="0.7" />
            <line x1="145" y1="333" x2="260" y2="265" opacity="0.7" />
          </g>

          {/* Inner diagonals (cross chords) */}
          <g stroke="#152030" strokeWidth="0.5" opacity="0.5">
            <line x1="260" y1="265" x2="260" y2="535" />
            <line x1="375" y1="333" x2="145" y2="467" />
            <line x1="375" y1="467" x2="145" y2="333" />
          </g>

          {/* ════════════════════════════════════
              EDGES — center to inner (glow layer)
          ═════════════════════════════════════ */}
          <g filter="url(#ag-glow-edge)">
            <line x1="260" y1="400" x2="260" y2="265" stroke="#00D9C0" strokeWidth="2"   opacity="0.22" />
            <line x1="260" y1="400" x2="375" y2="333" stroke="#B47FFF" strokeWidth="2"   opacity="0.22" />
            <line x1="260" y1="400" x2="375" y2="467" stroke="#FFB547" strokeWidth="2"   opacity="0.22" />
            <line x1="260" y1="400" x2="260" y2="535" stroke="#00D9C0" strokeWidth="1.5" opacity="0.18" />
            <line x1="260" y1="400" x2="145" y2="467" stroke="#6B7FFF" strokeWidth="2"   opacity="0.22" />
            <line x1="260" y1="400" x2="145" y2="333" stroke="#B47FFF" strokeWidth="2"   opacity="0.22" />
          </g>

          {/* Center to inner — crisp lines */}
          <line x1="260" y1="400" x2="260" y2="265" stroke="#00D9C0" strokeWidth="0.8" opacity="0.65" />
          <line x1="260" y1="400" x2="375" y2="333" stroke="#B47FFF" strokeWidth="0.8" opacity="0.6"  />
          <line x1="260" y1="400" x2="375" y2="467" stroke="#FFB547" strokeWidth="0.8" opacity="0.6"  />
          <line x1="260" y1="400" x2="260" y2="535" stroke="#00D9C0" strokeWidth="0.7" opacity="0.45" />
          <line x1="260" y1="400" x2="145" y2="467" stroke="#6B7FFF" strokeWidth="0.8" opacity="0.6"  />
          <line x1="260" y1="400" x2="145" y2="333" stroke="#B47FFF" strokeWidth="0.8" opacity="0.55" />

          {/* ════════════════════════════════════
              ANIMATED FLOW DASHES
          ═════════════════════════════════════ */}
          {/* Center → N1 (teal, upward) */}
          <line x1="260" y1="400" x2="260" y2="265" stroke="#00D9C0" strokeWidth="1" strokeDasharray="5 14" opacity="0.55">
            <animate attributeName="stroke-dashoffset" from="190" to="0" dur="2.8s" repeatCount="indefinite" />
          </line>

          {/* Center → N3 (amber) */}
          <line x1="260" y1="400" x2="375" y2="467" stroke="#FFB547" strokeWidth="0.9" strokeDasharray="4 12" opacity="0.45">
            <animate attributeName="stroke-dashoffset" from="160" to="0" dur="3.4s" repeatCount="indefinite" />
          </line>

          {/* Center → N5 (indigo) */}
          <line x1="260" y1="400" x2="145" y2="467" stroke="#6B7FFF" strokeWidth="0.9" strokeDasharray="4 12" opacity="0.45">
            <animate attributeName="stroke-dashoffset" from="160" to="0" dur="4.1s" repeatCount="indefinite" />
          </line>

          {/* N1 → M1 (top chain) */}
          <line x1="260" y1="265" x2="260" y2="160" stroke="#6B7FFF" strokeWidth="0.75" strokeDasharray="3 10" opacity="0.3">
            <animate attributeName="stroke-dashoffset" from="105" to="0" dur="2.2s" repeatCount="indefinite" />
          </line>

          {/* N2 → M2 (right chain) */}
          <line x1="375" y1="333" x2="430" y2="215" stroke="#B47FFF" strokeWidth="0.75" strokeDasharray="3 10" opacity="0.28">
            <animate attributeName="stroke-dashoffset" from="130" to="0" dur="3s" begin="0.8s" repeatCount="indefinite" />
          </line>

          {/* N5 → M6 (left chain) */}
          <line x1="145" y1="467" x2="65" y2="455" stroke="#6B7FFF" strokeWidth="0.75" strokeDasharray="3 10" opacity="0.25">
            <animate attributeName="stroke-dashoffset" from="90" to="0" dur="2.6s" begin="1.3s" repeatCount="indefinite" />
          </line>

          {/* ════════════════════════════════════
              PULSE RINGS — CENTER (3 staggered)
          ═════════════════════════════════════ */}
          <circle cx="260" cy="400" r="18" fill="none" stroke="#00D9C0" strokeWidth="1.2">
            <animate attributeName="r"       values="18;75"     dur="3.2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.55;0"    dur="3.2s" repeatCount="indefinite" />
          </circle>
          <circle cx="260" cy="400" r="18" fill="none" stroke="#00D9C0" strokeWidth="0.8">
            <animate attributeName="r"       values="18;100"    dur="3.2s" begin="1.07s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.35;0"    dur="3.2s" begin="1.07s" repeatCount="indefinite" />
          </circle>
          <circle cx="260" cy="400" r="18" fill="none" stroke="#00D9C0" strokeWidth="0.5">
            <animate attributeName="r"       values="18;130"    dur="3.2s" begin="2.13s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.2;0"     dur="3.2s" begin="2.13s" repeatCount="indefinite" />
          </circle>

          {/* ════════════════════════════════════
              PULSE RINGS — secondary nodes
          ═════════════════════════════════════ */}
          {/* N2 purple */}
          <circle cx="375" cy="333" r="9" fill="none" stroke="#B47FFF" strokeWidth="0.8">
            <animate attributeName="r"       values="9;38"   dur="3.8s" begin="0.6s"  repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.45;0" dur="3.8s" begin="0.6s"  repeatCount="indefinite" />
          </circle>
          {/* N3 amber */}
          <circle cx="375" cy="467" r="9" fill="none" stroke="#FFB547" strokeWidth="0.8">
            <animate attributeName="r"       values="9;38"   dur="4.2s" begin="1.9s"  repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.45;0" dur="4.2s" begin="1.9s"  repeatCount="indefinite" />
          </circle>
          {/* N1 indigo */}
          <circle cx="260" cy="265" r="8" fill="none" stroke="#6B7FFF" strokeWidth="0.8">
            <animate attributeName="r"       values="8;32"   dur="3.5s" begin="2.4s"  repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.4;0"  dur="3.5s" begin="2.4s"  repeatCount="indefinite" />
          </circle>

          {/* ════════════════════════════════════
              NODE HALOS (radial gradient discs)
          ═════════════════════════════════════ */}
          {/* Center */}
          <circle cx="260" cy="400" r="36" fill="url(#ag-nt)" opacity="0.55" />
          {/* Inner */}
          <circle cx="260" cy="265" r="22" fill="url(#ag-ni)" opacity="0.65" />
          <circle cx="375" cy="333" r="20" fill="url(#ag-np)" opacity="0.65" />
          <circle cx="375" cy="467" r="20" fill="url(#ag-na)" opacity="0.65" />
          <circle cx="260" cy="535" r="18" fill="url(#ag-nt)" opacity="0.45" />
          <circle cx="145" cy="467" r="20" fill="url(#ag-ni)" opacity="0.65" />
          <circle cx="145" cy="333" r="18" fill="url(#ag-np)" opacity="0.55" />
          {/* Middle */}
          <circle cx="260" cy="160" r="14" fill="url(#ag-ni)" opacity="0.4"  />
          <circle cx="430" cy="215" r="12" fill="url(#ag-ni)" opacity="0.35" />
          <circle cx="65"  cy="455" r="12" fill="url(#ag-np)" opacity="0.35" />
          <circle cx="195" cy="148" r="11" fill="url(#ag-ni)" opacity="0.3"  />

          {/* ════════════════════════════════════
              NODE CORES
          ═════════════════════════════════════ */}
          {/* ── Center — teal, large ── */}
          <circle cx="260" cy="400" r="9"   fill="#00D9C0" filter="url(#ag-glow-xl)" />
          <circle cx="260" cy="400" r="4.5" fill="#E0FFF9" opacity="0.95" />

          {/* ── Inner ring ── */}
          <circle cx="260" cy="265" r="7"   fill="#6B7FFF" filter="url(#ag-glow-md)" />
          <circle cx="260" cy="265" r="3"   fill="#D8DCFF" opacity="0.9" />

          <circle cx="375" cy="333" r="7"   fill="#B47FFF" filter="url(#ag-glow-md)" />
          <circle cx="375" cy="333" r="3"   fill="#EDD8FF" opacity="0.9" />

          <circle cx="375" cy="467" r="7"   fill="#FFB547" filter="url(#ag-glow-md)" />
          <circle cx="375" cy="467" r="3"   fill="#FFF0D0" opacity="0.9" />

          <circle cx="260" cy="535" r="6"   fill="#00D9C0" filter="url(#ag-glow-sm)" opacity="0.8" />
          <circle cx="260" cy="535" r="2.5" fill="#E0FFF9" opacity="0.8" />

          <circle cx="145" cy="467" r="7"   fill="#6B7FFF" filter="url(#ag-glow-md)" />
          <circle cx="145" cy="467" r="3"   fill="#D8DCFF" opacity="0.9" />

          <circle cx="145" cy="333" r="6"   fill="#B47FFF" filter="url(#ag-glow-sm)" opacity="0.85" />
          <circle cx="145" cy="333" r="2.5" fill="#EDD8FF" opacity="0.85" />

          {/* ── Middle ring ── */}
          <circle cx="260" cy="160" r="5.5" fill="#6B7FFF" opacity="0.7" />
          <circle cx="260" cy="160" r="2"   fill="#D8DCFF" opacity="0.7" />

          <circle cx="430" cy="215" r="5"   fill="#6B7FFF" opacity="0.6" />
          <circle cx="430" cy="215" r="1.8" fill="#D8DCFF" opacity="0.65" />

          <circle cx="465" cy="400" r="4.5" fill="#243A52" stroke="#2E4F70" strokeWidth="0.8" opacity="0.7" />
          <circle cx="405" cy="560" r="4.5" fill="#FFB547" opacity="0.5" />
          <circle cx="185" cy="575" r="4"   fill="#243A52" stroke="#2E4F70" strokeWidth="0.8" opacity="0.6" />
          <circle cx="65"  cy="455" r="5"   fill="#B47FFF" opacity="0.6" />
          <circle cx="65"  cy="455" r="1.8" fill="#EDD8FF" opacity="0.6" />
          <circle cx="72"  cy="250" r="4.5" fill="#243A52" stroke="#2E4F70" strokeWidth="0.8" opacity="0.6" />
          <circle cx="195" cy="148" r="4.5" fill="#6B7FFF" opacity="0.55" />

          {/* ── Outer ghost nodes ── */}
          <circle cx="375" cy="68"  r="3"   fill="none" stroke="#1A3350" strokeWidth="0.75" opacity="0.55" />
          <circle cx="495" cy="155" r="2.5" fill="none" stroke="#1A3350" strokeWidth="0.7"  opacity="0.45" />
          <circle cx="508" cy="330" r="2.5" fill="none" stroke="#1A3350" strokeWidth="0.7"  opacity="0.4"  />
          <circle cx="440" cy="610" r="2.5" fill="none" stroke="#1A3350" strokeWidth="0.7"  opacity="0.4"  />
          <circle cx="120" cy="640" r="2.5" fill="none" stroke="#1A3350" strokeWidth="0.7"  opacity="0.35" />
          <circle cx="22"  cy="490" r="2.5" fill="none" stroke="#1A3350" strokeWidth="0.7"  opacity="0.4"  />
          <circle cx="28"  cy="200" r="2.5" fill="none" stroke="#1A3350" strokeWidth="0.7"  opacity="0.4"  />
          <circle cx="135" cy="65"  r="2.5" fill="none" stroke="#1A3350" strokeWidth="0.7"  opacity="0.45" />
        </svg>

        {/* ── Content layer ── */}
        <div className="relative z-10 flex flex-col h-full p-10 lg:p-12">
          {/* Logo */}
          <OmnisLogo textColor="#E2F4FF" />

          {/* Push content to bottom */}
          <div className="mt-auto">
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "clamp(22px, 2.2vw, 30px)",
                fontWeight: 700,
                color: "#E2F4FF",
                letterSpacing: "-0.03em",
                lineHeight: 1.25,
                marginBottom: "12px",
                maxWidth: "340px",
              }}
            >
              {headline}
            </h1>

            {subtext && (
              <p
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "12px",
                  color: "rgba(180,210,240,0.6)",
                  lineHeight: 1.75,
                  maxWidth: "320px",
                }}
              >
                {subtext}
              </p>
            )}

            {features.length > 0 && (
              <div style={{ marginTop: "24px", display: "flex", flexDirection: "column", gap: "10px" }}>
                {features.map((f, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div
                      style={{
                        width: "5px",
                        height: "5px",
                        borderRadius: "50%",
                        background: "#00D9C0",
                        flexShrink: 0,
                        boxShadow: "0 0 6px rgba(0,217,192,0.7)",
                      }}
                    />
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "11.5px", color: "rgba(180,210,240,0.55)" }}>
                      {f}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer rule */}
          <div style={{ marginTop: "32px", height: "0.5px", background: "rgba(0,217,192,0.15)" }} />
          <div
            style={{
              marginTop: "14px",
              fontFamily: "var(--font-mono)",
              fontSize: "9.5px",
              color: "rgba(180,210,240,0.3)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            Omnis · Universal Knowledge Hub
          </div>
        </div>
      </div>

      {/* ── Right form panel ──────────────────────────────────────────────────── */}
      <div
        className={`flex flex-col w-full lg:w-[460px] xl:w-[500px] flex-shrink-0 overflow-y-auto ${centerRight ? "justify-center" : ""}`}
        style={{ background: "var(--surface)", borderLeft: "0.5px solid var(--border)" }}
      >
        {/* Mobile logo */}
        <div className="lg:hidden flex items-center gap-2.5 px-8 pt-8 pb-0">
          <OmnisLogo />
        </div>
        {children}
      </div>
    </div>
  );
}

function OmnisLogo({ textColor }: { textColor?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="4"  r="2" fill="#00D9C0" />
        <circle cx="4"  cy="14" r="2" fill="#00D9C0" />
        <circle cx="16" cy="14" r="2" fill="#00D9C0" />
        <line x1="10" y1="6"  x2="5"  y2="12" stroke="#00D9C0" strokeWidth="1.4" />
        <line x1="10" y1="6"  x2="15" y2="12" stroke="#00D9C0" strokeWidth="1.4" />
        <line x1="6"  y1="14" x2="14" y2="14" stroke="#00D9C0" strokeWidth="1.4" />
      </svg>
      <span style={{ fontFamily: "var(--font-display)", fontSize: "15px", fontWeight: 600, color: textColor || "var(--text-primary)" }}>
        Omnis
      </span>
    </div>
  );
}