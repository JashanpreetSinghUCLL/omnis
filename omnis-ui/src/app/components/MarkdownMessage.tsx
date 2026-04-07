import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

// Render [1], [2] inline citation markers as styled superscripts
function renderInlineCitations(text: string): React.ReactNode[] {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part) => {
    const m = /^\[(\d+)\]$/.exec(part);
    if (m) {
      return (
        <sup key={`cite-${m[1]}-${part}`} style={{ color: "var(--accent-teal)", fontFamily: "var(--font-mono)", fontSize: "11px", fontWeight: 600, marginLeft: "1px" }}>
          [{m[1]}]
        </sup>
      );
    }
    return part;
  });
}

const MdH1: Components["h1"] = ({ children }) => (
  <h3 style={{ fontFamily: "var(--font-display)", fontSize: "17px", fontWeight: 600, color: "var(--text-primary)", marginTop: "20px", marginBottom: "6px" }}>
    {children}
  </h3>
);

const MdH2: Components["h2"] = ({ children }) => (
  <h4 style={{ fontFamily: "var(--font-display)", fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", marginTop: "16px", marginBottom: "4px" }}>
    {children}
  </h4>
);

const MdH3: Components["h3"] = ({ children }) => (
  <h5 style={{ fontFamily: "var(--font-display)", fontSize: "14px", fontWeight: 600, color: "var(--text-secondary)", marginTop: "12px", marginBottom: "4px" }}>
    {children}
  </h5>
);

const MdP: Components["p"] = ({ children }) => (
  <p style={{ fontFamily: "var(--font-body)", fontSize: "15px", lineHeight: "1.75", color: "var(--text-primary)", margin: "0 0 12px 0" }}>
    {typeof children === "string" ? renderInlineCitations(children) : children}
  </p>
);

const MdStrong: Components["strong"] = ({ children }) => (
  <strong style={{ fontWeight: 600, color: "var(--text-primary)" }}>{children}</strong>
);

const MdUl: Components["ul"] = ({ children }) => (
  <ul style={{ paddingLeft: "20px", margin: "8px 0 12px 0", listStyleType: "disc" }}>{children}</ul>
);

const MdOl: Components["ol"] = ({ children }) => (
  <ol style={{ paddingLeft: "20px", margin: "8px 0 12px 0" }}>{children}</ol>
);

const MdLi: Components["li"] = ({ children }) => (
  <li style={{ fontFamily: "var(--font-body)", fontSize: "15px", lineHeight: "1.7", color: "var(--text-primary)", marginBottom: "4px" }}>
    {children}
  </li>
);

const MdCode: Components["code"] = ({ children, className }) => {
  if (className?.startsWith("language-")) {
    return (
      <pre style={{ background: "var(--elevated)", border: "1px solid var(--border)", borderRadius: "8px", padding: "12px 16px", overflowX: "auto", margin: "12px 0" }}>
        <code style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--text-primary)" }}>{children}</code>
      </pre>
    );
  }
  return (
    <code style={{ fontFamily: "var(--font-mono)", fontSize: "13px", background: "var(--elevated)", border: "1px solid var(--border)", borderRadius: "4px", padding: "1px 5px", color: "var(--accent-teal)" }}>
      {children}
    </code>
  );
};

const MdBlockquote: Components["blockquote"] = ({ children }) => (
  <blockquote style={{ borderLeft: "3px solid var(--accent-teal)", paddingLeft: "12px", margin: "12px 0", color: "var(--text-secondary)", fontStyle: "italic" }}>
    {children}
  </blockquote>
);

const MdHr: Components["hr"] = () => (
  <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "16px 0" }} />
);

const COMPONENTS: Components = {
  h1: MdH1, h2: MdH2, h3: MdH3,
  p: MdP, strong: MdStrong,
  ul: MdUl, ol: MdOl, li: MdLi,
  code: MdCode, blockquote: MdBlockquote, hr: MdHr,
};

interface Props {
  readonly content: string;
}

export function MarkdownMessage({ content }: Readonly<Props>) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
      {content}
    </ReactMarkdown>
  );
}
