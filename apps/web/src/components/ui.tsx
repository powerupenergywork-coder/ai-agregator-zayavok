"use client";

import { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const base = "rounded-xl px-4 py-2.5 text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed";
  const styles: Record<string, string> = {
    primary: "bg-brand-600 text-white hover:bg-brand-700",
    secondary: "bg-white text-slate-900 border border-slate-300 hover:bg-slate-50",
    ghost: "text-slate-600 hover:bg-slate-100",
    danger: "bg-red-50 text-red-600 border border-red-200 hover:bg-red-100",
  };
  return <button className={`${base} ${styles[variant]} ${className}`} {...props} />;
}

export function Chip({
  selected,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      className={`rounded-full border px-4 py-2 text-sm transition ${
        selected ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 bg-white text-slate-700 hover:border-brand-400"
      } ${className}`}
      {...props}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600 ${className}`}
    />
  );
}

export function StatusBadge({ label, status }: { label: string; status: string }) {
  const positive = ["COMPLETED", "PUBLISHED", "SUPPLIER_SELECTED", "IN_PROGRESS"];
  const negative = ["CANCELLED_BY_CLIENT", "CANCELLED_BY_ADMIN", "NO_OFFERS", "DISPUTE"];
  const tone = positive.includes(status) ? "bg-emerald-50 text-emerald-700" : negative.includes(status) ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-700";
  return <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${tone}`}>{label}</span>;
}
