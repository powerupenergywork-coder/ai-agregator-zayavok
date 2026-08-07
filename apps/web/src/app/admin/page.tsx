"use client";

import { useEffect, useState } from "react";
import { adminApi, ProspectContactDto, ProspectFunnelDto } from "@/lib/api";
import { Button, Card, Spinner, StatusBadge } from "@/components/ui";
import { QualityTab } from "./quality-tab";
import { ConversationsTab } from "./conversations-tab";
import { OrderDetails } from "./order-details";

const PROSPECT_STATUS_LABEL: Record<string, string> = {
  sent: "Отправлено",
  responded: "Ответил",
  converted: "Зарегистрировался",
  ignored: "Без ответа",
};

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
  const [tab, setTab] = useState<"orders" | "suppliers" | "categories" | "settings" | "prospects" | "quality" | "chats">("orders");

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
        {(["orders", "suppliers", "chats", "categories", "settings", "prospects", "quality"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-2 text-sm ${tab === t ? "bg-brand-600 text-white" : "bg-white text-slate-600 border border-slate-300"}`}
          >
            {{ orders: "Заявки", suppliers: "Поставщики", chats: "Переписки", categories: "Категории", settings: "Рассылка", prospects: "Прогрев поставщиков", quality: "Качество" }[t]}
          </button>
        ))}
      </div>

      {tab === "orders" && <OrdersTab token={token} />}
      {tab === "suppliers" && <SuppliersTab token={token} />}
      {tab === "categories" && <CategoriesTab token={token} />}
      {tab === "settings" && <SettingsTab token={token} />}
      {tab === "prospects" && <ProspectsTab token={token} />}
      {tab === "chats" && <ConversationsTab token={token} />}
      {tab === "quality" && <QualityTab token={token} />}
    </main>
  );
}

function OrdersTab({ token }: { token: string }) {
  const [queue, setQueue] = useState("");
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Раскрыта всегда не больше одной: список длинный, и десяток развёрнутых
  // карточек читать невозможно.
  const [openId, setOpenId] = useState<string | null>(null);

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
            <Card key={o.id} className="p-3 text-sm">
              <div className="flex items-center justify-between">
                <button
                  className="flex-1 text-left"
                  onClick={() => setOpenId(openId === o.id ? null : o.id)}
                >
                  <p className="font-medium">
                    <span className="mr-1 inline-block w-3 text-slate-400">{openId === o.id ? "▾" : "▸"}</span>
                    №{o.number} · {o.categoryName ?? "—"} · {o.city ?? "—"}
                    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-600">
                      {o.channel === "WHATSAPP" ? "WhatsApp" : "сайт"}
                    </span>
                  </p>
                  <p className="pl-4 text-slate-500">
                    {o.clientPhone ?? "нет телефона"} · уведомлено поставщиков: {o.notifiedSuppliersCount}
                  </p>
                </button>
                <div className="flex items-center gap-2">
                  <StatusBadge label={o.statusLabel} status={o.status} />
                  <Button variant="secondary" onClick={() => adminApi.redispatch(token, o.id).then(load)}>Повторить рассылку</Button>
                  <Button variant="danger" onClick={() => adminApi.adminCancelOrder(token, o.id).then(load)}>Отменить</Button>
                </div>
              </div>
              {openId === o.id && <OrderDetails token={token} orderId={o.id} />}
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
  const [allCategories, setAllCategories] = useState<any[]>([]);
  // Какому поставщику раскрыта детализация по деньгам. Один за раз: две
  // таблицы рядом всё равно не сравнивают, а список от них разъезжается.
  const [billingFor, setBillingFor] = useState<string | null>(null);

  const load = () => adminApi.listSuppliers(token).then(setSuppliers);
  useEffect(() => {
    adminApi.listCategories(token).then(setAllCategories).catch(() => {});
  }, [token]);
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
        {/* The form takes slugs, so the slugs have to be readable from here —
            otherwise picking "crane" when you meant "crane-truck" (autocrane
            vs manipulator) is a typo with no symptom. */}
        <p className="w-full text-xs text-slate-500">
          Коды категорий:{" "}
          {allCategories.length === 0
            ? "загружаются…"
            : allCategories.map((c: any, i: number) => (
                <span key={c.slug}>
                  {i > 0 && " · "}
                  <button
                    type="button"
                    onClick={() =>
                      setCategorySlugs((prev) =>
                        prev.split(",").map((s) => s.trim()).filter(Boolean).includes(c.slug)
                          ? prev
                          : [...prev.split(",").map((s) => s.trim()).filter(Boolean), c.slug].join(", "),
                      )
                    }
                    className="underline decoration-dotted hover:text-brand-600"
                    title="Добавить в поле"
                  >
                    {c.name?.ru ?? c.slug} <span className="text-slate-400">({c.slug})</span>
                  </button>
                </span>
              ))}
        </p>
      </Card>
      <div className="flex flex-col gap-2">
        {suppliers.map((s) => (
          <div key={s.id} className="flex flex-col gap-1">
          <Card className="flex items-center justify-between p-3 text-sm">
            <div>
              <p className="font-medium">
                {s.companyName ?? "—"} · {s.phone}
                {!s.confirmedAt && (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-normal text-amber-700">
                    не подтвердил — получит приглашение
                  </span>
                )}
              </p>
              <p className="text-slate-500">
                {(s.categoryNames ?? s.categories.map((slug: string) => ({ slug, name: slug }))).map(
                  (c: { slug: string; name: string }, i: number) => (
                    <span key={c.slug}>
                      {i > 0 && ", "}
                      {c.name}
                      <span className="text-slate-400"> ({c.slug})</span>
                    </span>
                  ),
                )}
                {" · "}
                {s.cities.join(", ")} · рейтинг {s.rating.toFixed(1)} · заказов {s.completedOrders}
              </p>
              {/* Слова самого поставщика о своей технике. Категория из
                  справочника не отличает 25-тонник от 10-тонника, а заявки
                  приходят именно на тоннаж и длину стрелы. */}
              {s.selfDescription && (
                <p className="mt-1 whitespace-pre-line rounded-lg bg-sky-50 px-2 py-1 text-sky-900">
                  <span className="text-sky-600">С его слов:</span> {s.selfDescription}
                </p>
              )}
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
            <div className="flex shrink-0 flex-col items-end gap-2">
              <div className="flex gap-2">
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
              <button
                className="text-xs text-brand-700 underline"
                onClick={() => setBillingFor(billingFor === s.id ? null : s.id)}
              >
                {billingFor === s.id ? "Скрыть счета и оплаты" : "Счета и оплаты"}
              </button>
            </div>
          </Card>
          {/* Раскрывается под своей карточкой, а не в отдельном окне:
              оператор сверяет детализацию с тем, что видит в списке. */}
          {billingFor === s.id && <SupplierBilling token={token} supplierId={s.id} />}
          </div>
        ))}
      </div>
    </div>
  );
}

const INVOICE_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "ждёт оплаты", cls: "text-amber-700" },
  PAID: { label: "оплачен", cls: "text-emerald-700" },
  CANCELLED: { label: "отменён", cls: "text-slate-400" },
};

/**
 * Счета, платежи и подписка одного поставщика.
 *
 * Три таблицы рядом, потому что ответ на «я оплатил, почему не работает?»
 * почти всегда в стыке между ними: счёт выставлен и не оплачен, платёж прошёл
 * по чужому номеру, подписка кончилась вчера. По отдельности каждая выглядит
 * нормально.
 */
function SupplierBilling({ token, supplierId }: { token: string; supplierId: string }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    adminApi.getSupplierBilling(token, supplierId).then(setData).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [token, supplierId]);

  if (error) return <p className="px-3 text-sm text-red-600">{error}</p>;
  if (!data) return <p className="px-3 text-sm text-slate-400">Загружаю…</p>;

  const d = (v: string | null) => (v ? new Date(v).toLocaleDateString("ru-RU") : "—");
  const dt = (v: string | null) => (v ? new Date(v).toLocaleString("ru-RU") : "—");

  return (
    <Card className="ml-4 border-l-4 border-brand-200 p-3 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <p>
          <span className="font-medium">Подписка:</span>{" "}
          {data.subscription.active ? (
            <span className="text-emerald-700">активна до {d(data.subscription.currentPeriodEnd)}</span>
          ) : (
            <span className="text-slate-400">нет</span>
          )}
          {data.subscription.paymentProvider && (
            <span className="text-slate-400"> · через {data.subscription.paymentProvider}</span>
          )}
          <span className="text-slate-500">
            {" "}
            · бесплатных за месяц: {data.notificationsUsedThisMonth} из {data.freeQuota}
          </span>
        </p>
        <Button
          variant="secondary"
          onClick={() => adminApi.issueSupplierInvoice(token, supplierId).then(load)}
        >
          Выставить счёт
        </Button>
      </div>

      <p className="mb-1 text-xs font-medium text-slate-500">Счета</p>
      {data.invoices.length === 0 ? (
        <p className="mb-3 text-slate-400">Не выставлялись.</p>
      ) : (
        <table className="mb-3 w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="pb-1">Номер</th>
              <th className="pb-1 text-right">Сумма</th>
              <th className="pb-1 text-right">Дней</th>
              <th className="pb-1">Статус</th>
              <th className="pb-1">Выставлен</th>
              <th className="pb-1">Оплачен</th>
            </tr>
          </thead>
          <tbody>
            {data.invoices.map((i: any) => {
              const st = INVOICE_STATUS[i.status] ?? { label: i.status, cls: "" };
              const expired = i.status === "PENDING" && new Date(i.expiresAt) < new Date();
              return (
                <tr key={i.number} className="border-t border-slate-100">
                  <td className="py-1 font-mono">{i.number}</td>
                  <td className="py-1 text-right tabular-nums">{i.amountTenge} ₸</td>
                  <td className="py-1 text-right tabular-nums">{i.periodDays}</td>
                  <td className={`py-1 ${expired ? "text-slate-400" : st.cls}`}>
                    {expired ? "просрочен" : st.label}
                  </td>
                  <td className="py-1 text-slate-500">{d(i.createdAt)}</td>
                  <td className="py-1 text-slate-500">{d(i.paidAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p className="mb-1 text-xs font-medium text-slate-500">Платежи Kaspi</p>
      {data.payments.length === 0 ? (
        <p className="text-slate-400">Не было.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="pb-1">Счёт</th>
              <th className="pb-1 text-right">Сумма</th>
              <th className="pb-1 text-right">Дней</th>
              <th className="pb-1">Дата Kaspi</th>
              <th className="pb-1">Ответ</th>
              <th className="pb-1">txn_id</th>
            </tr>
          </thead>
          <tbody>
            {data.payments.map((p: any) => (
              <tr key={p.txnId} className="border-t border-slate-100">
                <td className="py-1 font-mono">{p.account}</td>
                <td className="py-1 text-right tabular-nums">{p.sumTenge ?? "—"} ₸</td>
                <td className="py-1 text-right tabular-nums">{p.daysGranted ?? "—"}</td>
                {/* Дата от Kaspi, а не наша: по ней банк ведёт сверку. */}
                <td className="py-1 text-slate-500">{dt(p.txnDate)}</td>
                <td className={`py-1 ${p.result === 0 ? "text-emerald-700" : "text-red-600"}`}>
                  {p.result === 0 ? "зачислен" : `код ${p.result} · ${p.comment ?? ""}`}
                </td>
                <td className="py-1 font-mono text-slate-400">{p.txnId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
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

function ProspectsTab({ token }: { token: string }) {
  const [funnel, setFunnel] = useState<ProspectFunnelDto | null>(null);
  const [prospects, setProspects] = useState<ProspectContactDto[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeOrders, setActiveOrders] = useState<any[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      adminApi.getProspectFunnel(token),
      adminApi.listProspects(token, { status: statusFilter, city: cityFilter }),
    ])
      .then(([f, list]) => {
        setFunnel(f);
        setProspects(list);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [token, statusFilter, cityFilter]);
  useEffect(() => {
    adminApi.listOrders(token, { queue: "active" }).then(setActiveOrders);
  }, [token]);

  const send = async () => {
    setError(null);
    setSending(true);
    try {
      await adminApi.initiateProspect(token, phone, selectedOrderId);
      setPhone("");
      setSelectedOrderId("");
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      {funnel && (
        <div className="mb-4 grid grid-cols-4 gap-2">
          {(
            [
              ["Отправлено", funnel.sent],
              ["Ответили", funnel.responded],
              ["Зарегистрировались", funnel.registered],
              ["Активны", funnel.active],
            ] as const
          ).map(([label, value]) => (
            <Card key={label} className="p-3 text-center">
              <p className="text-2xl font-semibold">{value}</p>
              <p className="text-xs text-slate-500">{label}</p>
            </Card>
          ))}
        </div>
      )}

      <Card className="mb-4 flex flex-wrap items-end gap-2 p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Заявка (из очереди PUBLISHED)</label>
          <select
            value={selectedOrderId}
            onChange={(e) => setSelectedOrderId(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Выберите заявку</option>
            {activeOrders.map((o) => (
              <option key={o.id} value={o.id}>
                №{o.number} · {o.categoryName ?? "—"} · {o.city ?? "—"} · уведомлено: {o.notifiedSuppliersCount}
              </option>
            ))}
          </select>
        </div>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Телефон поставщика"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <Button onClick={send} disabled={sending || !phone || !selectedOrderId}>
          Отправить холодное сообщение
        </Button>
        {error && <p className="w-full text-sm text-red-600">{error}</p>}
      </Card>

      <div className="mb-4 flex gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">Все статусы</option>
          {Object.entries(PROSPECT_STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          value={cityFilter}
          onChange={(e) => setCityFilter(e.target.value)}
          placeholder="Город"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-2">
          {prospects.map((p) => (
            <Card key={p.id} className="flex items-center justify-between p-3 text-sm">
              <div>
                <p className="font-medium">
                  {p.phone} · №{p.orderNumber} · {p.categoryName ?? "—"} · {p.city ?? "—"}
                </p>
                <p className="text-slate-500">
                  Первый контакт: {new Date(p.firstContactedAt).toLocaleString("ru-RU")}
                  {p.respondedAt && ` · ответил: ${new Date(p.respondedAt).toLocaleString("ru-RU")}`}
                  {p.convertedAt && ` · зарегистрировался: ${new Date(p.convertedAt).toLocaleString("ru-RU")}`}
                </p>
              </div>
              <span
                className={`rounded-full px-2 py-1 text-xs ${
                  p.status === "converted"
                    ? "bg-emerald-100 text-emerald-700"
                    : p.status === "ignored"
                      ? "bg-slate-100 text-slate-500"
                      : "bg-amber-100 text-amber-700"
                }`}
              >
                {PROSPECT_STATUS_LABEL[p.status] ?? p.status}
              </span>
            </Card>
          ))}
          {prospects.length === 0 && <p className="text-sm text-slate-400">Пусто</p>}
        </div>
      )}
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
