interface CitationRichTextProps {
  text: string;
  onCitationClick: (index: number) => void;
}

export default function CitationRichText({
  text,
  onCitationClick,
}: CitationRichTextProps) {
  const parts = text.split(/(\[\d+\])/g).filter(Boolean);

  return (
    <span>
      {parts.map((part, idx) => {
        const match = part.match(/^\[(\d+)\]$/);
        if (!match) {
          return <span key={`${part}-${idx}`}>{part}</span>;
        }

        const citationIndex = Number(match[1]);
        return (
          <sup key={`${part}-${idx}`} className="ml-0.5">
            <button
              onClick={() => onCitationClick(citationIndex)}
              className="rounded px-1 text-[10px] align-super"
              style={{
                color: "var(--accent-teal)",
                border: "1px solid var(--border)",
                background: "var(--elevated)",
                fontFamily: "var(--font-mono)",
                lineHeight: "1.2",
              }}
            >
              {citationIndex}
            </button>
          </sup>
        );
      })}
    </span>
  );
}
