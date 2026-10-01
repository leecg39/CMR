import React, {
  useState,
  useEffect,
  useRef,
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
  RESTRICTED: "사용 제한",
  DELETED: "파기됨",
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
  verified: "확인 완료",
  retained: "보존 승인",
  draft: "초안",
  published: "게시됨",
  approved: "승인됨",
  active: "연결됨",
  not_configured: "설정 필요",
  suspended: "중지됨",
  partial: "부분 검증",
  unverified: "미검증",
  failed: "실패",
  // 발송 판단·작업 사유
  CONSENT_WITHDRAWN: "광고 수신 동의 철회",
  RECEPTION_CONSENT_MISSING: "광고 수신 동의 없음",
  MARKETING_USE_CONSENT_MISSING: "마케팅 이용 동의 없음",
  EVIDENCE_UNVERIFIED: "동의 증빙 미확인",
  SUPPRESSED: "수신거부 목록 등록",
  OUTSIDE_DAYTIME: "주간 발송 시간 외",
  QUOTA_EXCEEDED: "발송 한도 초과",
  CONTACT_UNVERIFIED: "연락처 미검증",
  SUBJECT_RESTRICTED: "사용이 제한된 회원",
  CHANNEL_MISMATCH: "연락처와 채널 불일치",
  TEMPLATE_UNAPPROVED: "승인되지 않은 템플릿",
  PROVIDER_NOT_READY: "발송사 연결 준비 안 됨",
  OPTOUT_SYNC_UNVERIFIED: "080 수신거부 동기화 미확인",
  SENDER_NOT_REGISTERED: "발신번호 미등록",
  ROUTE_NOT_SUPPORTED: "지원하지 않는 발송 경로",
  SENDER_OR_OPTOUT_MISMATCH: "본문의 사업자명·080 번호 불일치",
  PURPOSE_SCOPE_MISMATCH: "수신 동의 목적 불일치",
  LAWFUL_BASIS_UNREVIEWED: "처리 근거 미검토",
  TENANT_INACTIVE: "워크스페이스 중지",
  MMS_IMAGE_REQUIRED: "MMS 이미지 필요",
  ADVERTISING_ALIMTALK_FORBIDDEN: "광고성 알림톡 금지",
  AD_LABEL_REQUIRED: "본문 첫머리 (광고) 표시 필요",
  SENDER_CONTACT_REQUIRED: "첫 3줄 안에 고객센터 번호 필요",
  FREE_OPTOUT_REQUIRED: "무료수신거부 080 번호 필요",
  TITLE_AD_LABEL_REQUIRED: "제목 (광고) 표시 필요",
  PROMOTIONAL_NOTICE_FORBIDDEN: "안내 메시지에 광고 문구 포함",
  UNREVIEWED_VARIABLES: "검토되지 않은 변수 포함",
  WORKER_INTERRUPTED: "워커 중단 — 접수 여부 확인 필요",
  DELETION_REAPPLIED: "삭제 이력 재적용",
  DISPATCH_PREPARATION_FAILED: "발송 준비 실패 — 담당자 확인",
  MOCK_REJECTED: "모의 발송사 거절",
  PROVIDER_NOT_CONFIGURED: "발송사 설정 필요",
  PROVIDER_REJECTED: "발송사 거절",
  // 설치 검사
  JAVASCRIPT_NOT_EXECUTED: "JavaScript 미실행 검사",
  USER_INTERACTIONS_NOT_TESTED: "사용자 동작 미검사",
  USER_INTERACTIONS_NOT_EXHAUSTIVE: "모든 사용자 동작을 검사하지 않음",
  SDK_MISSING: "SDK 설치 코드 없음",
  UNCONTROLLED_SCRIPTS: "통제되지 않는 스크립트 발견",
  UNREGISTERED_TAGS_REQUIRE_REVIEW: "미등록 태그 검토 필요",
  SCAN_REJECTED_OR_UNAVAILABLE: "검사 거부 또는 접속 불가",
  ISOLATED_SCAN_FAILED: "격리 브라우저 검사 실패",
  // 오류
  UNAUTHENTICATED: "세션이 만료되었습니다. 다시 로그인해 주세요.",
  FORBIDDEN: "이 작업을 수행할 권한이 없습니다.",
  NOT_FOUND: "대상을 찾을 수 없습니다.",
  INVALID_INPUT: "입력 형식을 확인해 주세요.",
  INVALID_REQUEST: "요청 형식이 올바르지 않습니다.",
  INVALID_REFERENCE: "참조한 항목이 없습니다.",
  CONFLICT: "이미 같은 항목이 있습니다.",
  STATE_CONFLICT: "현재 상태에서는 처리할 수 없습니다.",
  RATE_LIMITED: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  PAYLOAD_TOO_LARGE: "입력이 너무 큽니다.",
  UNSUPPORTED_MEDIA_TYPE: "지원하지 않는 요청 형식입니다.",
  SERVICE_UNAVAILABLE:
    "요청을 완료하지 못했습니다. 광고 전송은 보류됩니다. 잠시 후 다시 시도해 주세요.",
  NETWORK_ERROR: "서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.",
  HOST_FORBIDDEN: "허용되지 않은 주소로 접속했습니다.",
  ORIGIN_REQUIRED: "허용된 콘솔 주소에서만 변경할 수 있습니다.",
  INVALID_CREDENTIALS: "이메일 또는 비밀번호가 올바르지 않습니다.",
  MFA_REQUIRED: "인증 앱의 6자리 코드를 함께 입력해 주세요.",
  INVALID_MFA: "인증 코드가 올바르지 않습니다.",
  MFA_REPLAY: "이미 사용한 인증 코드입니다. 다음 코드를 입력해 주세요.",
  MFA_SETUP_REQUIRED: "2단계 인증 설정이 필요합니다.",
  MFA_ALREADY_ENABLED: "이미 2단계 인증이 설정되어 있습니다.",
  NO_MEMBERSHIP: "소속된 워크스페이스가 없습니다.",
  INVALID_CONTACT: "연락처 형식이 올바르지 않습니다.",
  IDEMPOTENCY_CONFLICT: "같은 요청 키로 다른 내용이 이미 기록되었습니다.",
  REVISION_CONFLICT: "다른 변경이 먼저 반영되었습니다. 새로고침 후 다시 시도해 주세요.",
  CONTACT_SCOPE_MISMATCH: "선택한 목적의 채널과 연락처가 맞지 않습니다.",
  CONTACT_REQUIRED: "수신 동의에는 해당 채널의 연락처가 필요합니다.",
  UNEXPECTED_CONTACT: "이 목적에는 연락처를 지정하지 않습니다.",
  NOTICE_REQUIRED: "게시된 동의 문구가 필요합니다.",
  NOTICE_NOT_PUBLISHED:
    "이 목적의 동의 문구가 게시되지 않았습니다. 증빙·정책에서 문구를 게시하세요.",
  OCCURRED_AT_REQUIRED: "실제 의사표시 시각이 필요합니다.",
  FUTURE_EVENT: "미래 시각의 의사표시는 기록할 수 없습니다.",
  WEB_SCOPE_REQUIRED: "웹 추적 목적은 웹 배너에서만 기록합니다.",
  WEB_SCOPE_ONLY: "웹 배너에서는 웹 추적 목적만 기록합니다.",
  RESERVED_EXTERNAL_ID: "deleted:·browser:로 시작하는 ID는 사용할 수 없습니다.",
  NOTICE_WORDING_REVIEW_REQUIRED:
    "광고 수신 문구에는 '광고'와 '철회' 안내가 모두 필요합니다.",
  TEMPLATE_REVIEW_REQUIRED: "템플릿 검수 항목을 먼저 수정해 주세요",
  SITE_EXISTS: "이미 등록된 도메인입니다.",
  DNS_VERIFICATION_NOT_FOUND:
    "DNS TXT 레코드를 찾지 못했습니다. 전파까지 시간이 걸릴 수 있습니다.",
  DOMAIN_UNVERIFIED: "도메인 소유권 확인이 먼저 필요합니다.",
  SCANNER_NOT_CONFIGURED: "격리 스캐너가 설정되지 않았습니다.",
  CONFIG_UNAVAILABLE: "게시된 웹 설정이 없습니다.",
  CONTROLLER_REQUIRED: "등록된 사업자 정보가 없습니다.",
  INVALID_DOMAIN: "도메인 형식이 올바르지 않습니다.",
  UNSAFE_SCAN_TARGET: "사설망 주소로 연결되는 도메인은 검사하지 않습니다.",
  TAGS_JSON_INVALID: "태그 설정이 올바른 JSON 배열이 아닙니다.",
  DUPLICATE_TAG_ID: "태그 id가 중복되었습니다.",
  EVIDENCE_REQUIRED: "확인 근거를 10자 이상 입력해 주세요.",
  SUBJECT_ALREADY_DELETED: "이미 파기된 회원입니다.",
  DELETION_ALREADY_REQUESTED: "처리 중인 삭제 요청이 이미 있습니다.",
  TASK_ALREADY_CONFIRMED: "이미 확인을 완료한 작업입니다.",
  DELETION_UNCONFIRMED: "확인되지 않은 삭제 작업이 남아 있습니다.",
  RETENTION_PERIOD_ACTIVE: "보유기간이 아직 끝나지 않았습니다.",
  LEGAL_HOLD_ACTIVE: "보존 중지가 적용된 회원입니다.",
  RETENTION_POLICY_REQUIRED: "승인된 보유기간 정책이 필요합니다.",
  PUBLISHED_IMMUTABLE: "게시된 버전은 수정할 수 없습니다. 새 버전을 만드세요.",
  APPROVED_IMMUTABLE: "승인된 템플릿은 수정할 수 없습니다.",
  IMMUTABLE_RECORD: "기록은 수정할 수 없습니다. 정정 기록을 추가하세요.",
  HOLD_IN_PAST: "보존 기한은 현재 이후여야 합니다.",
  CSV_INVALID: "CSV 형식을 읽을 수 없습니다. 머리글과 따옴표를 확인해 주세요.",
  DUPLICATE_IMPORT_MEMBERS: "CSV 안에 같은 회원 ID가 중복되었습니다.",
  IMPORT_MEMBERS_EXIST: "이미 등록된 회원은 이관할 수 없습니다",
  PURPOSE_NOT_CONFIGURED: "필요한 처리 목적이 설정되지 않았습니다.",
  SELECTION_REQUIRED: "대상을 선택해 주세요.",
  REFRESH_FAILED: "저장은 완료했지만 최신 상태를 불러오지 못했습니다.",
  owner: "소유자",
  privacy_officer: "개인정보 담당자",
  marketer: "마케팅 담당자",
  developer: "개발자",
  auditor: "감사 열람자",
  "consent:write": "동의 기록",
  read: "조회",
  decisions: "발송 판단",
  "messages:send": "발송 요청",
  "evidence:read": "증빙 내보내기",
  "deletion:write": "삭제 처리",
  cmp: "이음 CMP (연락처 파기)",
  "external:crm": "고객사 CRM",
  backup: "백업 보관본",
};
const fieldLabels: Record<string, string> = {
  email: "이메일",
  password: "비밀번호",
  code: "인증 코드",
  external_id: "회원 ID",
  subject_id: "회원",
  contact_id: "연락처",
  purpose_id: "처리 목적",
  notice_id: "동의 문구",
  template_id: "템플릿",
  action: "선택",
  occurred_at: "의사표시 시각",
  scheduled_at: "예약 시각",
  reason: "요청 사유",
  evidence: "확인 근거",
  body: "본문",
  name: "이름",
  title: "제목",
  domain: "도메인",
  notice: "배너 문구",
  tags: "태그 설정",
  scopes: "권한",
  ad_limit: "발송 한도",
  rows: "CSV 행",
  value: "연락처",
  channel: "채널",
};
const auditLabels: Record<string, string> = {
  "consent.granted": "동의 기록",
  "consent.denied": "거부 기록",
  "consent.revoked": "철회 기록",
  "notice.published": "동의 문구 게시",
  "template.approved": "템플릿 승인",
  "web_config.published": "웹 설정 게시",
  "site.created": "사이트 등록",
  "site.verified": "도메인 소유 확인",
  "api_key.created": "서버 키 발급",
  "api_key.revoked": "서버 키 폐기",
  "evidence.exported": "증빙 내보내기",
  "deletion.requested": "삭제 요청",
  "deletion.task_confirmed": "삭제 결과 확인",
  "retention_policy.approved": "보유기간 정책 승인",
  "retention.purged": "보유기간 종료 파기",
  "hold.created": "보존 중지 등록",
  "import.completed": "기존 동의 이관",
  "tenant.suspended": "워크스페이스 중지",
  "message.accepted": "발송사 접수",
  "message.unknown": "접수 확인 필요",
  "message.rejected": "발송 거절",
  "provider.optout": "발송사 수신거부 반영",
  "provider.delivered": "발송사 전달 결과",
  "provider.failed": "발송사 실패 결과",
  "deletion_journal.reapplied": "삭제 이력 재적용",
  "mfa.enabled": "2단계 인증 설정",
  "membership.created": "구성원 추가",
  "plan.ad_limit_changed": "발송 한도 변경",
  "connector.mock_mode": "모의 장애 시나리오 변경",
};
const label = (v: string) =>
  labels[v] ??
  (/^PROVIDER_HTTP_\d+$/.test(v)
    ? "발송사 응답 오류 " + v.slice(14)
    : /^HTTP_\d+$/.test(v)
      ? "요청을 처리하지 못했습니다 (" + v.slice(5) + ")"
      : v);
const actorLabel = (actor: string, me: string) =>
  actor === me
    ? "나"
    : actor === "worker"
      ? "백그라운드 워커"
      : actor.startsWith("key:")
        ? "서버 API 키"
        : actor.startsWith("browser:")
          ? "웹 방문자"
          : actor.startsWith("revoke-link:")
            ? "철회 링크"
            : actor === "bridge" || actor === "provider-bridge"
              ? "발송사 브리지"
              : actor === "solapi-poll"
                ? "SOLAPI 수신거부 동기화"
                : actor === "recovery"
                  ? "복구 도구"
                  : "다른 구성원";
// 모든 시각은 한국 시간으로 연도까지 표시합니다. 2년 주기 안내처럼 해가 바뀌는 기한이 있습니다.
const date = (v: any) =>
  v
    ? new Date(v).toLocaleString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Seoul",
      })
    : "—";
// datetime-local 입력은 한국 시간으로 해석합니다. 브라우저 시간대에 따라 시각이 바뀌지 않습니다.
const kstInput = (d = new Date()) =>
  new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 16);
const fromKstInput = (v: string) =>
  new Date((v.length === 16 ? v + ":00" : v) + "+09:00").toISOString();
class ApiError extends Error {
  constructor(
    public code: string,
    public details?: any[],
  ) {
    super(code);
  }
}
async function api(url: string, body?: unknown, method?: string) {
  let r: Response;
  try {
    r = await fetch("/v1" + url, {
      method: method ?? (body ? "POST" : "GET"),
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("NETWORK_ERROR");
  }
  const text = await r.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!r.ok) throw new ApiError(data?.code ?? "HTTP_" + r.status, data?.details);
  return data;
}
async function download(url: string, filename: string) {
  let r: Response;
  try {
    r = await fetch("/v1" + url);
  } catch {
    throw new ApiError("NETWORK_ERROR");
  }
  if (!r.ok) {
    const data = await r.json().catch(() => null);
    throw new ApiError(data?.code ?? "HTTP_" + r.status);
  }
  const href = URL.createObjectURL(await r.blob()),
    a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  return { ok: true };
}
function errorText(e: unknown) {
  if (e instanceof ApiError) {
    const base = label(e.code);
    if (!e.details?.length) return base;
    if (e.code === "INVALID_INPUT")
      return (
        base +
        " (" +
        e.details
          .slice(0, 4)
          .map((d: any) => {
            const field =
              fieldLabels[d?.path?.[0]] ?? (d?.path ?? []).join(".") ?? "";
            return labels[d?.message] ? `${field}: ${labels[d.message]}` : field;
          })
          .filter(Boolean)
          .join(", ") +
        ")"
      );
    return base + ": " + e.details.map((d) => label(String(d))).join(" · ");
  }
  return label(e instanceof Error ? e.message : "SERVICE_UNAVAILABLE");
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
          "verified",
        ].includes(value)
          ? "good"
          : [
                "DENIED",
                "REVOKED",
                "blocked",
                "failed",
                "manual_required",
                "suspended",
                "RESTRICTED",
                "DELETED",
              ].includes(value)
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
type Modal = {
  title: string;
  content: ReactNode | ((busy: boolean) => ReactNode);
};
function App() {
  const [me, setMe] = useState<any>(null),
    [data, setData] = useState<any>(null),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState("overview"),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState<Modal | null>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [sidebar, setSidebar] = useState(false),
    [decision, setDecision] = useState<any>(null),
    [demo, setDemo] = useState(false),
    [keys, setKeys] = useState<any[] | null>(null);
  const busyRef = useRef(false);
  // /me와 /overview가 모두 성공했을 때만 함께 반영해 다른 워크스페이스의 자료가 섞이지 않게 합니다.
  const refresh = async () => {
    const [m, d] = await Promise.allSettled([api("/me"), api("/overview")]);
    if (m.status === "rejected") throw m.reason;
    setMe(m.value);
    if (d.status === "rejected") {
      setData(null);
      throw d.reason;
    }
    setData(d.value);
  };
  const openModal = (next: Modal) => {
    setError("");
    setModal(next);
  };
  const closeModal = () => {
    setModal(null);
    setError("");
  };
  useEffect(() => {
    api("/health")
      .then((h) => setDemo(h?.mode === "demo"))
      .catch(() => setDemo(false));
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
    // 긴 입력 창에서도 오류가 보이도록 창 안의 오류 위치로 이동합니다.
    if (error && modal)
      document
        .querySelector(".modal-error")
        ?.scrollIntoView({ block: "nearest" });
  }, [error, modal]);
  const loadKeys = () =>
    api("/keys")
      .then(setKeys)
      .catch((e) => {
        setKeys(null);
        setError("서버 키 목록: " + errorText(e));
      });
  useEffect(() => {
    if (page === "settings" && me?.ctx?.role === "owner") loadKeys();
    else setKeys(null);
  }, [page, me?.ctx?.tenant, me?.ctx?.role]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const timer = setTimeout(
      () =>
        document
          .querySelector<HTMLElement>(
            ".modal input, .modal textarea, .modal select, .modal button",
          )
          ?.focus(),
      0,
    );
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeModal();
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
  function showError(e: unknown) {
    if (e instanceof ApiError && e.code === "UNAUTHENTICATED") {
      setModal(null);
      setMe(null);
      setData(null);
    }
    setError(errorText(e));
  }
  async function action(
    fn: () => Promise<any>,
    success: string | ((value: any) => string) = "저장했습니다.",
  ) {
    // 처리 중 중복 제출을 막습니다. 버튼 상태가 늦게 반영되어도 같은 요청이 두 번 가지 않습니다.
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      let value;
      try {
        value = await fn();
      } catch (e) {
        showError(e);
        return null;
      }
      setToast(typeof success === "function" ? success(value) : success);
      try {
        await refresh();
      } catch (e) {
        if (e instanceof ApiError && e.code === "UNAUTHENTICATED") showError(e);
        else setError(label("REFRESH_FAILED") + " " + errorText(e));
      }
      return value ?? { ok: true };
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function form(
    title: string,
    fields: ReactNode,
    submit: (f: FormData) => Promise<any>,
    success: string | ((value: any) => string) = "저장했습니다.",
    next?: (value: any) => Modal | null,
  ) {
    openModal({
      title,
      content: (isBusy: boolean) => (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const result = await action(() => submit(f), success);
            if (!result) return;
            const following = next?.(result);
            if (following) openModal(following);
            else closeModal();
          }}
        >
          {fields}
          <div className="form-footer">
            <Button type="submit" primary disabled={isBusy}>
              {isBusy ? "처리 중…" : "저장"}
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
                    ...(String(f.get("code") ?? "").trim()
                      ? { code: String(f.get("code")).trim() }
                      : {}),
                  }),
                "로그인했습니다.",
              );
            }}
          >
            <Field label="이메일">
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                placeholder="name@company.com"
              />
            </Field>
            <Field label="비밀번호">
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field>
            <Field label="인증 앱 코드 (설정한 경우)">
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
              />
            </Field>
            <Button type="submit" primary disabled={busy}>
              로그인 <ArrowRight size={16} />
            </Button>
          </form>
          {demo && (
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
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {demo && <small>로컬 개발 환경 · 실제 문자는 발송되지 않습니다.</small>}
        </div>
      </main>
    );
  if (!data)
    return (
      <div className="loading">
        데이터를 불러올 수 없습니다.
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <Button onClick={() => action(refresh, "최신 상태로 업데이트했습니다.")}>
          다시 시도
        </Button>
      </div>
    );
  const currentTenant = me.tenants.find((t: any) => t.id === me.ctx.tenant),
    stats = data.stats,
    isOwner = me.ctx.role === "owner",
    controller = data.controllers[0];
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
    setError("");
  };
  async function switchTenant(id: string) {
    const r = await action(
      () => api("/auth/tenant", { tenant_id: id }),
      "워크스페이스를 변경했습니다.",
    );
    // 이전 워크스페이스의 판단 결과·검색어·열린 창이 새 워크스페이스에 남지 않게 합니다.
    if (r) {
      setDecision(null);
      setSearch("");
      setFilter("all");
      setModal(null);
      setSidebar(false);
    }
  }
  const sendable = data.subjects.filter(
    (s: any) => s.contact_id && !s.restricted,
  );
  const memberOptions = sendable.map((s: any) => (
    <option key={s.id} value={s.id}>
      {s.external_id} · {s.masked} · {label(s.state)}
    </option>
  ));
  const allMemberOptions = data.subjects.map((s: any) => (
    <option key={s.id} value={s.id}>
      {s.external_id}
      {s.masked ? " · " + s.masked : ""}
    </option>
  ));
  const noticeFor = (purposeId: string) =>
    data.notices.find(
      (n: any) => n.purpose_id === purposeId && n.status === "published",
    );
  const contactFor = (s: any, p: any) =>
    p.kind !== "advertising_reception"
      ? null
      : p.channel === "sms"
        ? s.contact_id
        : p.channel === "email"
          ? s.email_contact_id
          : null;
  function consentForm(s: any) {
    const purposes = data.purposes.filter(
      (p: any) => p.kind !== "web_tracking",
    );
    form(
      "의사표시 기록",
      <>
        <div className="notice">
          검증한 회원의 실제 선택을 기록하세요. 담당자가 임의로 수신 동의를
          만들면 안 됩니다.
        </div>
        <Field label="처리 목적">
          <select name="purpose" required>
            {purposes.map((p: any) => {
              const missing =
                p.kind === "advertising_reception" && !contactFor(s, p);
              return (
                <option key={p.id} value={p.id} disabled={missing}>
                  {p.name}
                  {missing
                    ? ` (${p.channel === "email" ? "이메일" : "휴대전화"} 연락처 없음)`
                    : ""}
                </option>
              );
            })}
          </select>
        </Field>
        <Field label="선택">
          <select name="state">
            <option value="revoked">철회</option>
            <option value="denied">거부</option>
            {!s.restricted && <option value="granted">동의</option>}
          </select>
        </Field>
        <Field label="실제 의사표시 시각 (한국 시간)">
          <input
            type="datetime-local"
            name="time"
            required
            defaultValue={kstInput()}
            max={kstInput()}
          />
        </Field>
      </>,
      async (f) => {
        const p = purposes.find((p: any) => p.id === f.get("purpose"));
        if (!p) throw new ApiError("SELECTION_REQUIRED");
        const state = String(f.get("state")),
          n = noticeFor(p.id);
        if (state === "granted" && !n)
          throw new ApiError("NOTICE_NOT_PUBLISHED");
        if (p.kind === "advertising_reception" && !contactFor(s, p))
          throw new ApiError("CONTACT_REQUIRED");
        return api("/consent-events", {
          subject_id: s.id,
          contact_id: contactFor(s, p),
          purpose_id: p.id,
          notice_id: state === "granted" ? n.id : null,
          action: state,
          occurred_at: fromKstInput(String(f.get("time"))),
          idempotency_key: crypto.randomUUID(),
        });
      },
      (e) =>
        e?.duplicate
          ? "이미 기록된 요청입니다."
          : e?.applied === false
            ? "이후 변경이 있어 과거 의사표시로만 보관했습니다."
            : "의사표시를 기록했습니다.",
    );
  }
  function contactForm(s: any) {
    form(
      "연락처 등록",
      <>
        <div className="notice">
          새 번호를 등록하면 같은 채널의 기존 연락처는 비활성화됩니다. 기존
          연락처의 수신 동의는 새 연락처로 이전되지 않습니다.
        </div>
        <Field label="채널">
          <select name="channel">
            <option value="sms">휴대전화 (문자)</option>
            <option value="email">이메일</option>
          </select>
        </Field>
        <Field label="연락처">
          <input
            name="value"
            required
            autoComplete="off"
            placeholder="01012345678 또는 name@example.com"
          />
        </Field>
        <label className="check">
          <input type="checkbox" name="verified" />
          본인 확인(인증번호 등)을 마친 연락처입니다.
        </label>
      </>,
      (f) =>
        api("/contacts", {
          subject_id: s.id,
          channel: f.get("channel"),
          value: String(f.get("value") ?? "").trim(),
          verified: f.get("verified") === "on",
        }),
      "연락처를 등록했습니다.",
    );
  }
  function deletionForm(s: any) {
    form(
      "삭제 요청",
      <>
        <div className="notice">
          요청 즉시 사용을 제한하고 진행 중인 동의를 철회합니다. 시스템별 삭제
          확인은 준수 업무에서 기록합니다.
        </div>
        <Field label="요청 사유">
          <textarea name="reason" required minLength={5} maxLength={1000} />
        </Field>
        <label className="check">
          <input type="checkbox" name="identity" required />
          본인 확인을 완료했습니다.
        </label>
      </>,
      (f) =>
        api("/deletion-requests", {
          subject_id: s.id,
          reason: String(f.get("reason") ?? "").trim(),
          identity_verified: true,
        }),
      "삭제 요청을 등록했습니다.",
    );
  }
  async function memberDetail(s: any) {
    const d = await action(
      () => api("/subjects/" + s.id + "/preferences"),
      "변경 이력을 불러왔습니다.",
    );
    if (!d) return;
    const purposeName = (id: string) =>
      data.purposes.find((p: any) => p.id === id)?.name ?? "알 수 없는 목적";
    openModal({
      title: s.external_id + " · 변경 이력",
      content: (
        <div>
          {s.restricted && (
            <div className="notice">
              {s.deleted_at
                ? "연락처가 파기된 회원입니다. 새 연락처와 동의를 받을 수 없습니다."
                : "삭제 요청으로 사용이 제한된 회원입니다."}
            </div>
          )}
          <p className="subtle">
            휴대전화 {s.masked ?? "미등록"} · 이메일 {s.email_masked ?? "미등록"}
          </p>
          <div className="modal-actions">
            <Button onClick={() => consentForm(s)}>의사표시 기록</Button>
            {!s.restricted && (
              <Button onClick={() => contactForm(s)}>연락처 등록</Button>
            )}
            <Button
              onClick={() =>
                action(
                  () => download("/evidence/" + s.id, `evidence-${s.id}.json`),
                  "증빙 JSON을 내려받았습니다.",
                )
              }
            >
              <Download size={15} />
              증빙 JSON
            </Button>
            {!s.deleted_at && (
              <Button onClick={() => deletionForm(s)}>삭제 요청</Button>
            )}
          </div>
          {d.current.length > 0 && (
            <div className="versions">
              {d.current.map((v: any) => (
                <div key={v.scope}>
                  <span>{purposeName(v.purpose_id)}</span>
                  <Badge value={v.state} />
                  <Badge value={v.evidence} />
                  <span className="subtle mono">r{v.revision}</span>
                </div>
              ))}
            </div>
          )}
          <div className="timeline">
            {d.events.length === 0 && (
              <p className="subtle">기록된 의사표시가 없습니다.</p>
            )}
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
                <span>{purposeName(v.purpose_id)}</span>
                <p>
                  {date(v.received_at)} · r{v.revision} ·{" "}
                  {v.applied ? "반영됨" : "과거 이벤트 — 반영 안 됨"} ·{" "}
                  {label(v.evidence)}
                </p>
              </div>
            ))}
          </div>
        </div>
      ),
    });
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
        const text = String(f.get("csv") ?? "");
        return { text, preview: await api("/import", { csv: text }) };
      },
      "미리보기를 준비했습니다.",
      ({ text, preview }) => ({
        title: "이관 미리보기",
        content: (isBusy: boolean) => (
          <>
            <p>
              총 {preview.rows}명 · 증빙 미검증 {preview.unverified}명 ·
              거부/철회 {preview.suppressions}명
            </p>
            {preview.existing > 0 ? (
              <div className="error">
                이미 등록된 회원 {preview.existing}명이 포함되어 있습니다. 기존
                회원의 연락처와 동의를 덮어쓰지 않도록 CSV에서 제외한 뒤 다시
                시도하세요.
                <br />
                {preview.existing_ids.join(", ")}
                {preview.existing > preview.existing_ids.length ? " 외" : ""}
              </div>
            ) : (
              <div className="notice">
                실제 의사표시 날짜와 증빙을 새로 만들지 않습니다. 연락처는
                미검증 상태로 등록됩니다.
              </div>
            )}
            <div className="form-footer">
              <Button
                primary
                disabled={isBusy || preview.existing > 0}
                onClick={async () => {
                  const r = await action(
                    () => api("/import", { csv: text, commit: true }),
                    (v) => `${v.rows}명의 기존 동의를 이관했습니다.`,
                  );
                  if (r) closeModal();
                }}
              >
                검토 후 이관 승인
              </Button>
            </div>
          </>
        ),
      }),
    );
  }
  const adSmsPurposes = data.purposes.filter(
    (p: any) => p.kind === "advertising_reception" && p.channel === "sms",
  );
  function templateForm() {
    if (!adSmsPurposes.length) {
      setError(label("PURPOSE_NOT_CONFIGURED"));
      return;
    }
    const first = data.controllers.find(
      (c: any) => c.id === adSmsPurposes[0].controller_id,
    );
    form(
      "광고 템플릿 작성",
      <>
        <Field label="템플릿 이름">
          <input name="name" required maxLength={100} />
        </Field>
        <Field label="광고 수신 목적">
          <select name="purpose">
            {adSmsPurposes.map((p: any) => (
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
            maxLength={3000}
            defaultValue={`(광고) ${first?.name ?? ""}\n고객센터: 02-0000-0001\n\n광고 본문을 작성하세요.\n\n무료수신거부 ${first?.opt_out ?? ""}`}
          />
        </Field>
        <p className="subtle">
          발신자·광고 표시·무료 거부 수단을 검수한 뒤 승인합니다.
        </p>
      </>,
      (f) => {
        const p = adSmsPurposes.find((p: any) => p.id === f.get("purpose"));
        if (!p) throw new ApiError("SELECTION_REQUIRED");
        // 템플릿 사업자는 수신 동의 목적의 사업자와 같아야 발송 판단을 통과합니다.
        return api("/templates", {
          controller_id: p.controller_id,
          purpose_id: p.id,
          name: String(f.get("name") ?? "").trim(),
          body: f.get("body"),
        });
      },
      (t) =>
        t.issues?.length
          ? "초안을 저장했습니다. 승인 전 검수 항목을 수정하세요."
          : "초안을 저장했습니다.",
      (t) =>
        t.issues?.length
          ? {
              title: "승인 전 검수 필요",
              content: (
                <>
                  <p>저장한 초안은 아래 항목을 고치기 전까지 승인할 수 없습니다.</p>
                  <ul>
                    {t.issues.map((i: string) => (
                      <li key={i}>{label(i)}</li>
                    ))}
                  </ul>
                </>
              ),
            }
          : null,
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
            maxLength={20000}
            placeholder="처리 목적, 항목, 보유기간, 선택 여부와 철회 방법을 명확히 작성하세요."
          />
        </Field>
        <p className="subtle">
          초안으로 저장합니다. 검토 후 별도로 게시할 수 있습니다.
        </p>
      </>,
      (f) =>
        api("/notices", { purpose_id: f.get("purpose"), body: f.get("body") }),
      "문구 초안을 저장했습니다.",
    );
  }
  function siteForm() {
    if (!controller) {
      setError(label("CONTROLLER_REQUIRED"));
      return;
    }
    form(
      "사이트 등록",
      <>
        <Field label="도메인">
          <input
            name="domain"
            placeholder="www.example.com"
            required
            autoComplete="off"
          />
        </Field>
        <p className="subtle">등록 후 DNS TXT 레코드로 소유권을 확인합니다.</p>
      </>,
      (f) =>
        api("/sites", {
          controller_id: controller.id,
          // 붙여 넣은 주소의 scheme·경로·대문자를 정리합니다.
          domain: String(f.get("domain") ?? "")
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, "")
            .replace(/[/?#].*$/, ""),
        }),
      "사이트를 등록했습니다.",
    );
  }
  function configForm(s: any) {
    form(
      "새 웹 설정 버전",
      <>
        <Field label="배너 문구">
          <textarea name="notice" required minLength={10} maxLength={5000} />
        </Field>
        <Field label="태그 설정 JSON">
          <textarea name="tags" rows={7} defaultValue="[]" />
        </Field>
        <p className="subtle">
          태그: id, name, purpose(analytics/advertising),
          type(script/pixel/iframe), src(https URL), cookies
        </p>
      </>,
      (f) => {
        let tags;
        try {
          tags = JSON.parse(String(f.get("tags") ?? "[]"));
        } catch {
          throw new ApiError("TAGS_JSON_INVALID");
        }
        if (!Array.isArray(tags)) throw new ApiError("TAGS_JSON_INVALID");
        return api("/web-configs", {
          site_id: s.id,
          notice: f.get("notice"),
          tags,
        });
      },
      "설정 초안을 저장했습니다.",
    );
  }
  function keyForm() {
    form(
      "서버 키 발급",
      <>
        <Field label="키 이름">
          <input name="name" required maxLength={100} />
        </Field>
        <fieldset className="checks">
          <legend>권한 (하나 이상)</legend>
          {[
            "consent:write",
            "read",
            "decisions",
            "messages:send",
            "evidence:read",
            "deletion:write",
          ].map((scope) => (
            <label className="check" key={scope}>
              <input type="checkbox" name="scope" value={scope} />
              {label(scope)}
            </label>
          ))}
        </fieldset>
      </>,
      (f) => {
        const scopes = f.getAll("scope").map(String);
        if (!scopes.length) throw new ApiError("SELECTION_REQUIRED");
        return api("/keys", {
          name: String(f.get("name") ?? "").trim(),
          scopes,
        });
      },
      "서버 키를 발급했습니다.",
      (k) => {
        loadKeys();
        return {
          title: "발급된 서버 키",
          content: (
            <>
              <p>이 화면에서만 표시됩니다. 안전한 곳에 보관하세요.</p>
              <pre>{k.secret}</pre>
            </>
          ),
        };
      },
    );
  }
  function revokeKey(k: any) {
    openModal({
      title: "서버 키 폐기",
      content: (isBusy: boolean) => (
        <>
          <p>
            <strong>{k.name}</strong> 키를 폐기하면 이 키를 쓰는 서버 연동이
            즉시 중단됩니다. 되돌릴 수 없습니다.
          </p>
          <div className="form-footer">
            <Button
              primary
              disabled={isBusy}
              onClick={async () => {
                const r = await action(
                  () => api("/keys/" + k.id, undefined, "DELETE"),
                  "서버 키를 폐기했습니다.",
                );
                if (r) {
                  closeModal();
                  loadKeys();
                }
              }}
            >
              폐기
            </Button>
          </div>
        </>
      ),
    });
  }
  const workerSummary = (r: any) =>
    `처리 완료 · 전달 ${r?.accepted ?? 0}건 · 차단 ${r?.blocked ?? 0}건` +
    (r?.failed ? ` · 확인 필요 ${r.failed}건` : "");
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
            <span>
              {currentTenant?.status === "suspended"
                ? "중지된 워크스페이스"
                : (currentTenant?.plan === "growth"
                    ? "Growth"
                    : (currentTenant?.plan ?? "")) + " 워크스페이스"}
            </span>
          </div>
          <ChevronDown size={14} />
          <select
            aria-label="워크스페이스 선택"
            value={me.ctx.tenant}
            disabled={busy}
            onChange={(e) => switchTenant(e.target.value)}
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
            {demo ? (
              <>
                개발 · 체험 환경<p>합성 데이터 / 모의 발송사</p>
              </>
            ) : (
              <>
                운영 모드<p>연동 상태는 조직 · 연동에서 확인</p>
              </>
            )}
          </div>
          <button
            className="profile"
            onClick={async () => {
              try {
                await api("/auth/logout", {});
              } catch (e) {
                setError("로그아웃하지 못했습니다. " + errorText(e));
                return;
              }
              setMe(null);
              setData(null);
              setModal(null);
              setDecision(null);
              setKeys(null);
              setPage("overview");
              setError("");
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
                <Button primary onClick={siteForm} disabled={!controller}>
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
          {error && !modal && (
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
                    demo ? "테넌트 내 합성 회원" : "이 워크스페이스의 회원",
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
                        {auditLabels[a.action] ?? a.action}
                      </td>
                      <td>{actorLabel(a.actor, me.ctx.actor)}</td>
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
                      <>
                        <Field label="고객사 회원 ID">
                          <input name="id" required maxLength={120} />
                        </Field>
                        <p className="subtle">
                          연락처와 동의는 등록 후 회원 상세에서 기록합니다.
                        </p>
                      </>,
                      (f) =>
                        api("/subjects", {
                          external_id: String(f.get("id") ?? "").trim(),
                        }),
                      (v) =>
                        v?.created === false
                          ? "이미 등록된 회원입니다. 기존 정보를 유지했습니다."
                          : "회원을 등록했습니다.",
                    )
                  }
                >
                  <Plus size={15} />
                  회원 등록
                </Button>
              </div>
              {(() => {
                const query = search.trim().toLowerCase(),
                  rows = data.subjects.filter(
                    (s: any) =>
                      [s.external_id, s.masked, s.email_masked]
                        .filter(Boolean)
                        .join(" ")
                        .toLowerCase()
                        .includes(query) &&
                      (filter === "all" || s.state === filter),
                  );
                return (
                  <Table
                    heads={[
                      "회원",
                      "연락처",
                      "문자 광고 동의",
                      "증빙 상태",
                      "버전",
                      "관리",
                    ]}
                    empty={!rows.length}
                  >
                    {rows.map((s: any) => (
                      <tr key={s.id}>
                        <td>
                          <strong>{s.external_id}</strong>{" "}
                          {s.restricted && (
                            <Badge value={s.deleted_at ? "DELETED" : "RESTRICTED"} />
                          )}
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
                            onClick={() => memberDetail(s)}
                          >
                            상세 보기 <ArrowUpRight size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </Table>
                );
              })()}
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
                <Table
                  heads={["이름", "상태", "검토"]}
                  empty={!data.templates.length}
                >
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
                            openModal({
                              title: t.name,
                              content: (isBusy: boolean) => (
                                <>
                                  {t.title && <p>제목: {t.title}</p>}
                                  <pre>{t.body}</pre>
                                  {t.status !== "approved" && (
                                    <div className="form-footer">
                                      <Button
                                        primary
                                        disabled={isBusy}
                                        onClick={async () => {
                                          const r = await action(
                                            () =>
                                              api(
                                                "/templates/" +
                                                  t.id +
                                                  "/approve",
                                                {},
                                              ),
                                            "템플릿을 승인했습니다.",
                                          );
                                          if (r) closeModal();
                                        }}
                                      >
                                        내용 검토 후 승인
                                      </Button>
                                    </div>
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
                        s = sendable.find((s: any) => s.id === f.get("subject")),
                        template = f.get("template");
                      setDecision(null);
                      const d = await action(async () => {
                        if (!s || !template)
                          throw new ApiError("SELECTION_REQUIRED");
                        return api("/decisions", {
                          subject_id: s.id,
                          contact_id: s.contact_id,
                          template_id: template,
                        });
                      }, "판단이 기록되었습니다.");
                      if (d) setDecision({ ...d, member: s?.external_id });
                    }}
                  >
                    <Field label="회원">
                      <select name="subject" required>
                        {memberOptions}
                      </select>
                    </Field>
                    <Field label="메시지 템플릿">
                      <select name="template" required>
                        {data.templates.map((t: any) => (
                          <option key={t.id} value={t.id}>
                            {t.name} · {label(t.status)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {(!sendable.length || !data.templates.length) && (
                      <p className="subtle">
                        연락처가 등록된 회원과 템플릿이 있어야 검사할 수
                        있습니다.
                      </p>
                    )}
                    <Button
                      primary
                      type="submit"
                      disabled={
                        busy || !sendable.length || !data.templates.length
                      }
                    >
                      발송 전 검사 <ArrowRight size={15} />
                    </Button>
                  </form>
                  {decision && (
                    <div
                      role="status"
                      className={
                        "decision " + (decision.allowed ? "allowed" : "denied")
                      }
                    >
                      <strong>
                        {decision.allowed ? "발송 가능" : "발송 차단"}
                        {decision.member ? " · " + decision.member : ""}
                      </strong>
                      <p>
                        {decision.allowed
                          ? "현재 동의와 정책을 충족합니다."
                          : decision.reasons.map(label).join(" · ")}
                      </p>
                      <small>
                        규칙 {decision.ruleset} · 동의 r{decision.revision} ·{" "}
                        {date(decision.evaluated_at)}
                      </small>
                    </div>
                  )}
                </section>
                <section className="card padded">
                  <p className="eyebrow">MESSAGE GATEWAY</p>
                  <h2>검수된 메시지 예약</h2>
                  <p className="subtle">
                    {data.connectors.some((c: any) => c.provider === "mock")
                      ? "모의 발송사를 사용하며 실제 문자는 발송하지 않습니다."
                      : "발송 직전에 동의와 정책을 다시 확인합니다."}
                  </p>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const el = e.currentTarget,
                        f = new FormData(el),
                        s = sendable.find((s: any) => s.id === f.get("subject")),
                        template = f.get("template"),
                        scheduled = String(f.get("scheduled") ?? "");
                      const job = await action(
                        async () => {
                          if (!s || !template)
                            throw new ApiError("SELECTION_REQUIRED");
                          return api("/messages", {
                            subject_id: s.id,
                            contact_id: s.contact_id,
                            template_id: template,
                            idempotency_key: crypto.randomUUID(),
                            ...(scheduled
                              ? { scheduled_at: fromKstInput(scheduled) }
                              : {}),
                          });
                        },
                        (j) =>
                          j.status === "queued"
                            ? "발송 대기열에 등록했습니다. 실행 직전에 다시 검사합니다."
                            : "정책에 따라 차단되었습니다: " +
                              j.reasons.map(label).join(" · "),
                      );
                      if (job) el.reset();
                    }}
                  >
                    <Field label="회원">
                      <select name="subject" required>
                        {memberOptions}
                      </select>
                    </Field>
                    <Field label="승인 템플릿">
                      <select name="template" required>
                        {data.templates
                          .filter((t: any) => t.status === "approved")
                          .map((t: any) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="예약 시각 (한국 시간, 비워두면 즉시 대기)">
                      <input
                        type="datetime-local"
                        name="scheduled"
                        min={kstInput()}
                      />
                    </Field>
                    <Button
                      type="submit"
                      primary
                      disabled={
                        busy ||
                        !sendable.length ||
                        !data.templates.some(
                          (t: any) => t.status === "approved",
                        )
                      }
                    >
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
                      action(() => api("/worker/run", {}), workerSummary)
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
                {demo && (
                  <Button
                    disabled={!controller}
                    onClick={async () => {
                      // 새 창은 클릭 직후 열어야 팝업 차단을 피할 수 있습니다.
                      const popup = window.open("about:blank", "_blank");
                      const s = await action(
                        () => api("/demo/site", {}),
                        "SDK 체험 사이트를 준비했습니다.",
                      );
                      if (s && popup) {
                        popup.opener = null;
                        popup.location.href =
                          location.origin +
                          "/demo?key=" +
                          encodeURIComponent(s.public_key);
                      } else popup?.close();
                    }}
                  >
                    SDK 체험 열기 <ArrowUpRight size={15} />
                  </Button>
                )}
              </div>
              {data.sites.length === 0 ? (
                <section className="card">
                  <Empty
                    text={
                      demo
                        ? "첫 사이트를 등록하거나 SDK 체험을 시작하세요."
                        : "첫 사이트를 등록하세요."
                    }
                  />
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
                          disabled={busy}
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
                        disabled={busy || !s.verified_at}
                        onClick={() =>
                          action(
                            () => api("/sites/" + s.id + "/scan", {}),
                            (r) =>
                              "설치 검사 결과를 기록했습니다: " + label(r.status),
                          )
                        }
                      >
                        설치 검사
                      </Button>
                      <Button
                        disabled={busy || !s.verified_at}
                        onClick={() => configForm(s)}
                      >
                        설정 버전 추가
                      </Button>
                    </div>
                    {!s.verified_at && (
                      <p className="subtle">
                        설치 검사와 설정 추가는 소유권 확인 후 사용할 수
                        있습니다.
                      </p>
                    )}
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
                                disabled={busy}
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
                          <span>
                            {date(v.created_at)} ·{" "}
                            {(v.result.warnings ?? []).map(label).join(" · ") ||
                              "경고 없음"}
                          </span>
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
                    disabled={busy}
                    onClick={() =>
                      action(() => api("/worker/run", {}), workerSummary)
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
                          ? `2년 주기 수신동의 확인${n.cycle ? ` (${n.cycle + 1}회차)` : ""}`
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
                      <p className="subtle">
                        {data.subjects.find((m: any) => m.id === d.subject_id)
                          ?.external_id ?? d.subject_id.slice(0, 8)}{" "}
                        · 요청 {date(d.created_at)}
                      </p>
                      {data.deletion_tasks
                        .filter((t: any) => t.request_id === d.id)
                        .map((t: any) => (
                          <div key={t.id}>
                            <span>{label(t.system)}</span>
                            <Badge value={t.status} />
                            {t.status === "pending" && (
                              <Button
                                disabled={busy}
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
                                          maxLength={2000}
                                        />
                                      </Field>
                                    </>,
                                    (f) =>
                                      api(
                                        "/deletion-tasks/" + t.id + "/confirm",
                                        {
                                          evidence: String(
                                            f.get("proof") ?? "",
                                          ).trim(),
                                        },
                                      ),
                                    "삭제 결과를 기록했습니다.",
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
                    const f = new FormData(e.currentTarget),
                      subject = String(f.get("subject") ?? ""),
                      format = f.get("format") === "csv" ? "csv" : "json";
                    action(
                      () => {
                        if (!subject) throw new ApiError("SELECTION_REQUIRED");
                        return download(
                          "/evidence/" + subject + "?format=" + format,
                          `evidence-${subject}.${format}`,
                        );
                      },
                      "증빙을 내려받았습니다. 내보내기 기록이 감사 기록에 남습니다.",
                    );
                  }}
                >
                  <select name="subject" aria-label="증빙 대상 회원" required>
                    {allMemberOptions}
                  </select>
                  <select name="format" aria-label="파일 형식">
                    <option value="json">JSON 묶음</option>
                    <option value="csv">CSV 이벤트</option>
                  </select>
                  <Button
                    type="submit"
                    primary
                    disabled={busy || !data.subjects.length}
                  >
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
                <Table
                  heads={["목적", "버전", "상태", "내용", "작업"]}
                  empty={!data.notices.length}
                >
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
                            openModal({
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
                            disabled={busy}
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
                  heads={["시간", "작업", "실행 주체", "참조"]}
                  empty={!data.audit.length}
                >
                  {data.audit.slice(0, 30).map((a: any) => (
                    <tr key={a.id}>
                      <td>{date(a.created_at)}</td>
                      <td>{auditLabels[a.action] ?? a.action}</td>
                      <td>{actorLabel(a.actor, me.ctx.actor)}</td>
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
                  {me.user?.mfa_enabled ? (
                    <p className="subtle">
                      2단계 인증이 설정되어 있습니다. 로그인할 때 인증 앱 코드가
                      필요합니다.
                    </p>
                  ) : (
                    <div className="form-footer">
                      <Button
                        disabled={busy}
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
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    pattern="[0-9]{6}"
                                    maxLength={6}
                                    required
                                  />
                                </Field>
                              </>,
                              (f) =>
                                api("/auth/mfa/finish", {
                                  code: String(f.get("code") ?? "").trim(),
                                }),
                              "2단계 인증을 설정했습니다.",
                            );
                        }}
                      >
                        2단계 인증 설정
                      </Button>
                    </div>
                  )}
                </section>
                <section className="card padded">
                  <p className="eyebrow">SERVER API</p>
                  <h2>서버 API 키</h2>
                  <p>회원 동의를 다루는 키는 서버에서만 사용하세요.</p>
                  {isOwner ? (
                    <>
                      <Button disabled={busy} onClick={keyForm}>
                        <Plus size={15} />
                        서버 키 발급
                      </Button>
                      <div className="versions">
                        {keys === null ? (
                          <p className="subtle">키 목록을 불러오는 중…</p>
                        ) : keys.length === 0 ? (
                          <p className="subtle">발급한 키가 없습니다.</p>
                        ) : (
                          keys.map((k: any) => (
                            <div key={k.id} className="key-row">
                              <span>
                                <strong>{k.name}</strong>
                                <small className="block subtle">
                                  {k.scopes.map(label).join(" · ")} · 발급{" "}
                                  {date(k.created_at)}
                                </small>
                              </span>
                              {k.revoked_at ? (
                                <span className="badge bad">
                                  폐기 {date(k.revoked_at)}
                                </span>
                              ) : (
                                <Button
                                  disabled={busy}
                                  onClick={() => revokeKey(k)}
                                >
                                  폐기
                                </Button>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="subtle">
                      서버 키는 워크스페이스 소유자만 발급·폐기할 수 있습니다.
                    </p>
                  )}
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
                <Table
                  heads={["공급자", "연결 상태", "동작", "장애 시나리오"]}
                  empty={!data.connectors.length}
                >
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
                            disabled={busy || !isOwner}
                            onChange={(e) =>
                              action(
                                () =>
                                  api("/connectors/" + c.id + "/mock-mode", {
                                    mode: e.target.value,
                                  }),
                                "다음 발송 1건에 적용됩니다.",
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
                  key={currentTenant?.id + ":" + currentTenant?.ad_limit}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const limit = Number(
                      new FormData(e.currentTarget).get("limit"),
                    );
                    await action(
                      () => api("/plan", { ad_limit: limit }),
                      (r) =>
                        `월 광고 발송 한도를 ${Number(r.ad_limit).toLocaleString()}건으로 변경했습니다.`,
                    );
                  }}
                >
                  <Field label="월 광고 발송 한도">
                    <input
                      name="limit"
                      type="number"
                      min="0"
                      max="1000000"
                      step="1"
                      defaultValue={currentTenant?.ad_limit ?? 1000}
                      disabled={!isOwner}
                      required
                    />
                  </Field>
                  <Button type="submit" disabled={busy || !isOwner}>
                    한도 저장
                  </Button>
                </form>
                {!isOwner && (
                  <p className="subtle">
                    발송 한도는 워크스페이스 소유자만 변경할 수 있습니다.
                  </p>
                )}
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
        <div className="modal-backdrop" onClick={closeModal}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={modal.title}
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2>{modal.title}</h2>
              <button aria-label="닫기" onClick={closeModal}>
                <X size={20} />
              </button>
            </header>
            {/* 창 안에서 발생한 오류는 창 안에 표시합니다. 뒤쪽 화면에 가려지지 않습니다. */}
            {error && (
              <div role="alert" className="error modal-error">
                {error}
              </div>
            )}
            {typeof modal.content === "function"
              ? modal.content(busy)
              : modal.content}
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
