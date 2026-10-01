(() => {
  "use strict";
  const script = document.currentScript,
    base = new URL(script.src).origin,
    key = script.dataset.site;
  const storageKey = "cmp-session:" + key;
  const saveFailureMessage =
    "선택을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  let config,
    session,
    choices = { analytics: false, advertising: false },
    panel,
    activated = new Set(),
    saveQueue = Promise.resolve(),
    latestSelection = 0;
  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  gtag("consent", "default", {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  const request = async (path, body) => {
    const r = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw Error(saveFailureMessage);
    return r.json();
  };
  function apply() {
    gtag("consent", "update", {
      analytics_storage: choices.analytics ? "granted" : "denied",
      ad_storage: choices.advertising ? "granted" : "denied",
      ad_user_data: choices.advertising ? "granted" : "denied",
      ad_personalization: choices.advertising ? "granted" : "denied",
    });
    for (const tag of config.tags) {
      if (!choices[tag.purpose]) {
        document
          .querySelectorAll('[data-cmp-active="' + CSS.escape(tag.id) + '"]')
          .forEach((n) => n.remove());
        for (const cookie of tag.cookies || [])
          if (/^[a-zA-Z0-9_-]+$/.test(cookie))
            document.cookie = cookie + "=; Max-Age=0; Path=/; SameSite=Lax";
        continue;
      }
      if (activated.has(tag.id)) continue;
      activated.add(tag.id);
      let el;
      if (tag.type === "pixel") el = new Image();
      else if (tag.type === "iframe") {
        el = document.createElement("iframe");
        el.title = tag.name || "선택적 콘텐츠";
      } else {
        el = document.createElement("script");
        el.async = true;
      }
      el.dataset.cmpActive = tag.id;
      el.src = tag.src;
      document.body.appendChild(el);
    }
    window.dispatchEvent(
      new CustomEvent("cmp:change", { detail: { ...choices } }),
    );
  }
  function save(next) {
    const selection = ++latestSelection;
    panel.querySelector("[role=alert]").textContent = "";
    saveQueue = saveQueue.then(async () => {
      try {
        const result = await request("/v1/web/consent", {
          key,
          session,
          version: config.version,
          choices: next,
          idempotency_key: crypto.randomUUID(),
        });
        if (selection !== latestSelection) return;
        choices = result.choices;
        apply();
        panel.hidden = true;
      } catch {
        if (selection === latestSelection)
          panel.querySelector("[role=alert]").textContent = saveFailureMessage;
      }
    });
    return saveQueue;
  }
  function show() {
    if (!config) return;
    panel.hidden = false;
    panel
      .querySelectorAll("input")
      .forEach((i) => (i.checked = choices[i.name]));
    panel.querySelector("button").focus();
  }
  function render() {
    const host = document.createElement("div");
    host.id = "cmp-consent";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML =
      '<style>:host{font-family:system-ui}section{position:fixed;z-index:2147483646;bottom:24px;left:24px;max-width:440px;width:calc(100vw - 72px);padding:24px;background:#fff;color:#192b2a;border:1px solid #d7e1df;border-radius:16px;box-shadow:0 12px 60px #0002}h2{font-size:19px;margin:0 0 12px}p{line-height:1.6;font-size:13px}button{padding:11px 14px;margin:5px 4px 0 0;border:1px solid #47645c;border-radius:8px;color:#133d32;background:#fff;cursor:pointer}label{display:block;padding:8px 0}button:focus-visible{outline:3px solid #a5c6e6}[hidden]{display:none}.settings{position:fixed;bottom:12px;right:12px;z-index:2147483645} [role=alert]{color:#a62e26}</style><button class="settings">개인정보 설정</button><section role="dialog" aria-label="개인정보 선택"><h2>개인정보 선택은 직접 결정하세요</h2><p class="notice"></p><label><input type="checkbox" name="analytics"> 사이트 분석 허용</label><label><input type="checkbox" name="advertising"> 웹 광고 허용</label><div><button data-action="reject">모두 거절</button><button data-action="save">선택 저장</button><button data-action="accept">모두 허용</button></div><p role="alert"></p><p>철회하면 이후 로딩을 중단합니다. 이미 실행된 스크립트는 페이지를 새로 열면 중단됩니다.</p></section>';
    document.body.appendChild(host);
    panel = root.querySelector("section");
    root.querySelector(".notice").textContent = config.notice;
    root.querySelector(".settings").onclick = show;
    root.querySelector("[data-action=reject]").onclick = () =>
      save({ analytics: false, advertising: false });
    root.querySelector("[data-action=accept]").onclick = () =>
      save({ analytics: true, advertising: true });
    root.querySelector("[data-action=save]").onclick = () =>
      save(
        Object.fromEntries(
          [...panel.querySelectorAll("input")].map((i) => [i.name, i.checked]),
        ),
      );
    panel.hidden = config.has_choice;
  }
  window.CMP = {
    open: show,
    getChoices: () => ({ ...choices }),
    revoke: () => save({ analytics: false, advertising: false }),
  };
  (async () => {
    try {
      let old;
      try {
        old = localStorage.getItem(storageKey);
      } catch {}
      const result = await request(
        "/v1/web/config?key=" +
          encodeURIComponent(key) +
          "&session=" +
          encodeURIComponent(old || ""),
      );
      config = result.config;
      session = result.session;
      choices = result.choices;
      try {
        localStorage.setItem(storageKey, session);
      } catch {}
      render();
      apply();
    } catch {
      window.dispatchEvent(
        new CustomEvent("cmp:error", {
          detail: { reason: "CONFIG_UNAVAILABLE" },
        }),
      );
    }
  })();
})();
