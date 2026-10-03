"use client";
import { useEffect, useRef, useState } from "react";

type Actor = { id: string; email: string; role: string };
type Tenant = {
  id: string;
  version: number;
  tenantName: string;
  provisionStatus: string;
  enforcementEnabled: boolean;
  awsStatus: string;
  localPaused: boolean;
  pauseReason: string | null;
  syncError: string | null;
  limitMode: string;
  ratePerSecond: number | null;
  rollingDayLimit: number | null;
  lastSyncedAt: string | null;
  findings?: { Description?: string; Impact?: string }[];
};
type Merchant = {
  id: string;
  name: string;
  sendingTenants: Tenant[];
  sites: {
    id: string;
    name: string;
    emailProvider: {
      provider: string;
      brandDomain: string;
      configurationSetName?: string;
      connectionStatus: string;
    } | null;
  }[];
  events?: { type: string; _count: number }[];
};
type Row = Record<string, any>;
const sections = [
  "运营概览",
  "商户管理",
  "积压审核",
  "告警中心",
  "操作记录",
  "管理员管理",
];
const statusNames: Record<string, string> = {
  SENT: "发送", DELIVERED: "送达", BOUNCED: "退信", COMPLAINED: "投诉", OPENED: "打开", CLICKED: "点击", DELIVERY_DELAYED: "延迟", SUPPRESSED: "已抑制",
  ENABLED: "允许发送",
  REINSTATED: "允许发送",
  DISABLED: "AWS 暂停",
  UNKNOWN: "待确认",
  READY: "已就绪",
  PENDING: "等待处理",
  RUNNING: "执行中",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  HELD: "待审核",
  OPEN: "未处理",
  RESOLVED: "已处理",
  observe: "观察",
  enforce: "拦截",
  OWNER: "平台所有者",
  OPERATOR: "平台运营",
  VIEWER: "只读人员",
};
const label = (x: string) => statusNames[x] ?? x;
async function api(path: string, value?: unknown) {
  const response = await fetch(`/api/${path}`, {
    method: value === undefined ? "GET" : "POST",
    headers: value === undefined ? {} : { "content-type": "application/json" },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "请求未完成");
  return result;
}
const time = (value: string | null) =>
  value ? new Date(value).toLocaleString("zh-CN") : "尚未同步";
function Badge({ value }: { value: string }) {
  return (
    <span
      className={`badge ${["DISABLED", "FAILED", "HELD", "暂停"].includes(value) ? "danger" : ["ENABLED", "SUCCEEDED", "READY", "RESOLVED"].includes(value) ? "good" : ""}`}
    >
      {label(value)}
    </span>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}
export default function Home() {
  const commandIds = useRef(new Map<string, string>());
  const [actor, setActor] = useState<Actor | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState("运营概览");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState<Row>({});
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [detail, setDetail] = useState<Merchant | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [review, setReview] = useState<Row | null>(null);
  const [pending, setPending] = useState<{
    action: string;
    tenant: Tenant;
    org: string;
  } | null>(null);
  const [setup, setSetup] = useState("");
  const [enrollment, setEnrollment] = useState<Row | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [taskFilter, setTaskFilter] = useState({
    org: "",
    campaign: "",
    from: "",
    to: "",
  });
  const [reauth, setReauth] = useState(false);
  const [authAudit, setAuthAudit] = useState<Row[]>([]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get("setup");
    if (token) {
      setSetup(token);
      history.replaceState({}, "", "/");
    }
    api("auth")
      .then(setActor)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function load() {
    if (!actor) return;
    if (section === "运营概览") setOverview(await api("core/overview"));
    if (section === "商户管理") {
      const data = await api(
        `core/organizations?q=${encodeURIComponent(query)}&page=${page}&status=${filter}`,
      );
      setMerchants(data.items);
      setTotal(data.total);
    }
    if (section === "积压审核") {
      setRows(
        await api(
          `core/tasks?organizationId=${encodeURIComponent(taskFilter.org)}&campaignId=${encodeURIComponent(taskFilter.campaign)}&from=${encodeURIComponent(taskFilter.from)}&to=${encodeURIComponent(taskFilter.to)}`,
        ),
      );
      setSelected([]);
    }
    if (section === "告警中心") setRows(await api("core/alerts"));
    if (section === "操作记录") setRows(await api("core/operations"));
    if (section === "管理员管理") {
      const data = await api("admins");
      setRows(data.admins);
      setAuthAudit(data.audit);
    }
  }
  useEffect(() => {
    if (actor) void run(load);
  }, [actor, section, page, filter]);
  async function open(id: string) {
    setDetail(await api(`core/organizations/${id}`));
  }
  async function command(input: Row) {
    const key = JSON.stringify({ actorId: actor?.id, ...input });
    const operationId = commandIds.current.get(key) ?? crypto.randomUUID();
    commandIds.current.set(key, operationId);
    let result;
    try {
      result = await api("core/commands", { ...input, operationId });
    } catch (error) {
      setNotice(
        `操作 ID：${operationId}。请先在操作记录确认结果；再次提交相同内容将复用此 ID。`,
      );
      throw error;
    }
    setNotice(
      `操作 ${result.id}：${label(result.status)}。异步操作可在操作记录中查询。`,
    );
    setPending(null);
    setReview(null);
    if (detail) await open(detail.id);
    await load();
  }
  const tenant = detail?.sendingTenants[0];
  if (loading)
    return (
      <main className="login">
        <p>正在验证平台会话…</p>
      </main>
    );
  if (!actor || setup || codes.length)
    return (
      <main className="login">
        <section className="login-panel">
          <div className="brand">
            <span className="brand-mark">S</span>
            <strong>
              SenderMaster <small>OPERATIONS</small>
            </strong>
          </div>
          <h1>{setup ? "启用平台账号" : "平台管理员登录"}</h1>
          <p className="muted">商户邮件运营与发送安全</p>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          {codes.length ? (
            <>
              <h2>保存一次性恢复码</h2>
              <p>每个恢复码只能使用一次。请保存在密码管理器中。</p>
              <pre>{codes.join("\n")}</pre>
              <button
                onClick={() => {
                  setCodes([]);
                  setSetup("");
                  location.reload();
                }}
              >
                已安全保存，进入后台
              </button>
            </>
          ) : setup ? (
            <>
              {!enrollment ? (
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () =>
                      setEnrollment(
                        await api("auth", { action: "enroll", token: setup }),
                      ),
                    )
                  }
                >
                  开始设置验证器
                </button>
              ) : (
                <>
                  <img
                    className="qr"
                    src={enrollment.qr}
                    alt="验证器绑定二维码"
                  />
                  <p className="muted">无法扫描时，手动输入密钥：</p>
                  <code className="secret">{enrollment.secret}</code>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void run(async () => {
                        const data = await api("auth", {
                          action: "activate",
                          token: setup,
                          password: f.get("password"),
                          code: f.get("code"),
                        });
                        setCodes(data.recoveryCodes);
                      });
                    }}
                  >
                    <label>
                      设置密码（至少 14 个字符）
                      <input
                        name="password"
                        type="password"
                        minLength={14}
                        maxLength={128}
                        autoComplete="new-password"
                        required
                      />
                    </label>
                    <label>
                      验证器验证码
                      <input
                        name="code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        required
                      />
                    </label>
                    <button disabled={busy}>完成绑定</button>
                  </form>
                </>
              )}
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () => {
                  await api("auth", {
                    action: "login",
                    email: f.get("email"),
                    password: f.get("password"),
                    code: f.get("code"),
                    recovery: f.get("recovery") === "on",
                  });
                  setActor(await api("auth"));
                });
              }}
            >
              <label>
                平台账号邮箱
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                密码
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={128}
                />
              </label>
              <label>
                验证器验证码 / 恢复码
                <input
                  name="code"
                  autoComplete="one-time-code"
                  required
                  maxLength={80}
                />
              </label>
              <label className="checkbox">
                <input type="checkbox" name="recovery" />
                使用一次性恢复码
              </label>
              <button disabled={busy}>
                {busy ? "正在验证…" : "登录管理后台"}
              </button>
              <p className="muted fine">
                仅限获授权的平台管理员。没有公开注册入口。
              </p>
            </form>
          )}
        </section>
        <aside className="login-story">
          <span className="eyebrow">邮件运营控制台</span>
          <h2>
            每个商户的
            <br />
            发送状态，清晰可见。
          </h2>
          <p>独立额度 · 信誉告警 · 受控恢复</p>
          <div className="signal-line">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </aside>
      </main>
    );
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">S</span>
          <strong>
            SenderMaster<small>平台运营</small>
          </strong>
        </div>
        <nav aria-label="主导航">
          {sections
            .filter((x) => x !== "管理员管理" || actor.role === "OWNER")
            .map((name, i) => (
              <button
                key={name}
                className={section === name ? "active" : ""}
                onClick={() => {
                  setSection(name);
                  setDetail(null);
                  setPage(1);
                }}
              >
                <span>{["◈", "▤", "◷", "△", "≡", "◇"][i]}</span>
                {name}
              </button>
            ))}
        </nav>
        <div className="account">
          <Badge value={actor.role} />
          <p>{actor.email}</p>
          <button className="link" onClick={() => setReauth(true)}>
            再次验证
          </button>
          <button
            className="link"
            onClick={() =>
              run(async () => {
                await api("auth", { action: "logout" });
                setActor(null);
              })
            }
          >
            退出
          </button>
        </div>
      </aside>
      <main className="workspace">
        <header>
          <div>
            <span className="eyebrow">SENDERMASTER / OPERATIONS</span>
            <h1>{detail ? detail.name : section}</h1>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await load();
                if (detail) await open(detail.id);
              })
            }
          >
            {busy ? "更新中…" : "刷新状态"}
          </button>
        </header>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {section === "运营概览" && (
          <>
            <div className="section-heading">
              <h2>发送运行状况</h2>
              <span className="muted">已接入租户 · 滚动 24 小时</span>
            </div>
            <div className="metrics">
              {[
                ["商户总数", "organizations"],
                ["已接入租户", "tenants"],
                ["发送提交成功", "sent"],
                ["暂停商户", "paused"],
                ["待审任务", "held"],
                ["未处理告警", "alerts"],
              ].map(([name, key]) => (
                <article key={key}>
                  <span>{name}</span>
                  <strong>{overview[key] ?? "—"}</strong>
                </article>
              ))}
            </div>
            <div className="callout">
              <div>
                <h2>恢复发送前，先检查积压任务</h2>
                <p>
                  恢复商户发送权限后，历史待审邮件仍会保留。审核具体任务并释放，才能继续发送。
                </p>
              </div>
              <button onClick={() => setSection("积压审核")}>
                查看待审任务 →
              </button>
            </div>
            <div className="two-col">
              <section className="panel">
                <h2>逐商户启用额度</h2>
                <p>
                  先观察发送量，再设置每秒速率和滚动 24
                  小时上限。切换到拦截模式后，超额任务会等待额度恢复。
                </p>
                <button
                  className="secondary"
                  onClick={() => setSection("商户管理")}
                >
                  查看商户
                </button>
              </section>
              <section className="panel">
                <h2>先处理影响发送的异常</h2>
                <p>
                  信誉暂停和状态同步失败会阻止或暂缓发送。进入告警中心查看原因与处理状态。
                </p>
                <button
                  className="secondary"
                  onClick={() => setSection("告警中心")}
                >
                  查看告警
                </button>
              </section>
            </div>
          </>
        )}
        {section === "商户管理" && !detail && (
          <>
            <form
              className="toolbar"
              onSubmit={(e) => {
                e.preventDefault();
                setPage(1);
                void run(load);
              }}
            >
              <input
                aria-label="搜索商户或域名"
                placeholder="搜索商户名称或发送域名"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button>查询</button>
              <select
                aria-label="商户状态筛选"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">全部发送状态</option>
                <option value="paused">暂停发送</option>
                <option value="connected">已接入租户</option>
                <option value="pending">未接入租户</option>
              </select>
            </form>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>商户 / 站点</th>
                    <th>发送域名</th>
                    <th>租户接入</th>
                    <th>发送状态</th>
                    <th>额度模式</th>
                  </tr>
                </thead>
                <tbody>
                  {merchants
                    .filter(
                      (m) =>
                        filter === "all" ||
                        (filter === "paused"
                          ? m.sendingTenants.some((t) => t.localPaused)
                          : filter === "connected"
                            ? m.sendingTenants.some((t) => t.enforcementEnabled)
                            : !m.sendingTenants.some(
                                (t) => t.enforcementEnabled,
                              )),
                    )
                    .map((m) => (
                      <tr key={m.id}>
                        <td>
                          <button
                            className="link name"
                            onClick={() => run(() => open(m.id))}
                          >
                            {m.name}
                          </button>
                          <small>
                            {m.sites.map((s) => s.name).join(" · ") ||
                              "暂无站点"}
                          </small>
                        </td>
                        <td>
                          {m.sites
                            .map((s) => s.emailProvider?.brandDomain)
                            .filter(Boolean)
                            .join("、") || "未绑定"}
                        </td>
                        <td>
                          {m.sendingTenants[0]?.enforcementEnabled ? (
                            <Badge
                              value={m.sendingTenants[0].provisionStatus}
                            />
                          ) : (
                            "未接入"
                          )}
                        </td>
                        <td>
                          {m.sendingTenants[0] ? (
                            <Badge
                              value={
                                m.sendingTenants[0].localPaused
                                  ? "暂停"
                                  : m.sendingTenants[0].awsStatus
                              }
                            />
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {label(m.sendingTenants[0]?.limitMode ?? "observe")}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {!merchants.length && (
                <Empty>暂无匹配商户。请调整查询条件。</Empty>
              )}
            </div>
            <div className="pagination">
              <span>
                共 {total} 个商户 · 第 {page} 页
              </span>
              <button
                className="secondary"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                上一页
              </button>
              <button
                className="secondary"
                disabled={page * 30 >= total}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </button>
            </div>
          </>
        )}
        {detail && (
          <>
            <button className="link" onClick={() => setDetail(null)}>
              ← 返回商户列表
            </button>
            <div className="detail-grid">
              <section className="panel">
                <h2>发送健康状态</h2>
                {tenant ? (
                  <>
                    <Badge
                      value={tenant.localPaused ? "暂停" : tenant.awsStatus}
                    />
                    <dl>
                      <dt>SES 租户</dt>
                      <dd className="mono">{tenant.tenantName}</dd>
                      <dt>最新同步</dt>
                      <dd>{time(tenant.lastSyncedAt)}</dd>
                      <dt>受阻原因</dt>
                      <dd>{tenant.pauseReason || tenant.syncError || "无"}</dd>
                    </dl>
                    {tenant.findings?.map((f, i) => (
                      <p key={i} className="notice error">
                        {f.Impact} · {f.Description}
                      </p>
                    ))}
                    {actor.role !== "VIEWER" && (
                      <div className="actions">
                        <button
                          className="danger-button"
                          disabled={busy}
                          onClick={() =>
                            setPending({
                              action: "pause",
                              tenant,
                              org: detail.id,
                            })
                          }
                        >
                          暂停发送
                        </button>
                        {actor.role === "OWNER" && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              setPending({
                                action: "resume",
                                tenant,
                                org: detail.id,
                              })
                            }
                          >
                            恢复发送权限
                          </button>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <Empty>
                    该商户尚未接入 SES 租户。完成迁移后可设置发送策略。
                  </Empty>
                )}
              </section>
              <section className="panel">
                <h2>商户发送额度</h2>
                {tenant && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void run(() =>
                        command({
                          organizationId: detail.id,
                          version: tenant.version,
                          action: "policy",
                          limitMode: f.get("mode"),
                          ratePerSecond: f.get("rate")
                            ? Number(f.get("rate"))
                            : null,
                          rollingDayLimit: f.get("day")
                            ? Number(f.get("day"))
                            : null,
                          reason: f.get("reason"),
                        }),
                      );
                    }}
                    key={tenant.version}
                  >
                    <label>
                      每秒速率
                      <input
                        disabled={actor.role === "VIEWER"}
                        type="number"
                        name="rate"
                        min="0.01"
                        step="0.01"
                        defaultValue={tenant.ratePerSecond ?? ""}
                        placeholder="不限制"
                      />
                    </label>
                    <label>
                      滚动 24 小时上限
                      <input
                        disabled={actor.role === "VIEWER"}
                        type="number"
                        name="day"
                        min="1"
                        defaultValue={tenant.rollingDayLimit ?? ""}
                        placeholder="不限制"
                      />
                    </label>
                    <label>
                      执行方式
                      <select
                        name="mode"
                        defaultValue={tenant.limitMode}
                        disabled={actor.role === "VIEWER"}
                      >
                        <option value="observe">观察：统计并告警</option>
                        <option value="enforce">拦截：超额等待</option>
                      </select>
                    </label>
                    {actor.role !== "VIEWER" && (
                      <>
                        <label>
                          修改原因
                          <input
                            name="reason"
                            minLength={5}
                            maxLength={1000}
                            required
                          />
                        </label>
                        <button disabled={busy}>保存发送设置</button>
                      </>
                    )}
                  </form>
                )}
              </section>
            </div>
            <section className="panel">
              <h2>站点与域名</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>站点</th>
                      <th>服务商</th>
                      <th>域名</th>
                      <th>配置集</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.sites.map((s) => (
                      <tr key={s.id}>
                        <td>{s.name}</td>
                        <td>{s.emailProvider?.provider || "—"}</td>
                        <td>{s.emailProvider?.brandDomain || "—"}</td>
                        <td className="mono">
                          {s.emailProvider?.configurationSetName || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h2>近 30 天邮件事件</h2>
              <div className="event-strip">
                {detail.events?.length ? (
                  detail.events.map((e) => (
                    <span key={e.type}>
                      {label(e.type)}
                      <b>{e._count}</b>
                    </span>
                  ))
                ) : (
                  <p className="muted">暂无邮件事件。</p>
                )}
              </div>
            </section>
          </>
        )}
        {section === "积压审核" && (
          <>
            <form
              className="toolbar"
              onSubmit={(e) => {
                e.preventDefault();
                void run(load);
              }}
            >
              <input
                aria-label="商户 ID"
                placeholder="商户 ID（可选）"
                value={taskFilter.org}
                onChange={(e) =>
                  setTaskFilter({ ...taskFilter, org: e.target.value })
                }
              />
              <input
                aria-label="活动 ID"
                placeholder="活动 ID（可选）"
                value={taskFilter.campaign}
                onChange={(e) =>
                  setTaskFilter({ ...taskFilter, campaign: e.target.value })
                }
              />
              <label>
                开始时间
                <input
                  type="datetime-local"
                  value={taskFilter.from}
                  onChange={(e) =>
                    setTaskFilter({ ...taskFilter, from: e.target.value })
                  }
                />
              </label>
              <label>
                结束时间
                <input
                  type="datetime-local"
                  value={taskFilter.to}
                  onChange={(e) =>
                    setTaskFilter({ ...taskFilter, to: e.target.value })
                  }
                />
              </label>
              <button disabled={busy}>筛选任务</button>
            </form>
            <p className="muted">
              每次最多展示最早的 100
              条待审任务。请按同一商户选择；预览后批准的批次不会包含新增任务。
            </p>
            <div className="toolbar">
              <span>已选择 {selected.length} 条</span>
              {actor.role === "OWNER" && (
                <button
                  disabled={!selected.length || busy}
                  onClick={() =>
                    run(async () => {
                      const chosen = rows.filter((r) =>
                        selected.includes(r.id),
                      );
                      if (
                        new Set(chosen.map((r) => r.organizationId)).size !== 1
                      )
                        throw new Error("一次只能审核同一商户的任务");
                      setReview(
                        await api("core/reviews", {
                          organizationId: chosen[0].organizationId,
                          taskIds: selected,
                        }),
                      );
                    })
                  }
                >
                  预览选定任务
                </button>
              )}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>选择</th>
                    <th>商户</th>
                    <th>任务</th>
                    <th>挂起原因</th>
                    <th>创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <input
                          aria-label={`选择任务 ${r.messageId}`}
                          type="checkbox"
                          disabled={actor.role !== "OWNER"}
                          checked={selected.includes(r.id)}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, r.id]
                                : selected.filter((id) => id !== r.id),
                            )
                          }
                        />
                      </td>
                      <td className="mono">{r.organizationId}</td>
                      <td>
                        {r.kind}
                        <small>{r.messageId}</small>
                      </td>
                      <td>{r.reason}</td>
                      <td>{time(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!rows.length && <Empty>当前没有待审核的积压任务。</Empty>}
            </div>
          </>
        )}
        {section === "告警中心" && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>告警</th>
                  <th>商户</th>
                  <th>状态</th>
                  <th>时间</th>
                  <th>处理</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.kind}</strong>
                      <small>{r.message}</small>
                    </td>
                    <td className="mono">{r.organizationId || "平台"}</td>
                    <td>
                      <Badge value={r.status} />
                    </td>
                    <td>{time(r.createdAt)}</td>
                    <td>
                      {actor.role !== "VIEWER" &&
                        r.organizationId &&
                        r.status === "OPEN" && (
                          <button
                            className="secondary"
                            onClick={() =>
                              run(async () => {
                                const merchant = await api(
                                  `core/organizations/${r.organizationId}`,
                                );
                                setPending({
                                  action: `alert-resolve:${r.id}`,
                                  tenant: merchant.sendingTenants[0],
                                  org: r.organizationId,
                                });
                              })
                            }
                          >
                            标记已处理
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <Empty>暂无告警记录。</Empty>}
          </div>
        )}
        {section === "操作记录" && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>操作 / 请求 ID</th>
                  <th>操作者</th>
                  <th>原因</th>
                  <th>结果</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.action}
                      <small className="mono">{r.id}</small>
                    </td>
                    <td>
                      {r.actorId}
                      <small>{label(r.actorRole)}</small>
                    </td>
                    <td>
                      {r.reason}
                      <details>
                        <summary>修改前与结果</summary>
                        <pre>
                          {JSON.stringify(
                            {
                              before: r.before,
                              requested: r.input,
                              result: r.result,
                              error: r.error,
                            },
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    </td>
                    <td>
                      <Badge value={r.status} />
                    </td>
                    <td>{time(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <Empty>暂无平台业务操作。</Empty>}
          </div>
        )}
        {section === "管理员管理" && (
          <>
            <section className="panel">
              <h2>邀请平台管理员</h2>
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(async () => {
                    const result = await api("admins", {
                      action: "create",
                      email: f.get("email"),
                      role: f.get("role"),
                      reason: f.get("reason"),
                    });
                    setNotice(`请安全传递一次性初始化链接：${result.setupUrl}`);
                    await load();
                  });
                }}
              >
                <label>
                  邮箱
                  <input type="email" name="email" required />
                </label>
                <label>
                  角色
                  <select name="role">
                    <option value="VIEWER">只读人员</option>
                    <option value="OPERATOR">平台运营</option>
                    <option value="OWNER">平台所有者</option>
                  </select>
                </label>
                <label>
                  原因
                  <input name="reason" minLength={5} required />
                </label>
                <button disabled={busy}>创建账号</button>
              </form>
            </section>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>账号</th>
                    <th>角色</th>
                    <th>状态</th>
                    <th>管理</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.email}</td>
                      <td>{label(r.role)}</td>
                      <td>{r.active ? "启用" : "停用"}</td>
                      <td>
                        <form
                          className="inline-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            void run(async () => {
                              const result = await api("admins", {
                                action: f.get("action"),
                                id: r.id,
                                role: f.get("role"),
                                reason: f.get("reason"),
                              });
                              if (result.setupUrl)
                                setNotice(`重置链接：${result.setupUrl}`);
                              else setNotice("账号设置已更新，相关会话已撤销");
                              await load();
                            });
                          }}
                        >
                          <select aria-label="管理员操作" name="action">
                            <option value="revoke">撤销会话</option>
                            <option value="disable">停用账号</option>
                            <option value="reset">重置密码与验证器</option>
                            <option value="role">修改角色</option>
                          </select>
                          <select
                            name="role"
                            aria-label="目标角色"
                            defaultValue={r.role}
                          >
                            <option value="VIEWER">只读</option>
                            <option value="OPERATOR">运营</option>
                            <option value="OWNER">所有者</option>
                          </select>
                          <input
                            name="reason"
                            aria-label="账号操作原因"
                            placeholder="操作原因"
                            minLength={5}
                            required
                          />
                          <button disabled={busy}>执行</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <section className="panel">
              <h2>认证与账号记录</h2>
              {authAudit.map((r) => (
                <p key={r.id} className="audit-line">
                  <time>{time(r.createdAt)}</time>
                  <span>{r.action}</span>
                  <span className="mono">{r.actorId}</span>
                </p>
              ))}
            </section>
          </>
        )}
      </main>
      {(pending || reauth || review) && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
          >
            <button
              className="close secondary"
              aria-label="关闭对话框"
              onClick={() => {
                setPending(null);
                setReauth(false);
                setReview(null);
              }}
            >
              ×
            </button>
            <h2 id="dialog-title">
              {reauth
                ? "再次验证身份"
                : review
                  ? "审核选定邮件"
                  : pending?.action === "resume"
                    ? "恢复商户发送权限"
                    : pending?.action === "pause"
                      ? "暂停商户发送"
                      : "处理告警"}
            </h2>
            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
            {reauth ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(async () => {
                    await api("auth", {
                      action: "reauth",
                      code: f.get("code"),
                    });
                    setReauth(false);
                    setNotice("已完成身份验证，五分钟内可执行敏感操作");
                  });
                }}
              >
                <label>
                  验证器验证码
                  <input
                    name="code"
                    autoFocus
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    required
                  />
                </label>
                <button disabled={busy}>确认身份</button>
              </form>
            ) : review ? (
              <>
                <p>
                  此次审核仅包含下列 {review.tasks.length}{" "}
                  条任务。有效期十五分钟；发送前会再次校验退订和业务状态。
                </p>
                <div className="review-list">
                  {[...review.messages, ...review.conversations].map(
                    (m: Row) => (
                      <article key={m.id}>
                        <strong>{m.subject}</strong>
                        <p>{m.recipientEmail || m.toEmails.join("、")}</p>
                        <details><summary>查看正文文本</summary><pre>{m.previewText || "无正文文本"}</pre></details>
                        <small>
                          {time(m.createdAt)} ·{" "}
                          {m.campaignId || "会话 / 自动化"}
                        </small>
                      </article>
                    ),
                  )}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(async () => {
                      const merchant = await api(
                        `core/organizations/${review.batch.organizationId}`,
                      );
                      await command({
                        action: f.get("action"),
                        organizationId: review.batch.organizationId,
                        batchId: review.batch.id,
                        version: merchant.sendingTenants[0].version,
                        reason: f.get("reason"),
                      });
                    });
                  }}
                >
                  <label>
                    审核结果
                    <select name="action">
                      <option value="release">释放选定任务</option>
                      <option value="cancel">取消选定任务</option>
                    </select>
                  </label>
                  <label>
                    审核原因
                    <input name="reason" minLength={5} required />
                  </label>
                  <button disabled={busy}>确认审核结果</button>
                </form>
              </>
            ) : (
              pending && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(() =>
                      command({
                        action: pending.action.split(":")[0],
                        ...(pending.action.includes(":")
                          ? { alertId: pending.action.split(":")[1] }
                          : {}),
                        organizationId: pending.org,
                        version: pending.tenant.version,
                        reason: f.get("reason"),
                      }),
                    );
                  }}
                >
                  <p>
                    {pending.action === "resume"
                      ? "仅恢复新邮件发送权限。已挂起的邮件仍需单独审核。"
                      : pending.action === "pause"
                        ? "该商户的新任务和未发送任务将进入待审状态。"
                        : "处理记录将保留在操作日志中。"}
                  </p>
                  <label>
                    操作原因
                    <input
                      name="reason"
                      minLength={5}
                      maxLength={1000}
                      autoFocus
                      required
                    />
                  </label>
                  <button disabled={busy}>确认操作</button>
                </form>
              )
            )}
          </section>
        </div>
      )}
    </div>
  );
}
