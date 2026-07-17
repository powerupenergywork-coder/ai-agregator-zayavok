"use client";

import { useState } from "react";
import type { CategoryField } from "@ai-zayavki/shared";
import { UNKNOWN_VALUE_OPTIONS } from "@ai-zayavki/shared";
import { Button, Chip } from "./ui";

/** Renders the right control for one category field — chips wherever the
 * answer is enumerable, free text only when it genuinely has to be (matches
 * the "chips over typing" UX call from the design discussion). */
export function FieldInput({ field, onSubmit }: { field: CategoryField; onSubmit: (value: unknown) => void }) {
  const [text, setText] = useState("");

  if (field.type === "enum" && field.options) {
    return (
      <div className="flex flex-wrap gap-2">
        {field.options.map((opt) => (
          <Chip key={opt.value} onClick={() => onSubmit(opt.value)}>
            {opt.label}
          </Chip>
        ))}
      </div>
    );
  }

  if (field.type === "boolean") {
    return (
      <div className="flex flex-wrap gap-2">
        <Chip onClick={() => onSubmit(true)}>Да</Chip>
        <Chip onClick={() => onSubmit(false)}>Нет</Chip>
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
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Chip onClick={() => onSubmit(fmt(today))}>Сегодня</Chip>
        <Chip onClick={() => onSubmit(fmt(tomorrow))}>Завтра</Chip>
        <Chip onClick={() => onSubmit(fmt(dayAfter))}>Послезавтра</Chip>
        <input
          type="date"
          className="rounded-full border border-slate-300 px-3 py-2 text-sm"
          onChange={(e) => e.target.value && onSubmit(e.target.value)}
        />
      </div>
    );
  }

  if (field.type === "time") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {["09:00", "12:00", "15:00", "18:00"].map((t) => (
          <Chip key={t} onClick={() => onSubmit(t)}>
            {t}
          </Chip>
        ))}
        <input
          type="time"
          className="rounded-full border border-slate-300 px-3 py-2 text-sm"
          onChange={(e) => e.target.value && onSubmit(e.target.value)}
        />
      </div>
    );
  }

  // text / number / address — free input, plus "don't know" chips when allowed.
  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          onSubmit(field.type === "number" ? Number(text) : text.trim());
          setText("");
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          type={field.type === "number" ? "number" : "text"}
          placeholder={field.unit ? `Значение (${field.unit})` : "Ваш ответ"}
          className="flex-1 rounded-full border border-slate-300 px-4 py-2 text-sm outline-none focus:border-brand-500"
        />
        <Button type="submit" disabled={!text.trim()}>
          Ок
        </Button>
      </form>
      {field.allowUnknown && (
        <div className="flex flex-wrap gap-2">
          {UNKNOWN_VALUE_OPTIONS.map((opt) => (
            <Chip key={opt.value} onClick={() => onSubmit(opt.value)} className="text-slate-500">
              {opt.label}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
