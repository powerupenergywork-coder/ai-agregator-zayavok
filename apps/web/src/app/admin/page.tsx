"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import { Button, Card, Spinner, StatusBadge } from "@/components/ui";

const ADMIN_TOKEN_KEY = "az_admin_token";

const QUEUES = [
  { value: "", label: "Все" },
  { value: "active", label: "Активные" },
  { value: "needs_review", label: "Требуют внимания" },
  { value: "cancelled", label: "Отменённые" },
];

export default function AdminPage() {
  const [token, setTokenState] = useState<string | null>(null);
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"orders" | "suppliers" | "categories" | "settings">("orders");

  useEffect(() => {
    setTokenState(typeof window !== "undefined" ? window.localStorage.getItem(ADMIN_TOKEN_KEY) : null);
  }, []);

  const login = async () => {
    setError(null);
    try {
      const res = await adminApi.login(email, password);
      window.localStorage.setItem(ADMIN_TOKEN_KEY, res.token);
      setTokenState(res.token);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const logout = () => {
    window.localStorage.removeItem(ADMIN_TOKEN_KEY);
    setTokenState(null);
  };

  if (!token) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
        <h1 className="mb-4 text-center text-lg font-semibold">Вход администратора</h1>
        <Card className="flex flex-col gap-3 p-4">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="rounded-xl border border-slate-300 px-4 py-2 text-sm" />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль" type="password" className="rounded-xl border border-slate-300 px-4 py-2 text-sm" />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button onClick={login}>Войти</Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Администрирование</h1>
        <Button variant="ghost" onClick={logout}>Выйти</Button>
      </div>

      <div className="mb-6 flex gap-2">
        {(["orders", "suppliers", "categories", "settings"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-2 text-sm ${tab === t ? "bg-brand-600 text-white" : "bg-white text-slate-600 border border-slate-300"}`}
          >
            {{ orders: "Заявки", suppliers: "Поставщики", categories: "Категории", settings: "Рассылка" }[t]}
          </button>
        ))}
      </div>

      {tab === "orders" && <OrdersTab token={token} />}
      {tab === "suppliers" && <SuppliersTab token={token} />}
      {tab === "categories" && <CategoriesTab token={token} />}
      {tab === "settings" && <SettingsTab token={token} />}
    </main>
  );
}

function OrdersTab({ token }: { token: string }) {
  const [queue, setQueue] = useState("");
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    adminApi.listOrders(token, queue ? { queue } : {}).then(setOrders).finally(() => setLoading(false));
  };

  useEffect(load, [token, queue]);

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {QUEUES.map((q) => (
          <button
            key={q.value}
            onClick={() => setQueue(q.value)}
            className={`rounded-full px-3 py-1.5 text-sm ${queue === q.value ? "bg-brand-600 text-white" : "bg-white border border-slate-300 text-slate-600"}`}
          >
            {q.label}
          </button>
        ))}
      </div>
      {loading ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-2">
          {orders.map((o) => (
            <Card key={o.id} className="flex items-center justify-between p-3 text-sm">
              <div>
                <p className="font-medium">№{o.number} · {o.categoryName ?? "—"} · {o.city ?? "—"}</p>
                <p className="text-slate-500">{o.clientPhone ?? "нет телефона"} · уведомлено поставщиков: {o.notifiedSuppliersCount}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge label={o.statusLabel} status={o.status} />
                <Button variant="secondary" onClick={() => adminApi.redispatch(token, o.id).then(load)}>Повторить рассылку</Button>
                <Button variant="danger" onClick={() => adminApi.adminCancelOrder(token, o.id).then(load)}>Отменить</Button>
              </div>
            </Card>
          ))}
          {orders.length === 0 && <p className="text-sm text-slate-400">Пусто</p>}
        </div>
      )}
    </div>
  );
}

function SuppliersTab({ token }: { token: string }) {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [categorySlugs, setCategorySlugs] = useState("");
  const [cities, setCities] = useState("");

  const load = () => adminApi.listSuppliers(token).then(setSuppliers);
  useEffect(() => {
    load();
  }, [token]);

  const create = async () => {
    await adminApi.upsertSupplier(token, {
      phone,
      companyName,
      categorySlugs: categorySlugs.split(",").map((s) => s.trim()).filter(Boolean),
      cities: cities.split(",").map((s) => s.trim()).filter(Boolean),
    });
    setPhone("");
    setCompanyName("");
    setCategorySlugs("");
    setCities("");
    load();
  };

  return (
    <div>
      <Card className="mb-4 flex flex-wrap gap-2 p-4">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Телефон" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Название" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input value={categorySlugs} onChange={(e) => setCategorySlugs(e.target.value)} placeholder="Категории (slug через запятую)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input value={cities} onChange={(e) => setCities(e.target.value)} placeholder="Города через запятую" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <Button onClick={create}>Добавить поставщика</Button>
      </Card>
      <div className="flex flex-col gap-2">
        {suppliers.map((s) => (
          <Card key={s.id} className="flex items-center justify-between p-3 text-sm">
            <div>
              <p className="font-medium">
                {s.companyName ?? "—"} · {s.phone}
                {s.needsReview && (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-normal text-amber-700">
                    новый, не проверен
                  </span>
                )}
              </p>
              <p className="text-slate-500">
                {s.categories.join(", ")} · {s.cities.join(", ")} · рейтинг {s.rating.toFixed(1)} · заказов {s.completedOrders}
              </p>
              <p className="text-slate-500">
                Бесплатных заявок в этом месяце: {s.notificationsUsedThisMonth} ·{" "}
                {s.subscriptionActive ? (
                  <span className="text-emerald-700">
                    подписка активна до {new Date(s.subscriptionExpiresAt).toLocaleDateString("ru-RU")}
                  </span>
                ) : (
                  <span className="text-slate-400">подписки нет</span>
                )}
              </p>
            </div>
            <div className="flex gap-2">
              {s.needsReview && (
                <Button variant="secondary" onClick={() => adminApi.markSupplierReviewed(token, s.id).then(load)}>
                  Проверено
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => adminApi.setSupplierSubscription(token, s.id, !s.subscriptionActive).then(load)}
              >
                {s.subscriptionActive ? "Снять подписку" : "Выдать подписку"}
              </Button>
              <Button variant={s.isBlocked ? "secondary" : "danger"} onClick={() => adminApi.setSupplierBlocked(token, s.id, !s.isBlocked).then(load)}>
                {s.isBlocked ? "Разблокировать" : "Заблокировать"}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function CategoriesTab({ token }: { token: string }) {
  const [categories, setCategories] = useState<any[]>([]);
  useEffect(() => {
    adminApi.listCategories(token).then(setCategories);
  }, [token]);

  return (
    <div className="flex flex-col gap-2">
      {categories.map((c) => (
        <Card key={c.id} className="p-3 text-sm">
          <p className="font-medium">{c.name} ({c.slug}) {c.isActive ? "" : "— отключена"}</p>
          <p className="text-slate-500">Полей: {c.fields.length} · Примеры: {c.examples.join("; ")}</p>
        </Card>
      ))}
      <p className="text-xs text-slate-400">
        Редактирование полей шаблона — через API (PATCH /admin/categories/:id) с полным JSON списком полей.
      </p>
    </div>
  );
}

function SettingsTab({ token }: { token: string }) {
  const [settings, setSettings] = useState<any>(null);

  useEffect(() => {
    adminApi.getDispatchSettings(token).then(setSettings);
  }, [token]);

  if (!settings) return <Spinner />;

  const save = async () => {
    const updated = await adminApi.updateDispatchSettings(token, {
      waveSize: Number(settings.waveSize),
    });
    setSettings(updated);
  };

  return (
    <Card className="flex max-w-sm flex-col gap-3 p-4">
      <label className="flex items-center justify-between text-sm">
        Поставщиков в рассылке
        <input
          type="number"
          value={settings.waveSize}
          onChange={(e) => setSettings({ ...settings, waveSize: e.target.value })}
          className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right"
        />
      </label>
      <p className="text-xs text-slate-400">
        Сколько поставщиков уведомляем при публикации заявки и при каждом повторе рассылки.
      </p>
      <Button onClick={save}>Сохранить</Button>
    </Card>
  );
}
