import Link from "next/link";

// Matches the approved brand mark: outlined speech-bubble with a "K", plus a
// small green accent dot — see logo brief. Brand colors here are exactly
// Tailwind's stock brand-500/slate-900/green-500, no custom palette needed.
function LogoIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
        stroke="#2563EB"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text x="11.6" y="14.6" fontFamily="Arial, Helvetica, sans-serif" fontWeight={800} fontSize="8.5" fill="#2563EB" textAnchor="middle">
        K
      </text>
      <circle cx="18.4" cy="6.6" r="2.6" fill="#22C55E" stroke="white" strokeWidth="1" />
    </svg>
  );
}

export function Logo({ className = "", withText = true }: { className?: string; withText?: boolean }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-1.5 select-none ${className}`}>
      <LogoIcon />
      {withText && (
        <span className="text-lg font-extrabold tracking-tight">
          <span className="text-slate-900">Kerek</span>
          <span className="text-brand-500">Tap</span>
        </span>
      )}
    </Link>
  );
}
