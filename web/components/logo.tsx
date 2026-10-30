export function Logo({ className }: { className?: string }) {
  // Two layers with a check across them: the gate every move passes through.
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="rlg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#64D2FF" />
          <stop offset="0.55" stopColor="#007AFF" />
          <stop offset="1" stopColor="#5856D6" />
        </linearGradient>
      </defs>
      <rect width="28" height="28" rx="7" fill="url(#rlg)" />
      <rect x="6" y="8" width="16" height="3.2" rx="1.6" fill="white" fillOpacity="0.45" />
      <rect x="6" y="13" width="16" height="3.2" rx="1.6" fill="white" fillOpacity="0.45" />
      <path d="M9.5 17.6l3.2 3.1 6.3-7.1" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
