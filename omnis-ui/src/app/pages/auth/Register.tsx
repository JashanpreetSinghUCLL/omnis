import { useRef, useEffect, useState } from "react";
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
  StepIndicator,
  CustomCheckbox,
  PasswordStrength,
} from "./AuthShared";

export default function Register() {
  const navigate  = useNavigate();
  const firstRef  = useRef<HTMLInputElement>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName,  setLastName]  = useState("");
  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [emailErr,     setEmailErr]     = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [agreed,       setAgreed]       = useState(false);

  useEffect(() => { firstRef.current?.focus(); }, []);

  const validateEmail = (val: string) => {
    if (!val || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      setEmailErr("Enter a valid email address");
      return false;
    }
    setEmailErr("");
    return true;
  };

  const canContinue = firstName && lastName && email && !emailErr && password && agreed;

  return (
    <AuthLayout
      headline="Start indexing in minutes."
      subtext="Your first three documents are on us. No credit card needed."
      features={[
        "No credit card required",
        "3 documents free on Starter",
        "Upgrade anytime, cancel anytime",
      ]}
    >
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        style={{ padding: "48px 40px", maxWidth: "380px", margin: "0 auto", width: "100%" }}
      >
        <StepIndicator current={1} total={2} label="Step 1 of 2 — your details" />

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
          Create your account
        </h2>
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            color: "var(--text-secondary)",
            marginTop: "5px",
          }}
        >
          Join thousands of teams building knowledge hubs
        </p>

        {/* Social */}
        <div style={{ display: "flex", gap: "10px", marginTop: "24px" }}>
          <SocialButton icon="google" label="Google" />
          <SocialButton icon="github" label="GitHub" />
        </div>

        <Divider label="or with email" />

        {/* Name row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "0px" }}>
          <FormField label="First name" style={{ marginTop: 0 }}>
            <Input
              ref={firstRef}
              type="text"
              placeholder="Ada"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
            />
          </FormField>
          <FormField label="Last name" style={{ marginTop: 0 }}>
            <Input
              type="text"
              placeholder="Lovelace"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
            />
          </FormField>
        </div>

        {/* Email */}
        <FormField label="Work email">
          <Input
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={e => {
              setEmail(e.target.value);
              setEmailTouched(true);
              if (emailErr) validateEmail(e.target.value);
            }}
            onBlur={() => { if (emailTouched) validateEmail(email); }}
            error={emailErr}
          />
        </FormField>

        {/* Password + strength */}
        <FormField label="Password">
          <Input
            type="password"
            placeholder="Create a strong password"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          <PasswordStrength password={password} />
        </FormField>

        {/* Terms checkbox */}
        <div style={{ marginTop: "18px" }}>
          <CustomCheckbox
            checked={agreed}
            onChange={setAgreed}
            label={
              <>
                I agree to the{" "}
                <span style={{ color: "var(--accent-teal)" }}>Terms of Service</span>
                {" "}and{" "}
                <span style={{ color: "var(--accent-teal)" }}>Privacy Policy</span>
              </>
            }
          />
        </div>

        {/* CTA */}
        <CtaButton
          onClick={() => navigate("/auth/register/plan")}
          disabled={!canContinue}
          style={{ marginTop: "24px" }}
        >
          Continue to plan selection <ArrowRight size={14} />
        </CtaButton>

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
          Already have an account?{" "}
          <TealLink onClick={() => navigate("/auth/login")}>
            Sign in →
          </TealLink>
        </p>
      </motion.div>
    </AuthLayout>
  );
}