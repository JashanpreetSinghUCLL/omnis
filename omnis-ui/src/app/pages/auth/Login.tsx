import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import AuthLayout from "../../layouts/AuthLayout";
import {
  SocialButton,
  Divider,
  FormField,
  Input,
  CtaButton,
  TealLink,
} from "./AuthShared";

const DEMO_EMAIL    = "ada@omnis.ai";
const DEMO_PASSWORD = "omnis2026";

export default function Login() {
  const navigate = useNavigate();
  const emailRef = useRef<HTMLInputElement>(null);

  const [email,       setEmail]       = useState("");
  const [password,    setPassword]    = useState("");
  const [emailError,  setEmailError]  = useState("");
  const [emailTouched,setEmailTouched]= useState(false);
  const [authError,   setAuthError]   = useState("");
  const [loading,     setLoading]     = useState(false);

  useEffect(() => { emailRef.current?.focus(); }, []);

  const validateEmail = (val: string) => {
    if (!val || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      setEmailError("Enter a valid email address");
      return false;
    }
    setEmailError("");
    return true;
  };

  const handleSignIn = () => {
    const emailOk = validateEmail(email);
    if (!emailOk) return;

    setLoading(true);
    setAuthError("");

    // Simulate a short network round-trip
    setTimeout(() => {
      if (email === DEMO_EMAIL && password === DEMO_PASSWORD) {
        navigate("/");
      } else {
        setAuthError("Incorrect email or password.");
        setLoading(false);
      }
    }, 600);
  };

  return (
    <AuthLayout
      headline="Your knowledge, made queryable."
      subtext="Connect your documents to a living knowledge graph. Ask anything. Get answers with full source citations."
      features={[
        "Graph + vector hybrid retrieval",
        "Self-correcting AI agent loop",
        "Every answer traceable to source",
      ]}
    >
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        style={{ padding: "48px 40px", maxWidth: "380px", margin: "0 auto", width: "100%" }}
      >
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
          Welcome back
        </h2>
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            color: "var(--text-secondary)",
            marginTop: "5px",
          }}
        >
          Sign in to your workspace
        </p>

        {/* Social */}
        <div style={{ display: "flex", gap: "10px", marginTop: "28px" }}>
          <SocialButton icon="google" label="Google" />
          <SocialButton icon="github" label="GitHub" />
        </div>

        <Divider label="or continue with email" />

        {/* Email */}
        <FormField label="Work email">
          <Input
            ref={emailRef}
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={e => {
              setEmail(e.target.value);
              setEmailTouched(true);
              if (emailError) validateEmail(e.target.value);
            }}
            onBlur={() => { if (emailTouched) validateEmail(email); }}
            error={emailError}
          />
        </FormField>

        {/* Password */}
        <FormField
          label="Password"
          labelRight={
            <button
              type="button"
              onClick={() => navigate("/auth/forgot-password")}
              style={{
                background: "none",
                border: "none",
                fontFamily: "var(--font-mono)",
                fontSize: "10.5px",
                color: "var(--accent-teal)",
                cursor: "pointer",
                padding: 0,
                letterSpacing: "0.02em",
              }}
            >
              Forgot password?
            </button>
          }
        >
          <Input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => { setPassword(e.target.value); setAuthError(""); }}
            onKeyDown={e => { if (e.key === "Enter") handleSignIn(); }}
          />
        </FormField>

        {/* Auth error */}
        {authError && (
          <div
            style={{
              marginTop: "12px",
              padding: "10px 12px",
              borderRadius: "8px",
              background: "rgba(255,77,106,0.08)",
              border: "0.5px solid rgba(255,77,106,0.25)",
              fontFamily: "var(--font-mono)",
              fontSize: "11.5px",
              color: "var(--danger)",
              letterSpacing: "0.02em",
            }}
          >
            {authError}
          </div>
        )}

        {/* CTA */}
        <CtaButton style={{ marginTop: "20px" }} onClick={handleSignIn} disabled={loading}>
          {loading ? "Signing in…" : <> Sign in to workspace <ArrowRight size={14} /> </>}
        </CtaButton>

        {/* Hint */}
        <div
          style={{
            marginTop: "14px",
            padding: "10px 12px",
            borderRadius: "8px",
            background: "rgba(0,217,192,0.05)",
            border: "0.5px solid rgba(0,217,192,0.15)",
          }}
        >
          <p style={{ fontFamily: "var(--font-mono)", fontSize: "10.5px", color: "var(--text-tertiary)", margin: 0, lineHeight: 1.6 }}>
            <span style={{ color: "var(--accent-teal)" }}>Demo credentials</span><br />
            {DEMO_EMAIL} · omnis2026
          </p>
        </div>

        {/* Footer */}
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            color: "var(--text-secondary)",
            textAlign: "center",
            marginTop: "20px",
          }}
        >
          No account?{" "}
          <TealLink onClick={() => navigate("/auth/register")}>
            Create one free →
          </TealLink>
        </p>
      </motion.div>
    </AuthLayout>
  );
}