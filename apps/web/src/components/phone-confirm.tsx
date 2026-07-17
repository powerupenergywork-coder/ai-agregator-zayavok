"use client";

import { useEffect, useState } from "react";
import { authApi, AuthResult } from "@/lib/api";
import { getDeviceId } from "@/lib/device";
import { setToken } from "@/lib/auth";
import { Button } from "./ui";

type Purpose = "CLIENT_LOGIN" | "SUPPLIER_LOGIN";

export function PhoneConfirm({
  purpose,
  onAuthenticated,
  onCancel,
}: {
  purpose: Purpose;
  onAuthenticated: (result: AuthResult) => void;
  onCancel?: () => void;
}) {
  const [phase, setPhase] = useState<"checking" | "phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [channel, setChannel] = useState<"whatsapp" | "sms">("whatsapp");

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // WebOTP: auto-reads the code on supporting Android browsers so the user
  // never has to type it — but only works for real SMS, the browser has no
  // way to read a WhatsApp message. Only wired up for the SMS-fallback path.
  useEffect(() => {
    if (phase !== "code" || channel !== "sms" || !("OTPCredential" in window)) return;
    const controller = new AbortController();
    (navigator as any).credentials
      .get({ otp: { transport: ["sms"] }, signal: controller.signal })
      .then((otp: any) => {
        if (otp?.code) {
          setCode(otp.code);
          submitCode(otp.code);
        }
      })
      .catch(() => {});
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, channel]);

  const requestCode = async () => {
    setError(null);
    setBusy(true);
    try {
      const deviceId = getDeviceId();
      const trusted = await authApi.checkDevice(phone, purpose, deviceId);
      if (trusted.trusted && trusted.token) {
        setToken(purpose === "CLIENT_LOGIN" ? "client" : "supplier", trusted.token);
        onAuthenticated(trusted as AuthResult);
        return;
      }
      const res = await authApi.requestCode(phone, purpose, deviceId);
      setCooldown(res.resendCooldownSeconds);
      setChannel(res.channel);
      setPhase("code");
    } catch (e: any) {
      setError(e.message || "Не получилось отправить код");
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (value: string) => {
    setError(null);
    setBusy(true);
    try {
      const result = await authApi.verifyCode(phone, value, purpose, getDeviceId());
      setToken(purpose === "CLIENT_LOGIN" ? "client" : "supplier", result.token);
      onAuthenticated(result);
    } catch (e: any) {
      setError(e.message || "Неверный код");
    } finally {
      setBusy(false);
    }
  };

  if (phase === "phone") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">
          Нужен, чтобы отправить вам ссылку на заявку и связать с исполнителем — не для рекламы.
        </p>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+7 700 000 00 00"
          type="tel"
          autoComplete="tel"
          className="rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-brand-500"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              Отмена
            </Button>
          )}
          <Button onClick={requestCode} disabled={busy || phone.trim().length < 5} className="flex-1">
            Подтвердить номер
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-600">
        {channel === "whatsapp"
          ? `Мы отправили код подтверждения в WhatsApp на ${phone}`
          : `Мы отправили код подтверждения по SMS на ${phone}`}
      </p>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder={channel === "whatsapp" ? "Код из WhatsApp" : "Код из SMS"}
        inputMode="numeric"
        autoComplete="one-time-code"
        className="rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-brand-500"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setPhase("phone")}>
          Назад
        </Button>
        <Button onClick={() => submitCode(code)} disabled={busy || code.length < 4} className="flex-1">
          Подтвердить
        </Button>
      </div>
      <button
        type="button"
        disabled={cooldown > 0}
        onClick={requestCode}
        className="text-sm text-brand-600 disabled:text-slate-400"
      >
        {cooldown > 0 ? `Повторить через ${cooldown} сек.` : "Отправить код ещё раз"}
      </button>
    </div>
  );
}
