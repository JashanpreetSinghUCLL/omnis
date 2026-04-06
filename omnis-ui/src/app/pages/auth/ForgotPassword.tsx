import { useRef, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight } from "lucide-react";
import AuthLayout from "../../layouts/AuthLayout";
import { FormField, Input, CtaButton } from "./AuthShared";

function LockIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      {/* Shackle */}
      <path
        d="M8 12V8a5 5 0 0110 0v4"
        stroke="var(--text-secondary)"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
      {/* Body */}
      <rect
        x="5" y="11.5" width="16" height="12"
        rx="2.5"
        stroke="var(--text-secondary)"
        strokeWidth="1.4"
        fill="none"
      />
      {/* Teal keyhole circle */}
      <circle cx="13" cy="18" r="2.8" fill="var(--accent-teal)" fillOpacity="0.9" />
      <rect x="12" y="19.5" width="2" height="3" rx="0.8" fill="var(--accent-teal)" fillOpacity="0.9" />
    </svg>
  );
}

export default function ForgotPassword() {
  const navigate  = useNavigate();
  const emailRef  = useRef<HTMLInputElement>(null);

  const [email,        setEmail]        = useState("");
  const [emailError,   setEmailError]   = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [submitted,    setSubmitted]    = useState(false);

  useEffect(() => { emailRef.current?.focus(); }, []);

  const validateEmail = (val: string) => {
    if (!val || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      setEmailError("Enter a valid email address");
      return false;
    }
    setEmailError("");
    return true;
  };

  const handleSubmit = () => {
    if (!validateEmail(email)) return;
    setSubmitted(true);
  };

  return (
    <AuthLayout
      headline="Reset your password."
      subtext="We'll send a secure link to your email. The link expires in 15 minutes."
      features={[
        "Link expires after 15 minutes",
        "Check spam if email doesn't arrive",
      ]}
      centerRight
    >
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        style={{
          padding: "48px 40px",
          maxWidth: "380px",
          margin: "0 auto",
          width: "100%",
        }}
      >
        {/* Icon block */}
        <div
          style={{
            width: "52px",
            height: "52px",
            borderRadius: "12px",
            border: "0.5px solid var(--border)",
            background: "var(--elevated)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "22px",
          }}
        >
          <LockIcon />
        </div>

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
          Forgot your password?
        </h2>
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            color: "var(--text-secondary)",
            marginTop: "6px",
            lineHeight: 1.65,
          }}
        >
          Enter your email and we'll send you a reset link
        </p>

        {/* Email input */}
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
              if (submitted) setSubmitted(false);
            }}
            onBlur={() => { if (emailTouched) validateEmail(email); }}
            error={emailError}
            disabled={submitted}
          />
        </FormField>

        {/* CTA */}
        <CtaButton
          onClick={handleSubmit}
          disabled={submitted}
          style={{ marginTop: "24px" }}
        >
          Send reset link <ArrowRight size={14} />
        </CtaButton>

        {/* Success banner */}
        <AnimatePresence>
          {submitted && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              style={{
                marginTop: "12px",
                padding: "12px 16px",
                borderRadius: "8px",
                background: "rgba(0,196,140,0.08)",
                border: "0.5px solid rgba(0,196,140,0.25)",
              }}
            >
              <p
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "12px",
                  color: "var(--success)",
                  textAlign: "center",
                  margin: 0,
                  letterSpacing: "0.02em",
                }}
              >
                Reset link sent — check your inbox
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Back link */}
        <div style={{ textAlign: "center", marginTop: "20px" }}>
          <button
            type="button"
            onClick={() => navigate("/auth/login")}
            style={{
              background: "none",
              border: "none",
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              color: "var(--text-tertiary)",
              cursor: "pointer",
              padding: 0,
              letterSpacing: "0.02em",
            }}
            onMouseEnter={e => (e.currentTarget.style.color = "var(--text-secondary)")}
            onMouseLeave={e => (e.currentTarget.style.color = "var(--text-tertiary)")}
          >
            ← Back to sign in
          </button>
        </div>
      </motion.div>
    </AuthLayout>
  );
}