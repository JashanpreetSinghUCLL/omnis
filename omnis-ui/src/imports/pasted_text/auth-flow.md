Build the authentication flow for "KnowledgeHub" — a dark-first AI knowledge graph SaaS product.
The existing app uses this design language: background #080B0F, surface #0E1318, elevated #141C24,
border #1E2D3D, accent teal #00D9C0, indigo #6B7FFF, amber #FFB547, text #E8EDF2 / #7A8FA6 / #3D5066,
danger #FF4D6A, success #00C48C. Typography: IBM Plex Mono for all UI chrome and labels,
Georgia/serif for display headings, JetBrains Mono for code. No gradients, no shadows —
flat surfaces with 0.5px borders only.

Build 4 screens as separate Next.js pages using shadcn/ui components with all color tokens
overridden via globals.css. All screens share the same two-column layout:
left panel (decorative, dark) + right panel (form area, slightly lifted surface color).
The left panel always shows: brand logo top-left (3-node graph icon + "KnowledgeHub" wordmark
with "Hub" in teal), an SVG knowledge graph background (nodes and edges, very subtle,
opacity 0.4–0.6, no interaction), a headline in Georgia serif, a 2-line subtext, and
3 feature bullet points with teal dot markers at bottom-left. Right panel is pure form.

---

SCREEN 1: /login — "Sign in"

Right panel content:
- Heading: "Welcome back" (Georgia 20px)
- Subtext: "Sign in to your workspace" (IBM Plex Mono 12px, muted)
- Two social buttons side by side: Google (with real Google G SVG icon) and GitHub (with GitHub
  Octocat SVG icon). Background: elevated surface, border: 0.5px, hover: border brightens.
  Font: IBM Plex Mono 12px.
- Divider: thin line + "or continue with email" centered label
- Email input: label "Work email", placeholder "you@company.com". On focus: teal border +
  teal glow ring (box-shadow: 0 0 0 3px rgba(0,217,192,0.15)). Inline validation: show
  red "Enter a valid email address" below field if format invalid on blur.
- Password input: label row with "Password" left and "Forgot password?" teal link right.
  Input type password.
- CTA button: full width, teal background (#00D9C0), dark text (#051A17), IBM Plex Mono 13px
  weight 500. Label: "Sign in to workspace" with right arrow icon. Hover: opacity 0.88.
  Active: scale(0.98). Border-radius 8px.
- Footer text: "No account? Create one free →" — "Create one free →" is a teal link.

Left panel headline: "Your knowledge, made queryable."
Left panel sub: "Connect your documents to a living knowledge graph. Ask anything. Get answers
with full source citations."
Left panel features: "Graph + vector hybrid retrieval" / "Self-correcting AI agent loop" /
"Every answer traceable to source"

---

SCREEN 2: /register — Step 1 of 2, "Your details"

Add a step indicator at the top of the right panel: two pill-shaped progress dots. Active step
is wider (28px) and teal. Inactive is 20px and border-colored. Label beside: "Step 1 of 2 —
your details" in IBM Plex Mono 10px muted.

Right panel content:
- Heading: "Create your account" (Georgia 20px)
- Subtext: "Join thousands of teams building knowledge hubs"
- Same Google + GitHub social buttons as login
- Divider: "or with email"
- Two-column row: First name + Last name inputs side by side
- Full-width: Work email input
- Full-width: Password input with LIVE password strength indicator below.
  Strength bar = 4 equal horizontal segments with 3px gap, 2px height, border-radius 1px.
  Segment colors: danger red for weak (1 segment), amber for fair (2 segments), success green
  for good (3 segments), all 4 green for strong. Below bar: strength label text changes color
  to match. Password is "strong" when it has 8+ chars, upper+lowercase, a number, and a symbol.
- Checkbox row: small 14x14 checkbox (border 0.5px, border-radius 3px). When checked: teal
  fill, teal border, white checkmark SVG inside. Text: "I agree to the Terms of Service and
  Privacy Policy" — Terms and Privacy are teal links. IBM Plex Mono 11px.
- CTA button: "Continue to plan selection →"
- Footer: "Already have an account? Sign in →"

Left panel headline: "Start indexing in minutes."
Left features: "No credit card required" / "3 documents free on Starter" /
"Upgrade anytime, cancel anytime"

---

SCREEN 3: /register/plan — Step 2 of 2, "Choose your plan"

Step indicator: step 1 dot is done (teal, 40% opacity), step 2 is active (teal, full, wider).

Right panel content:
- Heading: "Choose your plan"
- Subtext: "You can always upgrade later from settings"
- Plan selection cards: 2-column grid, each card has border 0.5px, border-radius 8px,
  padding 12px 14px, cursor pointer. Selected card: border-color teal, teal background tint
  (rgba(0,217,192,0.08)). On click: toggle selection.
  Card 1 — Starter: name "Starter", price "$0/mo" (price in teal, IBM Plex Mono 18px),
  features "3 documents / 50K tokens/day / Graph explorer" (10px muted, line-height 1.5).
  Card 2 — Pro: name "Pro", price "$29/mo", features "Unlimited docs / 500K tokens/day /
  Priority support". Mark Pro with a small badge "Most popular" (amber background tint,
  amber text, 10px, border-radius 4px).
- Workspace name input: label "Workspace name", placeholder "Acme Corp Knowledge Hub"
- Dropdown select: label "Primary use case". Options: Engineering documentation / Legal &
  compliance research / Internal knowledge base / Academic research / Product & customer
  support / Other. Styled same as text inputs (dark background, 0.5px border, teal focus ring).
- CTA button: "Launch my workspace →" — on Starter plan this fires immediately; on Pro plan
  would open Stripe modal (mock it as same action for now).
- Footer link: "← Back to details" (navigates to step 1)

Left panel headline: "Pick the plan that fits you."
Left features: "Upgrade or downgrade anytime" / "Annual billing saves 30%" /
"SOC 2 compliant on all plans"

---

SCREEN 4: /forgot-password — "Reset password"

Simpler layout. Left panel same structure. Right panel is centered vertically (justify-content: center).

Right panel content:
- Icon block: 52x52px container, border 0.5px, border-radius 12px, centered. Inside: SVG
  padlock with teal circle highlight (keyhole becomes teal circle).
- Heading: "Forgot your password?" (Georgia 20px)
- Subtext: "Enter your email and we'll send you a reset link" (muted, IBM Plex Mono 12px)
- Email input: label "Work email", same style as other screens
- CTA button: "Send reset link →"
- Below button: "← Back to sign in" footer link
- SUCCESS STATE (show after submit if email valid): a success banner slides in below the button.
  Background: rgba(0,196,140,0.08), border: 0.5px solid rgba(0,196,140,0.25), border-radius 8px,
  padding 12px. Text: "Reset link sent — check your inbox" in success green (#00C48C),
  IBM Plex Mono 12px, centered. Animate in with slideUp + fadeIn (translateY 6px → 0,
  opacity 0 → 1, duration 220ms, cubic-bezier(0.16, 1, 0.3, 1)).

Left panel headline: "Reset your password."
Left sub: "We'll send a secure link to your email. The link expires in 15 minutes."
Left features: "Link expires after 15 minutes" / "Check spam if email doesn't arrive"

---

SHARED IMPLEMENTATION NOTES FOR v0:

- Import IBM Plex Mono from Google Fonts in layout.tsx
- All custom colors defined as CSS variables in globals.css, applied via Tailwind config
- Use next/navigation for page routing between the 4 screens
- All form inputs: controlled components with useState, validation on blur
- Password strength: calculated with useEffect watching the password field value
- Plan selection: useState with 'starter' | 'pro' type, toggled on card click
- Checkbox: useState boolean, custom styled div (not native input) for design control
- The SVG graph in the left panel: static inline SVG with hardcoded node/edge positions.
  Use these exact positions: center node at (260,300) with teal stroke, 2 indigo nodes at
  (120,200) and (360,180), 1 amber node at (180,420), 2–3 gray ghost nodes at periphery.
  All edges: stroke #1E2D3D, stroke-width 0.75, no arrowheads.
- The left panel background is position:relative, the SVG is position:absolute inset-0,
  all text content is position:relative z-index:1
- Mobile (< 768px): left panel hidden entirely, right panel full width, centered,
  max-width 420px, padding 32px 24px. Brand logo moves to top of right panel.
- Focus management: on page load, auto-focus the first input field on each screen
- Transition between screens: use Next.js App Router with Framer Motion page transitions —
  AnimatePresence with initial={{opacity:0, y:6}} animate={{opacity:1, y:0}}
  exit={{opacity:0, y:-4}} transition={{duration:0.22, ease:[0.16,1,0.3,1]}}