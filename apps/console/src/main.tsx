import React, {
  useState,
  useEffect,
  type FormEvent,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  Globe,
  Users,
  Send,
  ClipboardCheck,
  FileCheck2,
  Settings,
  ArrowUpRight,
  ArrowRight,
  ShieldCheck,
  ChevronDown,
  Search,
  Plus,
  Check,
  Clock,
  Download,
  X,
  LogOut,
  RefreshCw,
  Layers,
  PanelLeft,
} from "lucide-react";
import "./style.css";
const labels: Record<string, string> = {
  GRANTED: "동의",
  DENIED: "거부",
  REVOKED: "철회",
  UNKNOWN: "미선택",
  VERIFIED: "검증됨",
  LEGACY_UNVERIFIED: "증빙 미확인",
  REVIEW_REQUIRED: "검토 필요",
  queued: "발송 대기",
  blocked: "차단",
  cancelled: "취소",
  accepted: "공급자 접수",
  delivered: "전달 완료",
  unknown: "접수 확인 필요",
  dispatching: "전송 중",
  pending: "대기",
  manual_required: "담당자 확인",
  open: "처리 중",
  completed: "완료",
  draft: "초안",
  published: "게시됨",
  approved: "승인됨",
  active: "연결됨",
  partial: "부분 검증",
  unverified: "미검증",
  failed: "실패",
  CONSENT_WITHDRAWN: "광고 수신 동의 철회",
  RECEPTION_CONSENT_MISSING: "광고 수신 동의 없음",
  MARKETING_USE_CONSENT_MISSING: "마케팅 이용 동의 없음",
  EVIDENCE_UNVERIFIED: "동의 증빙 미확인",
  SUPPRESSED: "수신거부 목록 등록",
  OUTSIDE_DAYTIME: "주간 발송 시간 외",
  QUOTA_EXCEEDED: "발송 한도 초과",
  CONTACT_UNVERIFIED: "연락처 미검증",
  owner: "소유자",
  privacy_officer: "개인정보 담당자",
  marketer: "마케팅 담당자",
  developer: "개발자",
  auditor: "감사 열람자",
};
const label = (v: string) => labels[v] ?? v;
const date = (v: any) =>
  v
    ? new Date(v).toLocaleString("ko-KR", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Seoul",
      })
    : "—";
async function api(url: string, body?: unknown, method?: string) {
  const r = await fetch("/v1" + url, {
    method: method ?? (body ? "POST" : "GET"),
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.code ?? data.error ?? "요청 실패");
  return data;
}
function Badge({ value }: { value: string }) {
  return (
    <span
      className={
        "badge " +
        ([
          "GRANTED",
          "VERIFIED",
          "delivered",
          "published",
          "approved",
          "active",
          "completed",
        ].includes(value)
          ? "good"
          : ["DENIED", "REVOKED", "blocked", "failed"].includes(value)
            ? "bad"
            : "muted")
      }
    >
      {label(value)}
    </span>
  );
}
function Button({
  children,
  onClick,
  primary = false,
  disabled = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={"button " + (primary ? "primary" : "")}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Empty({ text = "등록된 항목이 없습니다." }: { text?: string }) {
  return (
    <div className="empty">
      <Layers size={28} />
      <p>{text}</p>
    </div>
  );
}
function Table({
  heads,
  children,
  empty = false,
}: {
  heads: string[];
  children: ReactNode;
  empty?: boolean;
}) {
  return empty ? (
    <Empty />
  ) : (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {heads.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
function Field({
  label: labelText,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{labelText}</span>
      {children}
    </label>
  );
}
const navigation = [
  ["overview", "운영 현황", LayoutDashboard],
  ["web", "웹 동의", Globe],
  ["members", "회원 동의", Users],
  ["messages", "발송 통제", Send],
  ["tasks", "준수 업무", ClipboardCheck],
  ["evidence", "증빙 · 정책", FileCheck2],
  ["settings", "조직 · 연동", Settings],
] as const;
function App() {
  const [me, setMe] = useState<any>(null),
    [data, setData] = useState<any>(null),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState("overview"),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState<{ title: string; content: ReactNode } | null>(
      null,
    ),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [sidebar, setSidebar] = useState(false),
    [decision, setDecision] = useState<any>(null);
  const refresh = async () => {
    const m = await api("/me");
    setMe(m);
    setData(await api("/overview"));
  };
  useEffect(() => {
    refresh()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const timer = setTimeout(
      () =>
        document
          .querySelector<HTMLElement>(
            ".modal button, .modal input, .modal textarea, .modal select",
          )
          ?.focus(),
      0,
    );
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModal(null);
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".modal button:not(:disabled), .modal input:not(:disabled), .modal textarea, .modal select, .modal a[href]",
        ),
      );
      const first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, [modal]);
  async function action(fn: () => Promise<any>, success = "저장했습니다.") {
    setBusy(true);
    setError("");
    try {
      const value = await fn();
      await refresh();
      setToast(success);
      return value;
    } catch (e) {
      setError(label((e as Error).message));
      return null;
    } finally {
      setBusy(false);
    }
  }
  function form(
    title: string,
    fields: ReactNode,
    submit: (f: FormData) => Promise<any>,
    success = "저장했습니다.",
  ) {
    setModal({
      title,
      content: (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const result = await action(() => submit(f), success);
            if (result) setModal(null);
          }}
        >
          {fields}
          <div className="form-footer">
            <Button type="submit" primary>
              저장
            </Button>
          </div>
        </form>
      ),
    });
  }
  if (loading) return <div className="loading">이음 콘솔을 불러오는 중…</div>;
  if (!me)
    return (
      <main className="login">
        <div className="login-art">
          <div className="brand light">
            <span className="logo">이</span> 이음{" "}
            <small>CONSENT OPERATIONS</small>
          </div>
          <h1>
            선택을 존중하고,
            <br />
            신뢰를 이어갑니다.
          </h1>
          <p>
            동의 수집부터 발송 통제와 증빙까지.
            <br />
            개인정보 운영의 모든 흐름을 한곳에서.
          </p>
          <div className="orbit">
            <ShieldCheck size={90} />
            <span>수집</span>
            <span>통제</span>
            <span>증빙</span>
          </div>
        </div>
        <div className="login-form">
          <p className="eyebrow">WORKSPACE</p>
          <h2>다시 만나 반갑습니다</h2>
          <p className="subtle">조직의 동의 운영 콘솔에 로그인하세요.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await action(
                () =>
                  api("/auth/login", {
                    email: f.get("email"),
                    password: f.get("password"),
                    ...(f.get("code") ? { code: f.get("code") } : {}),
                  }),
                "로그인했습니다.",
              );
            }}
          >
            <Field label="이메일">
              <input
                name="email"
                type="email"
                required
                placeholder="name@company.com"
              />
            </Field>
            <Field label="비밀번호">
              <input name="password" type="password" required />
            </Field>
            <Field label="인증 앱 코드 (설정한 경우)">
              <input name="code" inputMode="numeric" maxLength={6} />
            </Field>
            <Button type="submit" primary disabled={busy}>
              로그인 <ArrowRight size={16} />
            </Button>
          </form>
          <div className="demo-login">
            <p>합성 데이터로 전체 흐름을 확인하세요.</p>
            <Button
              onClick={() =>
                action(
                  () => api("/auth/demo", {}),
                  "체험 워크스페이스에 접속했습니다.",
                )
              }
              disabled={busy}
            >
              데모 워크스페이스 열기 <ArrowUpRight size={16} />
            </Button>
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <small>로컬 개발 환경 · 실제 문자는 발송되지 않습니다.</small>
        </div>
      </main>
    );
  if (!data)
    return (
      <div className="loading">
        데이터를 불러올 수 없습니다.
        <Button onClick={() => action(refresh)}>다시 시도</Button>
      </div>
    );
  const currentTenant = me.tenants.find((t: any) => t.id === me.ctx.tenant),
    stats = data.stats;
  const counts = ["GRANTED", "REVOKED", "DENIED", "UNKNOWN"].map(
    (state) => data.subjects.filter((s: any) => s.state === state).length,
  );
  const total = Math.max(stats.subjects, 1);
  const a = (counts[0] / total) * 100,
    b = ((counts[0] + counts[1]) / total) * 100,
    c = ((counts[0] + counts[1] + counts[2]) / total) * 100;
  const changePage = (p: string) => {
    setPage(p);
    setSearch("");
    setFilter("all");
    setDecision(null);
    setSidebar(false);
  };
  const memberOptions = data.subjects
    .filter((s: any) => s.contact_id)
    .map((s: any) => (
      <option key={s.id} value={s.id}>
        {s.external_id} · {s.masked} · {label(s.state)}
      </option>
    ));
  function consentForm(s: any) {
    form(
      "의사표시 기록",
      <>
        <div className="notice">
          검증한 회원의 실제 선택을 기록하세요. 담당자가 임의로 수신 동의를
          만들면 안 됩니다.
        </div>
        <input type="hidden" name="subject" value={s.id} />
        <Field label="처리 목적">
          <select name="purpose">
            {data.purposes
              .filter((p: any) => p.kind !== "web_tracking")
              .map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="선택">
          <select name="state">
            <option value="revoked">철회</option>
            <option value="denied">거부</option>
            <option value="granted">동의</option>
          </select>
        </Field>
        <Field label="실제 의사표시 시각">
          <input type="datetime-local" name="time" required />
        </Field>
      </>,
      async (f) => {
        const p = data.purposes.find((p: any) => p.id === f.get("purpose")),
          n = data.notices.find(
            (n: any) => n.purpose_id === p.id && n.status === "published",
          );
        return api("/consent-events", {
          subject_id: s.id,
          contact_id: p.kind === "advertising_reception" ? s.contact_id : null,
          purpose_id: p.id,
          notice_id: n?.id,
          action: f.get("state"),
          occurred_at: new Date(String(f.get("time"))).toISOString(),
          idempotency_key: crypto.randomUUID(),
        });
      },
    );
  }
  function importForm() {
    form(
      "기존 동의 CSV 이관",
      <>
        <div className="notice">
          증빙이 없는 기존 동의는 미검증 상태로 보관합니다. 광고 발송 대상에
          자동 포함하지 않습니다.
        </div>
        <Field label="CSV 파일">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                const el = document.getElementById(
                  "import-csv",
                ) as HTMLTextAreaElement;
                el.value = await file.text();
              }
            }}
          />
        </Field>
        <Field label="CSV 내용">
          <textarea
            id="import-csv"
            name="csv"
            rows={7}
            defaultValue={
              "external_id,phone,state\nlegacy-001,01000009001,granted\nlegacy-002,01000009002,revoked"
            }
          />
        </Field>
        <p className="subtle">
          state: granted / denied / revoked. 먼저 미리보기를 확인합니다.
        </p>
      </>,
      async (f) => {
        const text = String(f.get("csv")),
          preview = await api("/import", { csv: text });
        setTimeout(
          () =>
            setModal({
              title: "이관 미리보기",
              content: (
                <>
                  <p>
                    총 {preview.rows}명 · 증빙 미검증 {preview.unverified}명 ·
                    거부/철회 {preview.suppressions}명
                  </p>
                  <div className="notice">
                    실제 의사표시 날짜와 증빙을 새로 만들지 않습니다.
                  </div>
                  <Button
                    primary
                    onClick={async () => {
                      const r = await action(
                        () => api("/import", { csv: text, commit: true }),
                        "기존 동의를 이관했습니다.",
                      );
                      if (r) setModal(null);
                    }}
                  >
                    검토 후 이관 승인
                  </Button>
                </>
              ),
            }),
          100,
        );
        return preview;
      },
      "미리보기를 준비했습니다.",
    );
  }
  function templateForm() {
    form(
      "광고 템플릿 작성",
      <>
        <Field label="템플릿 이름">
          <input name="name" required />
        </Field>
        <Field label="광고 수신 목적">
          <select name="purpose">
            {data.purposes
              .filter(
                (p: any) =>
                  p.kind === "advertising_reception" && p.channel === "sms",
              )
              .map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="본문">
          <textarea
            name="body"
            rows={8}
            required
            defaultValue={`(광고) ${data.controllers[0]?.name}\n고객센터: 02-0000-0001\n\n광고 본문을 작성하세요.\n\n무료수신거부 ${data.controllers[0]?.opt_out}`}
          />
        </Field>
        <p className="subtle">
          발신자·광고 표시·무료 거부 수단을 검수한 뒤 승인합니다.
        </p>
      </>,
      (f) =>
        api("/templates", {
          controller_id: data.controllers[0].id,
          purpose_id: f.get("purpose"),
          name: f.get("name"),
          body: f.get("body"),
        }),
    );
  }
  function noticeForm() {
    form(
      "새 동의 문구",
      <>
        <Field label="처리 목적">
          <select name="purpose">
            {data.purposes.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="고객에게 표시할 문구">
          <textarea
            name="body"
            rows={7}
            required
            minLength={20}
            placeholder="처리 목적, 항목, 보유기간, 선택 여부와 철회 방법을 명확히 작성하세요."
          />
        </Field>
        <p className="subtle">
          초안으로 저장합니다. 검토 후 별도로 게시할 수 있습니다.
        </p>
      </>,
      (f) =>
        api("/notices", { purpose_id: f.get("purpose"), body: f.get("body") }),
    );
  }
  return (
    <div className="app">
      <aside className={"sidebar " + (sidebar ? "open" : "")}>
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            changePage("overview");
          }}
        >
          <span className="logo">이</span> 이음 <small>동의 운영 플랫폼</small>
        </a>
        <div className="workspace">
          <span className="workspace-avatar">{currentTenant?.name[0]}</span>
          <div>
            <strong>{currentTenant?.name}</strong>
            <span>Growth 워크스페이스</span>
          </div>
          <ChevronDown size={14} />
          <select
            aria-label="워크스페이스 선택"
            value={me.ctx.tenant}
            onChange={(e) =>
              action(
                () => api("/auth/tenant", { tenant_id: e.target.value }),
                "워크스페이스를 변경했습니다.",
              )
            }
          >
            {me.tenants.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <p className="nav-label">워크스페이스</p>
        <nav>
          {navigation.map(([id, name, Icon]) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => changePage(id)}
            >
              <Icon size={18} />
              {name}
              {id === "tasks" && stats.overdue > 0 ? (
                <span className="nav-count">{stats.overdue}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="environment">
            <span className="dot" />
            개발 · 체험 환경<p>합성 데이터 / 모의 발송사</p>
          </div>
          <button
            className="profile"
            onClick={async () => {
              try {
                await api("/auth/logout", {});
                setMe(null);
                setData(null);
                setError("");
              } catch {
                setError("로그아웃하지 못했습니다.");
              }
            }}
          >
            <span className="avatar">{me.user?.name?.[0] ?? "운"}</span>
            <div>
              <strong>{me.user?.name}</strong>
              <small>{label(me.ctx.role)}</small>
            </div>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label="메뉴 열기"
            onClick={() => setSidebar(!sidebar)}
          >
            <PanelLeft size={20} />
          </button>
          <span>
            워크스페이스 <span className="slash">/</span>{" "}
            <strong>{navigation.find((n) => n[0] === page)?.[1]}</strong>
          </span>
          <div>
            <span className="connection">
              <span className="dot" /> PostgreSQL 연결
            </span>
            <button
              title="새로고침"
              aria-label="새로고침"
              onClick={() => action(refresh, "최신 상태로 업데이트했습니다.")}
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {page === "overview"
                  ? "CONSENT OPERATIONS"
                  : "WORKSPACE / " + page.toUpperCase()}
              </p>
              <h1>
                {page === "overview"
                  ? "동의 운영 현황"
                  : navigation.find((n) => n[0] === page)?.[1]}
              </h1>
              <p className="subtle">
                {
                  {
                    overview:
                      "고객의 선택부터 실행 결과까지, 확인이 필요한 흐름을 살펴보세요.",
                    web: "방문자의 목적별 선택에 따라 등록된 태그의 실행을 제어합니다.",
                    members:
                      "목적과 연락처별 동의 상태, 검증 수준과 변경 이력을 확인합니다.",
                    messages: "발송 전 확인하고, 전송 직전에 다시 판단합니다.",
                    tasks: "통지 기한과 삭제 확인을 놓치지 않도록 관리합니다.",
                    evidence:
                      "실제 문구와 선택, 판단의 근거를 버전별로 보관합니다.",
                    settings:
                      "조직의 권한, 연동 상태와 사용 한도를 관리합니다.",
                  }[page]
                }
              </p>
            </div>
            <div className="heading-actions">
              {page === "overview" ? (
                <Button onClick={() => changePage("evidence")}>
                  <Download size={15} /> 증빙 내보내기
                </Button>
              ) : page === "web" ? (
                <Button
                  primary
                  onClick={() =>
                    form(
                      "사이트 등록",
                      <>
                        <Field label="도메인">
                          <input
                            name="domain"
                            placeholder="www.example.com"
                            required
                          />
                        </Field>
                        <p className="subtle">
                          등록 후 DNS TXT 레코드로 소유권을 확인합니다.
                        </p>
                      </>,
                      (f) =>
                        api("/sites", {
                          controller_id: data.controllers[0].id,
                          domain: f.get("domain"),
                        }),
                    )
                  }
                >
                  <Plus size={16} />
                  사이트 추가
                </Button>
              ) : page === "evidence" ? (
                <Button primary onClick={noticeForm}>
                  <Plus size={16} />
                  문구 작성
                </Button>
              ) : null}
            </div>
          </div>
          {error && (
            <div role="alert" className="error banner">
              {error}
              <button aria-label="오류 닫기" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {page === "overview" && (
            <>
              <div className="welcome-card">
                <div className="welcome-icon">
                  <ShieldCheck size={28} />
                </div>
                <div>
                  <strong>고객의 선택이 실제 통제로 이어지도록</strong>
                  <p>
                    웹 동의 → 회원 동의 → 발송 판단 → 철회 → 증빙. 전체 흐름을
                    연결해 관리하세요.
                  </p>
                </div>
                <button onClick={() => changePage("web")}>
                  설치 시작하기 <ArrowRight size={17} />
                </button>
              </div>
              <div className="stats">
                {[
                  [
                    "관리 중인 회원",
                    stats.subjects,
                    "테넌트 내 합성 회원",
                    Users,
                  ],
                  [
                    "차단 · 취소된 발송",
                    stats.blocked,
                    "실행을 중단한 메시지",
                    ShieldCheck,
                  ],
                  [
                    "증빙 미확인 동의",
                    stats.unverified,
                    "광고 발송 대상에서 제외",
                    FileCheck2,
                  ],
                  [
                    "기한 초과 업무",
                    stats.overdue,
                    "담당자 확인이 필요합니다",
                    Clock,
                  ],
                ].map(([title, n, desc, Icon]: any) => (
                  <div className="stat" key={title}>
                    <div>
                      <span>{title}</span>
                      <Icon size={18} />
                    </div>
                    <strong>
                      {n.toLocaleString()}
                      <small>건</small>
                    </strong>
                    <p>{desc}</p>
                  </div>
                ))}
              </div>
              <div className="overview-grid">
                <section className="card">
                  <div className="section-title">
                    <div>
                      <h2>동의 상태</h2>
                      <p>문자 광고 수신 · 현재 선택 기준</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => changePage("members")}
                    >
                      회원 보기 <ArrowUpRight size={15} />
                    </button>
                  </div>
                  <div className="consent-chart">
                    <div
                      className="donut"
                      style={{
                        background: `conic-gradient(#285a48 0 ${a}%,#dba870 0 ${b}%,#b9cbbd 0 ${c}%,#e8ede9 0)`,
                      }}
                    >
                      <div>
                        <span>전체 회원</span>
                        <strong>{stats.subjects}</strong>
                      </div>
                    </div>
                    <div className="legend">
                      {[
                        ["GRANTED", "#285a48"],
                        ["REVOKED", "#dba870"],
                        ["DENIED", "#b9cbbd"],
                        ["UNKNOWN", "#e8ede9"],
                      ].map(([state, color]) => (
                        <div key={state}>
                          <span>
                            <i style={{ background: color }} />
                            {label(state)}
                          </span>
                          <strong>
                            {
                              data.subjects.filter(
                                (s: any) => s.state === state,
                              ).length
                            }
                            <small>명</small>
                          </strong>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="card-footer">
                    동의율과 증빙 검증 상태는 별도로 관리합니다.
                  </div>
                </section>
                <section className="card">
                  <div className="section-title">
                    <div>
                      <h2>확인이 필요한 업무</h2>
                      <p>통제가 완료되지 않은 항목</p>
                    </div>
                    <span className="pill">ACTION NEEDED</span>
                  </div>
                  <div className="attention-list">
                    {[
                      [
                        "동의 증빙 검토",
                        stats.unverified,
                        "증빙이 없는 기존 동의는 발송에서 제외됩니다.",
                        "members",
                      ],
                      [
                        "거부 외부 전파",
                        stats.propagation_pending,
                        "자체 발송 차단은 즉시 적용됩니다.",
                        "messages",
                      ],
                      [
                        "삭제 결과 확인",
                        stats.deletion_pending,
                        "외부 시스템의 확인까지 추적합니다.",
                        "tasks",
                      ],
                    ].map(([name, n, desc, p]: any) => (
                      <button key={name} onClick={() => changePage(p)}>
                        <span className="attention-dot" />
                        <div>
                          <strong>
                            {name}
                            <b>{n}</b>
                          </strong>
                          <p>{desc}</p>
                        </div>
                        <ArrowUpRight size={16} />
                      </button>
                    ))}
                  </div>
                </section>
              </div>
              <section className="card">
                <div className="section-title">
                  <div>
                    <h2>최근 운영 기록</h2>
                    <p>동의와 실행에 남겨진 기록을 확인하세요.</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => changePage("evidence")}
                  >
                    전체 기록 <ArrowRight size={15} />
                  </button>
                </div>
                <Table
                  heads={["시간", "작업", "실행 주체", "기록 ID"]}
                  empty={!data.audit.length}
                >
                  {data.audit.slice(0, 5).map((a: any) => (
                    <tr key={a.id}>
                      <td className="subtle">{date(a.created_at)}</td>
                      <td>
                        <span className="event-icon">
                          <Check size={12} />
                        </span>
                        {a.action.startsWith("consent.")
                          ? "동의 의사표시 기록"
                          : a.action}
                      </td>
                      <td>
                        {a.actor === me.ctx.actor
                          ? "운영 담당자"
                          : a.actor.startsWith("worker")
                            ? "백그라운드 워커"
                            : "서버 API"}
                      </td>
                      <td className="mono">{a.id.slice(0, 12)}</td>
                    </tr>
                  ))}
                </Table>
              </section>
              <div className="footnote">
                <ShieldCheck size={14} />
                통제 범위는 등록된 웹 태그와 이 게이트웨이를 통과하는 메시지에
                한정됩니다.
              </div>
            </>
          )}
          {page === "members" && (
            <section className="card">
              <div className="toolbar">
                <div className="search">
                  <Search size={17} />
                  <input
                    aria-label="회원 검색"
                    placeholder="회원 ID 또는 연락처 검색"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <select
                  aria-label="동의 상태 필터"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">모든 상태</option>
                  {["GRANTED", "DENIED", "REVOKED", "UNKNOWN"].map((v) => (
                    <option key={v} value={v}>
                      {label(v)}
                    </option>
                  ))}
                </select>
                <span className="subtle">총 {stats.subjects}명</span>
                <Button onClick={importForm}>CSV 이관</Button>
                <Button
                  onClick={() =>
                    form(
                      "회원 등록",
                      <Field label="고객사 회원 ID">
                        <input name="id" required />
                      </Field>,
                      (f) => api("/subjects", { external_id: f.get("id") }),
                    )
                  }
                >
                  <Plus size={15} />
                  회원 등록
                </Button>
              </div>
              <Table
                heads={[
                  "회원",
                  "연락처",
                  "문자 광고 동의",
                  "증빙 상태",
                  "버전",
                  "관리",
                ]}
              >
                {data.subjects
                  .filter(
                    (s: any) =>
                      (s.external_id + " " + s.masked).includes(search) &&
                      (filter === "all" || s.state === filter),
                  )
                  .map((s: any) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.external_id}</strong>
                        <small className="block subtle">
                          {s.id.slice(0, 8)}
                        </small>
                      </td>
                      <td>{s.masked ?? "미등록"}</td>
                      <td>
                        <Badge value={s.state} />
                      </td>
                      <td>
                        <Badge value={s.evidence} />
                      </td>
                      <td className="mono">r{s.revision}</td>
                      <td>
                        <button
                          className="text-button"
                          onClick={async () => {
                            const d = await action(
                              () => api("/subjects/" + s.id + "/preferences"),
                              "변경 이력을 불러왔습니다.",
                            );
                            if (d)
                              setModal({
                                title: s.external_id + " · 변경 이력",
                                content: (
                                  <div>
                                    <div className="modal-actions">
                                      <Button onClick={() => consentForm(s)}>
                                        의사표시 기록
                                      </Button>
                                      <a
                                        className="button"
                                        href={"/v1/evidence/" + s.id}
                                      >
                                        증빙 JSON
                                      </a>
                                      <Button
                                        onClick={() =>
                                          form(
                                            "삭제 요청",
                                            <>
                                              <Field label="요청 사유">
                                                <textarea
                                                  name="reason"
                                                  required
                                                  minLength={5}
                                                />
                                              </Field>
                                              <label className="check">
                                                <input
                                                  type="checkbox"
                                                  required
                                                />
                                                본인 확인을 완료했습니다.
                                              </label>
                                            </>,
                                            (f) =>
                                              api("/deletion-requests", {
                                                subject_id: s.id,
                                                reason: f.get("reason"),
                                                identity_verified: true,
                                              }),
                                          )
                                        }
                                      >
                                        삭제 요청
                                      </Button>
                                    </div>
                                    <div className="timeline">
                                      {d.events.map((v: any) => (
                                        <div key={v.id}>
                                          <i />
                                          <strong>
                                            {
                                              {
                                                granted: "동의",
                                                denied: "거부",
                                                revoked: "철회",
                                              }[v.action as "granted"]
                                            }
                                          </strong>
                                          <span>
                                            {
                                              data.purposes.find(
                                                (p: any) =>
                                                  p.id === v.purpose_id,
                                              )?.name
                                            }
                                          </span>
                                          <p>
                                            {date(v.received_at)} · r
                                            {v.revision} ·{" "}
                                            {v.applied
                                              ? "반영됨"
                                              : "과거 이벤트 — 반영 안 됨"}
                                          </p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ),
                              });
                          }}
                        >
                          상세 보기 <ArrowUpRight size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
              </Table>
            </section>
          )}
          {page === "messages" && (
            <>
              <section className="card">
                <div className="section-title">
                  <div>
                    <h2>메시지 템플릿</h2>
                    <p>승인한 본문만 발송할 수 있습니다.</p>
                  </div>
                  <Button onClick={templateForm}>
                    <Plus size={15} />
                    템플릿 작성
                  </Button>
                </div>
                <Table heads={["이름", "상태", "검토"]}>
                  {data.templates.map((t: any) => (
                    <tr key={t.id}>
                      <td>{t.name}</td>
                      <td>
                        <Badge value={t.status} />
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() =>
                            setModal({
                              title: t.name,
                              content: (
                                <>
                                  <pre>{t.body}</pre>
                                  {t.status !== "approved" && (
                                    <Button
                                      primary
                                      onClick={async () => {
                                        const r = await action(
                                          () =>
                                            api(
                                              "/templates/" + t.id + "/approve",
                                              {},
                                            ),
                                          "템플릿을 승인했습니다.",
                                        );
                                        if (r) setModal(null);
                                      }}
                                    >
                                      내용 검토 후 승인
                                    </Button>
                                  )}
                                </>
                              ),
                            })
                          }
                        >
                          내용 보기
                        </button>
                      </td>
                    </tr>
                  ))}
                </Table>
              </section>
              <div className="split">
                <section className="card padded">
                  <p className="eyebrow">PRE-FLIGHT CHECK</p>
                  <h2>발송 가능 여부 확인</h2>
                  <p className="subtle">
                    미리보기 결과는 발송 권한을 보장하지 않습니다.
                  </p>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget),
                        s = data.subjects.find(
                          (s: any) => s.id === f.get("subject"),
                        );
                      const d = await action(
                        () =>
                          api("/decisions", {
                            subject_id: s.id,
                            contact_id: s.contact_id,
                            template_id: f.get("template"),
                          }),
                        "판단이 기록되었습니다.",
                      );
                      setDecision(d);
                    }}
                  >
                    <Field label="회원">
                      <select name="subject">{memberOptions}</select>
                    </Field>
                    <Field label="메시지 템플릿">
                      <select name="template">
                        {data.templates.map((t: any) => (
                          <option key={t.id} value={t.id}>
                            {t.name} · {label(t.status)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Button primary type="submit" disabled={busy}>
                      발송 전 검사 <ArrowRight size={15} />
                    </Button>
                  </form>
                  {decision && (
                    <div
                      className={
                        "decision " + (decision.allowed ? "allowed" : "denied")
                      }
                    >
                      <strong>
                        {decision.allowed ? "발송 가능" : "발송 차단"}
                      </strong>
                      <p>
                        {decision.allowed
                          ? "현재 동의와 정책을 충족합니다."
                          : decision.reasons.map(label).join(" · ")}
                      </p>
                      <small>
                        규칙 {decision.ruleset} · 동의 r{decision.revision}
                      </small>
                    </div>
                  )}
                </section>
                <section className="card padded">
                  <p className="eyebrow">MESSAGE GATEWAY</p>
                  <h2>검수된 메시지 예약</h2>
                  <p className="subtle">
                    모의 발송사를 사용하며 실제 문자는 발송하지 않습니다.
                  </p>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget),
                        s = data.subjects.find(
                          (s: any) => s.id === f.get("subject"),
                        );
                      await action(
                        () =>
                          api("/messages", {
                            subject_id: s.id,
                            contact_id: s.contact_id,
                            template_id: f.get("template"),
                            idempotency_key: crypto.randomUUID(),
                            ...(f.get("scheduled")
                              ? {
                                  scheduled_at: new Date(
                                    String(f.get("scheduled")),
                                  ).toISOString(),
                                }
                              : {}),
                          }),
                        "발송 요청 결과를 아래 목록에 기록했습니다.",
                      );
                    }}
                  >
                    <Field label="회원">
                      <select name="subject">{memberOptions}</select>
                    </Field>
                    <Field label="승인 템플릿">
                      <select name="template">
                        {data.templates
                          .filter((t: any) => t.status === "approved")
                          .map((t: any) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="예약 시각 (비워두면 즉시 대기)">
                      <input type="datetime-local" name="scheduled" />
                    </Field>
                    <Button type="submit" primary disabled={busy}>
                      발송 요청
                    </Button>
                  </form>
                </section>
              </div>
              <section className="card">
                <div className="section-title">
                  <div>
                    <h2>발송 작업</h2>
                    <p>21:00–08:00 광고 발송은 차단됩니다.</p>
                  </div>
                  <Button
                    onClick={() =>
                      action(
                        () => api("/worker/run", {}),
                        "작업을 처리했습니다.",
                      )
                    }
                    disabled={busy}
                  >
                    <RefreshCw size={15} />
                    대기 작업 처리
                  </Button>
                </div>
                <Table
                  heads={["회원", "템플릿", "예약 시각", "상태", "판단 사유"]}
                  empty={!data.messages.length}
                >
                  {data.messages.map((m: any) => (
                    <tr key={m.id}>
                      <td>{m.external_id}</td>
                      <td>{m.template_name}</td>
                      <td>{date(m.scheduled_at)}</td>
                      <td>
                        <Badge value={m.status} />
                      </td>
                      <td className="subtle">
                        {m.reasons.map(label).join(", ") || "—"}
                      </td>
                    </tr>
                  ))}
                </Table>
              </section>
            </>
          )}
          {page === "web" && (
            <>
              <div className="notice">
                <Globe size={18} />
                <div>
                  <strong>
                    사이트 소유 확인 → 설정 게시 → SDK 설치 → 실제 동작 확인
                  </strong>
                  <p>
                    HTTP 설치 검사는 JavaScript 실행을 보장하지 않습니다. 외부
                    직접 삽입 태그는 별도 확인이 필요합니다.
                  </p>
                </div>
                <Button
                  onClick={async () => {
                    const s = await action(
                      () => api("/demo/site", {}),
                      "SDK 체험 사이트를 준비했습니다.",
                    );
                    if (s)
                      window.open(
                        "/demo?key=" + s.public_key,
                        "_blank",
                        "noopener",
                      );
                  }}
                >
                  SDK 체험 열기 <ArrowUpRight size={15} />
                </Button>
              </div>
              {data.sites.length === 0 ? (
                <section className="card">
                  <Empty text="첫 사이트를 등록하거나 SDK 체험을 시작하세요." />
                </section>
              ) : (
                data.sites.map((s: any) => (
                  <section className="card padded" key={s.id}>
                    <div className="section-title">
                      <div>
                        <h2>{s.domain}</h2>
                        <p>
                          {s.verified_at
                            ? "소유권 확인됨"
                            : "DNS 소유권 확인 대기"}
                        </p>
                      </div>
                      <Badge
                        value={s.verified_at ? "VERIFIED" : "REVIEW_REQUIRED"}
                      />
                    </div>
                    {!s.verified_at && (
                      <>
                        <p>
                          DNS TXT 이름: <code>_cmp.{s.domain}</code>
                        </p>
                        <pre>cmp-verification={s.verification_token}</pre>
                        <Button
                          onClick={() =>
                            action(
                              () => api("/sites/" + s.id + "/verify", {}),
                              "도메인 소유권을 확인했습니다.",
                            )
                          }
                        >
                          소유권 확인
                        </Button>
                      </>
                    )}
                    <Field label="설치 코드">
                      <pre>{`<script src="${location.origin}/sdk/cmp.js" data-site="${s.public_key}"></script>`}</pre>
                    </Field>
                    <div className="modal-actions">
                      <Button
                        onClick={() =>
                          action(
                            () => api("/sites/" + s.id + "/scan", {}),
                            "설치 검사 결과를 기록했습니다.",
                          )
                        }
                      >
                        설치 검사
                      </Button>
                      <Button
                        onClick={() =>
                          form(
                            "새 웹 설정 버전",
                            <>
                              <Field label="배너 문구">
                                <textarea
                                  name="notice"
                                  required
                                  minLength={10}
                                />
                              </Field>
                              <Field label="태그 설정 JSON">
                                <textarea
                                  name="tags"
                                  rows={7}
                                  defaultValue="[]"
                                />
                              </Field>
                              <p className="subtle">
                                태그: id, name, purpose(analytics/advertising),
                                type(script/pixel/iframe), src(https URL),
                                cookies
                              </p>
                            </>,
                            (f) =>
                              api("/web-configs", {
                                site_id: s.id,
                                notice: f.get("notice"),
                                tags: JSON.parse(String(f.get("tags"))),
                              }),
                          )
                        }
                      >
                        설정 버전 추가
                      </Button>
                    </div>
                    <div className="versions">
                      {data.configs
                        .filter((v: any) => v.site_id === s.id)
                        .map((v: any) => (
                          <div key={v.id}>
                            <span>
                              버전 {v.version} · 태그 {v.tags.length}개
                            </span>
                            <Badge value={v.status} />
                            {v.status === "draft" && (
                              <Button
                                onClick={() =>
                                  action(
                                    () =>
                                      api(
                                        "/web-configs/" + v.id + "/publish",
                                        {},
                                      ),
                                    "설정을 게시했습니다.",
                                  )
                                }
                              >
                                검토 후 게시
                              </Button>
                            )}
                          </div>
                        ))}
                    </div>
                    {data.scans
                      .filter((v: any) => v.site_id === s.id)
                      .slice(0, 1)
                      .map((v: any) => (
                        <div className="notice" key={v.id}>
                          <Badge value={v.status} />
                          {v.result.warnings?.join(" · ")}
                        </div>
                      ))}
                  </section>
                ))
              )}
            </>
          )}
          {page === "tasks" && (
            <>
              <div className="mini-stats">
                <div>
                  <strong>
                    {
                      data.notifications.filter(
                        (n: any) =>
                          n.kind === "processing_result" &&
                          n.status === "pending",
                      ).length
                    }
                  </strong>
                  <span>처리결과 통지 대기</span>
                </div>
                <div>
                  <strong>
                    {
                      data.notifications.filter(
                        (n: any) =>
                          n.kind === "periodic" && n.status === "pending",
                      ).length
                    }
                  </strong>
                  <span>정기 확인 관리</span>
                </div>
                <div>
                  <strong>{stats.deletion_pending}</strong>
                  <span>확인 중인 삭제</span>
                </div>
              </div>
              <section className="card">
                <div className="section-title">
                  <div>
                    <h2>통지 업무</h2>
                    <p>
                      정기 확인 안내는 동의 만료나 재동의로 기록되지 않습니다.
                    </p>
                  </div>
                  <Button
                    onClick={() =>
                      action(
                        () => api("/worker/run", {}),
                        "통지 작업을 처리했습니다.",
                      )
                    }
                  >
                    통지 처리
                  </Button>
                </div>
                <Table
                  heads={["업무", "기한 (한국 시간)", "상태", "전송 시도"]}
                  empty={!data.notifications.length}
                >
                  {data.notifications.slice(0, 60).map((n: any) => (
                    <tr key={n.id}>
                      <td>
                        {n.kind === "periodic"
                          ? "2년 주기 수신동의 확인"
                          : "동의·거부·철회 처리결과"}
                      </td>
                      <td>{date(n.due_at)}</td>
                      <td>
                        <Badge value={n.status} />
                      </td>
                      <td>{n.attempts}회</td>
                    </tr>
                  ))}
                </Table>
              </section>
              <section className="card">
                <div className="section-title">
                  <div>
                    <h2>삭제 요청</h2>
                    <p>
                      회원 상세에서 요청을 등록합니다. 모든 시스템의 확인이
                      필요합니다.
                    </p>
                  </div>
                </div>
                {!data.deletions.length ? (
                  <Empty text="처리 중인 삭제 요청이 없습니다." />
                ) : (
                  data.deletions.map((d: any) => (
                    <div className="deletion" key={d.id}>
                      <strong>{d.reason}</strong> <Badge value={d.status} />
                      {data.deletion_tasks
                        .filter((t: any) => t.request_id === d.id)
                        .map((t: any) => (
                          <div key={t.id}>
                            <span>{t.system}</span>
                            <Badge value={t.status} />
                            {t.status !== "verified" && (
                              <Button
                                onClick={() =>
                                  form(
                                    "삭제 실행 결과 확인",
                                    <>
                                      <div className="notice">
                                        {t.system === "cmp"
                                          ? "연락처를 파기하고 삭제 이력을 남깁니다."
                                          : "해당 시스템에서 실제 삭제를 확인한 근거를 기록하세요."}
                                      </div>
                                      <Field label="확인 근거">
                                        <textarea
                                          name="proof"
                                          required
                                          minLength={10}
                                        />
                                      </Field>
                                    </>,
                                    (f) =>
                                      api(
                                        "/deletion-tasks/" + t.id + "/confirm",
                                        { evidence: f.get("proof") },
                                      ),
                                  )
                                }
                              >
                                결과 기록
                              </Button>
                            )}
                          </div>
                        ))}
                    </div>
                  ))
                )}
              </section>
            </>
          )}
          {page === "evidence" && (
            <>
              <section className="card padded">
                <h2>회원별 증빙 내보내기</h2>
                <p className="subtle">
                  승인 문구 원문, 동의 이벤트, 판단과 발송 이력을 함께
                  제공합니다.
                </p>
                <form
                  className="inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    window.location.href =
                      "/v1/evidence/" +
                      f.get("subject") +
                      "?format=" +
                      f.get("format");
                  }}
                >
                  <select name="subject" aria-label="증빙 대상 회원">
                    {memberOptions}
                  </select>
                  <select name="format" aria-label="파일 형식">
                    <option value="json">JSON 묶음</option>
                    <option value="csv">CSV 이벤트</option>
                  </select>
                  <Button type="submit" primary>
                    <Download size={15} />
                    내보내기
                  </Button>
                </form>
              </section>
              <section className="card">
                <div className="section-title">
                  <div>
                    <h2>동의 문구 버전</h2>
                    <p>
                      게시된 문구는 덮어쓸 수 없습니다. 변경 시 새 버전을
                      만듭니다.
                    </p>
                  </div>
                </div>
                <Table heads={["목적", "버전", "상태", "내용", "작업"]}>
                  {data.notices.map((n: any) => (
                    <tr key={n.id}>
                      <td>
                        <strong>{n.purpose_name}</strong>
                      </td>
                      <td>v{n.version}</td>
                      <td>
                        <Badge value={n.status} />
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() =>
                            setModal({
                              title: n.purpose_name + " · v" + n.version,
                              content: (
                                <>
                                  <p className="document">{n.body}</p>
                                  <p className="subtle mono">
                                    SHA-256
                                    <br />
                                    {n.hash}
                                  </p>
                                </>
                              ),
                            })
                          }
                        >
                          문구 확인
                        </button>
                      </td>
                      <td>
                        {n.status !== "published" ? (
                          <Button
                            onClick={() =>
                              action(
                                () => api("/notices/" + n.id + "/publish", {}),
                                "문구를 승인하고 게시했습니다.",
                              )
                            }
                          >
                            검토 후 게시
                          </Button>
                        ) : (
                          <span className="subtle">수정 불가</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </Table>
              </section>
              <section className="card">
                <div className="section-title">
                  <h2>감사 기록</h2>
                </div>
                <Table
                  heads={["시간", "작업", "참조"]}
                  empty={!data.audit.length}
                >
                  {data.audit.slice(0, 30).map((a: any) => (
                    <tr key={a.id}>
                      <td>{date(a.created_at)}</td>
                      <td>{a.action}</td>
                      <td className="mono">
                        {JSON.stringify(a.details).slice(0, 85)}
                      </td>
                    </tr>
                  ))}
                </Table>
              </section>
            </>
          )}
          {page === "settings" && (
            <>
              <div className="split">
                <section className="card padded">
                  <p className="eyebrow">SECURITY</p>
                  <h2>로그인 보안</h2>
                  <p>인증 앱을 연결해 계정을 보호하세요.</p>
                  <Badge
                    value={
                      me.user?.mfa_enabled ? "VERIFIED" : "REVIEW_REQUIRED"
                    }
                  />
                  <div className="form-footer">
                    <Button
                      onClick={async () => {
                        const m = await action(
                          () => api("/auth/mfa/start", {}),
                          "인증 앱 연결을 준비했습니다.",
                        );
                        if (m)
                          form(
                            "인증 앱 연결",
                            <>
                              <p>
                                아래 키를 인증 앱에 등록한 뒤 6자리 코드를
                                입력하세요.
                              </p>
                              <pre>{m.secret}</pre>
                              <Field label="인증 코드">
                                <input
                                  name="code"
                                  pattern="[0-9]{6}"
                                  required
                                />
                              </Field>
                            </>,
                            (f) =>
                              api("/auth/mfa/finish", { code: f.get("code") }),
                            "2단계 인증을 설정했습니다.",
                          );
                      }}
                    >
                      2단계 인증 설정
                    </Button>
                  </div>
                </section>
                <section className="card padded">
                  <p className="eyebrow">SERVER API</p>
                  <h2>서버 API 키</h2>
                  <p>회원 동의를 다루는 키는 서버에서만 사용하세요.</p>
                  <Button
                    onClick={() =>
                      form(
                        "서버 키 발급",
                        <>
                          <Field label="키 이름">
                            <input name="name" required />
                          </Field>
                          <Field label="권한">
                            <select name="scope">
                              <option value="consent:write">동의 기록</option>
                              <option value="messages:send">발송 요청</option>
                              <option value="evidence:read">
                                증빙 내보내기
                              </option>
                              <option value="decisions">발송 판단</option>
                            </select>
                          </Field>
                        </>,
                        async (f) => {
                          const k = await api("/keys", {
                            name: f.get("name"),
                            scopes: [f.get("scope")],
                          });
                          setTimeout(
                            () =>
                              setModal({
                                title: "발급된 서버 키",
                                content: (
                                  <>
                                    <p>
                                      이 화면에서만 표시됩니다. 안전한 곳에
                                      보관하세요.
                                    </p>
                                    <pre>{k.secret}</pre>
                                  </>
                                ),
                              }),
                            100,
                          );
                          return k;
                        },
                      )
                    }
                  >
                    <Plus size={15} />
                    서버 키 발급
                  </Button>
                </section>
              </div>
              <section className="card">
                <div className="section-title">
                  <div>
                    <h2>발송사 연동</h2>
                    <p>
                      모의 커넥터는 실문자를 보내지 않습니다. 실제 연동에는
                      계정·발신번호·080 검증이 필요합니다.
                    </p>
                  </div>
                </div>
                <Table heads={["공급자", "연결 상태", "동작", "장애 시나리오"]}>
                  {data.connectors.map((c: any) => (
                    <tr key={c.id}>
                      <td>
                        <strong>
                          {c.provider === "mock"
                            ? "모의 문자 발송사"
                            : "SOLAPI"}
                        </strong>
                      </td>
                      <td>
                        <Badge value={c.status} />
                      </td>
                      <td>
                        {c.provider === "mock"
                          ? "로컬 접수·결과 시뮬레이션"
                          : "운영 검증 필요"}
                      </td>
                      <td>
                        {c.provider === "mock" && (
                          <select
                            aria-label="모의 발송사 장애 주입"
                            value={c.mode}
                            onChange={(e) =>
                              action(
                                () =>
                                  api("/connectors/" + c.id + "/mock-mode", {
                                    mode: e.target.value,
                                  }),
                                "다음 발송에 적용됩니다.",
                              )
                            }
                          >
                            <option value="normal">정상</option>
                            <option value="timeout_before">
                              접수 전 타임아웃
                            </option>
                            <option value="timeout_after">
                              접수 후 타임아웃
                            </option>
                            <option value="reject">발송 거절</option>
                          </select>
                        )}
                      </td>
                    </tr>
                  ))}
                </Table>
              </section>
              <section className="card padded">
                <h2>사용 한도</h2>
                <p className="subtle">
                  월 발송 한도를 초과해도 철회·거부 기록은 계속 가능합니다. 실제
                  결제는 연결되어 있지 않습니다.
                </p>
                <form
                  className="inline-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await action(
                      () =>
                        api("/plan", {
                          ad_limit: Number(
                            new FormData(e.currentTarget).get("limit"),
                          ),
                        }),
                      "발송 한도를 변경했습니다.",
                    );
                  }}
                >
                  <Field label="월 광고 발송 한도">
                    <input
                      name="limit"
                      type="number"
                      min="0"
                      defaultValue="1000"
                      required
                    />
                  </Field>
                  <Button type="submit">한도 저장</Button>
                </form>
              </section>
            </>
          )}
        </main>
        <footer className="footer">
          이음 · Consent Operations{" "}
          <span>한국 시간 기준 · 규칙 kr_sms_explicit_daytime_v1</span>
        </footer>
      </div>
      {toast && (
        <div role="status" className="toast">
          <Check size={17} />
          {toast}
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={modal.title}
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2>{modal.title}</h2>
              <button aria-label="닫기" onClick={() => setModal(null)}>
                <X size={20} />
              </button>
            </header>
            {modal.content}
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
