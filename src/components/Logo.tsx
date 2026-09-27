export default function Logo() {
  return (
    <span
      className="brand-logo-text"
      aria-label="ADHOC Sample Data"
      style={{
        fontWeight: 800,
        fontSize: "0.95rem",
        letterSpacing: "0.04em",
        color: "var(--brand, #D4A853)",
        whiteSpace: "nowrap",
        display: "flex",
        alignItems: "center",
        gap: "6px",
      }}
    >
      <svg viewBox="0 0 20 20" fill="none" width="18" height="18" style={{ flexShrink: 0 }}>
        <path d="M10 1l2.5 6H18l-5 4 2 6.5L10 14l-5 3.5 2-6.5-5-4h5.5z" fill="currentColor" opacity="0.9"/>
      </svg>
      DUBAI SAMPLE
    </span>
  );
}
