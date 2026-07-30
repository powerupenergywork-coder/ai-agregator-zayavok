"use client";

import { useEffect, useRef, useState } from "react";
import type { CategoryField } from "@ai-zayavki/shared";
import { UNKNOWN_VALUE_OPTIONS } from "@ai-zayavki/shared";
import { useLocale } from "@/lib/i18n/context";
import { Button, Chip } from "./ui";

/** Renders the right control for one category field — chips wherever the
 * answer is enumerable, free text only when it genuinely has to be (matches
 * the "chips over typing" UX call from the design discussion). */
export function FieldInput({
  field,
  onSubmit,
  autoFocus = false,
  showLabel = false,
}: {
  field: CategoryField;
  onSubmit: (value: unknown) => void;
  /** Put the cursor in the box as soon as this question appears. Off by
   * default so merely opening the page doesn't pop the mobile keyboard — the
   * caller turns it on once the client has started answering. */
  autoFocus?: boolean;
  /** Name the field above its control. Needed whenever more than one field is
   * asked at once (addresses from/to, date + time): the combined question
   * mentions both, but the controls underneath are indistinguishable without
   * this — you cannot tell which box is the pickup address. */
  showLabel?: boolean;
}) {
  const { locale, t } = useLocale();
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Moving on to the next question remounts this component (keyed by field),
  // so focusing on mount is what carries the cursor forward.
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const withLabel = (control: React.ReactNode) =>
    showLabel ? (
      // A plain div rather than <label>: most of these controls are chip
      // groups with nothing labelable to point at, and wrapping the text
      // variant's <form> in a label makes clicks ambiguous.
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-500">{field.label[locale]}</span>
        {control}
      </div>
    ) : (
      <>{control}</>
    );

  if (field.type === "enum" && field.options) {
    return withLabel(
      <div className="flex flex-wrap gap-2">
        {field.options.map((opt) => (
          <Chip key={opt.value} onClick={() => onSubmit(opt.value)}>
            {opt.label[locale]}
          </Chip>
        ))}
      </div>,
    );
  }

  if (field.type === "boolean") {
    return withLabel(
      <div className="flex flex-wrap gap-2">
        <Chip onClick={() => onSubmit(true)}>{t.common.yes}</Chip>
        <Chip onClick={() => onSubmit(false)}>{t.common.no}</Chip>
      </div>
    );
  }

  if (field.type === "date") {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date(today);
    dayAfter.setDate(dayAfter.getDate() + 2);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    return withLabel(
      <div className="flex flex-wrap items-center gap-2">
        <Chip onClick={() => onSubmit(fmt(today))}>{t.common.today}</Chip>
        <Chip onClick={() => onSubmit(fmt(tomorrow))}>{t.common.tomorrow}</Chip>
        <Chip onClick={() => onSubmit(fmt(dayAfter))}>{t.common.dayAfterTomorrow}</Chip>
        <input
          type="date"
          className="rounded-full border border-slate-300 px-3 py-2 text-sm"
          onChange={(e) => e.target.value && onSubmit(e.target.value)}
        />
      </div>,
    );
  }

  if (field.type === "time") {
    return withLabel(
      <div className="flex flex-wrap items-center gap-2">
        {["09:00", "12:00", "15:00", "18:00"].map((tm) => (
          <Chip key={tm} onClick={() => onSubmit(tm)}>
            {tm}
          </Chip>
        ))}
        <input
          type="time"
          className="rounded-full border border-slate-300 px-3 py-2 text-sm"
          onChange={(e) => e.target.value && onSubmit(e.target.value)}
        />
      </div>,
    );
  }

  // text / number / address — free input, plus "don't know" chips when allowed.
  return withLabel(
    <div className="flex flex-col gap-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          onSubmit(field.type === "number" ? Number(text) : text.trim());
          setText("");
          // Clicking «Ок» moves focus to the button, and when the answer is
          // bounced back (unknown city, past date) the same field is asked
          // again without a remount — so the mount effect above wouldn't fire.
          inputRef.current?.focus();
        }}
      >
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          type={field.type === "number" ? "number" : "text"}
          // The field's own name beats a generic "your answer" — it's the only
          // hint left once two boxes sit side by side.
          placeholder={field.unit ? `${field.label[locale]} (${field.unit})` : field.label[locale]}
          className="flex-1 rounded-full border border-slate-300 px-4 py-2 text-sm outline-none focus:border-brand-500"
        />
        <Button type="submit" disabled={!text.trim()}>
          {t.common.ok}
        </Button>
      </form>
      {field.allowUnknown && (
        <div className="flex flex-wrap gap-2">
          {UNKNOWN_VALUE_OPTIONS.map((opt) => (
            <Chip key={opt.value} onClick={() => onSubmit(opt.value)} className="text-slate-500">
              {opt.label[locale]}
            </Chip>
          ))}
        </div>
      )}
    </div>,
  );
}
