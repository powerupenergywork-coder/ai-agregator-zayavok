import Link from "next/link";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-1.5 select-none ${className}`}>
      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-600 text-xs font-bold text-white">
        K
      </span>
      <span className="text-lg font-bold tracking-tight">
        <span className="text-slate-900">Kerek</span>
        <span className="text-brand-600">Tap</span>
      </span>
    </Link>
  );
}
