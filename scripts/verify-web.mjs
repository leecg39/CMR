// Pass Ego Lite's documented taskSpace helper and an already authorized space.
export async function verifyWeb(taskSpace, { output, space }) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { createHash } = await import("node:crypto");
  const assert = (await import("node:assert/strict")).default;
  assert.ok(
    output && path.isAbsolute(output) && space > 0,
    "Pass an absolute PoC folder and the authorized TaskSpace ID.",
  );
  const api = JSON.parse(
    await fs.readFile(path.join(output, "http.json"), "utf8"),
  );
  const target = new URL(api.browser.url);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/demo");
  const task = await taskSpace(space);
  assert.equal(task.ownership, "agent");
  const page = task.page("p1");
  const report = {
    started_at: new Date().toISOString(),
    status: "running",
    source_sha256: api.source_sha256,
    sdk_sha256: createHash("sha256")
      .update(
        await fs.readFile("/Users/user01/Desktop/CMP/packages/web-sdk/cmp.js"),
      )
      .digest("hex"),
    scenarios: [],
  };
  const save = () =>
    fs.writeFile(
      path.join(output, "browser.json"),
      JSON.stringify(report, null, 2),
    );
  const capture = async (name) => {
    const state = await page.evaluate(() => ({
      choices: window.CMP.getChoices(),
      requests: performance
        .getEntriesByType("resource")
        .filter((e) => new URL(e.name).pathname === "/demo/tag.js")
        .map((e) => new URL(e.name).searchParams.get("kind"))
        .sort(),
      executed: [...(window.demoRequests || [])].sort(),
      activeTags: document.querySelectorAll("[data-cmp-active]").length,
      panelHidden:
        document
          .querySelector("#cmp-consent")
          ?.shadowRoot?.querySelector("section").hidden ?? null,
      error:
        document
          .querySelector("#cmp-consent")
          ?.shadowRoot?.querySelector("[role=alert]").textContent ?? null,
      consentRequests: window.__cmpProbe?.calls,
      configErrors: window.__cmpErrors,
      consentSignals: (window.dataLayer || [])
        .filter((e) => e[0] === "consent")
        .map((e) => ({ type: e[1], value: e[2] })),
    }));
    report.scenarios.push({ name, ...state });
    await save();
    return state;
  };
  const ready = () =>
    page.waitForFunction(
      () =>
        !!document
          .querySelector("#cmp-consent")
          ?.shadowRoot?.querySelector("section"),
      undefined,
      { timeout: 10000 },
    );
  const noTags = (state) => {
    assert.deepEqual(state.requests, []);
    assert.deepEqual(state.executed, []);
    assert.deepEqual(state.choices, { analytics: false, advertising: false });
    assert.equal(state.consentSignals[0].value.analytics_storage, "denied");
  };
  let errorObserver;
  try {
    await page.goto(api.browser.url);
    await ready();
    console.log(await page.snapshot());
    noTags(await capture("미선택"));
    await page.click('loc=role:button[name="모두 거절"]');
    await page.waitForFunction(
      () =>
        document
          .querySelector("#cmp-consent")
          .shadowRoot.querySelector("section").hidden,
      undefined,
      { timeout: 10000 },
    );
    noTags(await capture("전체 거절"));
    await page.reload();
    await ready();
    noTags(await capture("거절 후 재방문"));
    await page.click('loc=role:button[name="개인정보 설정"]');
    await page.click('loc=css:input[name="analytics"]');
    await page.click('loc=role:button[name="선택 저장"]');
    await page.waitForFunction(
      () =>
        window.CMP.getChoices().analytics &&
        (window.demoRequests || []).length === 1,
      undefined,
      { timeout: 10000 },
    );
    let state = await capture("분석만 허용");
    assert.deepEqual(state.requests, ["analytics"]);
    assert.deepEqual(state.executed, ["analytics"]);
    assert.equal(state.choices.advertising, false);
    await page.screenshot({
      path: path.join(output, "web-analytics-only.png"),
    });
    await page.reload();
    await ready();
    await page.waitForFunction(
      () => (window.demoRequests || []).length === 1,
      undefined,
      { timeout: 10000 },
    );
    state = await capture("분석만 허용 후 재방문");
    assert.deepEqual(state.requests, ["analytics"]);
    assert.deepEqual(state.executed, ["analytics"]);
    await page.click('loc=role:button[name="개인정보 설정"]');
    await page.click('loc=role:button[name="모두 허용"]');
    await page.waitForFunction(
      () =>
        window.CMP.getChoices().advertising &&
        (window.demoRequests || []).length === 2,
      undefined,
      { timeout: 10000 },
    );
    state = await capture("전체 허용");
    assert.deepEqual(state.requests, ["advertising", "analytics"]);
    assert.deepEqual(state.executed, ["advertising", "analytics"]);
    await page.reload();
    await ready();
    await page.waitForFunction(
      () => (window.demoRequests || []).length === 2,
      undefined,
      { timeout: 10000 },
    );
    state = await capture("전체 허용 후 재방문");
    assert.deepEqual(state.requests, ["advertising", "analytics"]);
    assert.deepEqual(state.executed, ["advertising", "analytics"]);
    await page.evaluate(() => window.CMP.revoke());
    state = await capture("허용 후 철회");
    assert.deepEqual(state.choices, { analytics: false, advertising: false });
    assert.equal(state.activeTags, 0);
    await page.reload();
    await ready();
    noTags(await capture("철회 후 재방문"));
    await page.screenshot({ path: path.join(output, "web-revoked.png") });

    await page.click('loc=role:button[name="개인정보 설정"]');
    await page.evaluate(() => {
      const probe = { calls: [], held: false };
      window.__cmpProbe = probe;
      const original = window.fetch;
      probe.originalFetch = original;
      const gate = new Promise((resolve) => (probe.release = resolve));
      window.fetch = async (input, options) => {
        const url = typeof input === "string" ? input : input.url;
        if (new URL(url, location.href).pathname !== "/v1/web/consent")
          return original(input, options);
        const body = JSON.parse(options.body);
        probe.calls.push(body.choices);
        const response = await original(input, options);
        if (body.choices.analytics && body.choices.advertising) {
          probe.held = true;
          await gate;
        }
        return response;
      };
      document
        .querySelector("#cmp-consent")
        .shadowRoot.querySelector('[data-action="accept"]')
        .click();
      probe.revocation = window.CMP.revoke();
    });
    await page.waitForFunction(() => window.__cmpProbe.held, undefined, {
      timeout: 10000,
    });
    state = await capture("연속 허용·철회: 허용 응답을 보류한 동안");
    noTags(state);
    assert.equal(state.consentRequests.length, 1);
    await page.evaluate(async () => {
      const p = window.__cmpProbe;
      p.release();
      try {
        await p.revocation;
      } finally {
        window.fetch = p.originalFetch;
      }
    });
    state = await capture("연속 허용·철회: 마지막 철회 저장 후");
    noTags(state);
    assert.deepEqual(state.consentRequests, [
      { analytics: true, advertising: true },
      { analytics: false, advertising: false },
    ]);
    assert.equal(state.panelHidden, true);
    await page.reload();
    await ready();
    noTags(await capture("연속 허용·철회 후 재방문"));

    await page.cdp("Network.enable");
    await page.cdp("Network.setBlockedURLs", {
      urls: [target.origin + "/v1/web/consent"],
    });
    await page.click('loc=role:button[name="개인정보 설정"]');
    await page.click('loc=role:button[name="모두 허용"]');
    await page.waitForFunction(
      () =>
        !!document
          .querySelector("#cmp-consent")
          .shadowRoot.querySelector("[role=alert]").textContent,
      undefined,
      { timeout: 10000 },
    );
    state = await capture("저장 API 연결 실패");
    noTags(state);
    assert.equal(state.panelHidden, false);
    assert.equal(
      state.error,
      "선택을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
    await page.screenshot({ path: path.join(output, "web-save-failure.png") });
    await page.cdp("Network.setBlockedURLs", { urls: [] });
    await page.click('loc=role:button[name="모두 거절"]');
    await page.waitForFunction(
      () =>
        document
          .querySelector("#cmp-consent")
          .shadowRoot.querySelector("section").hidden,
      undefined,
      { timeout: 10000 },
    );
    await page.click('loc=role:button[name="개인정보 설정"]');
    state = await capture("저장 실패 후 재시도·설정 다시 열기");
    noTags(state);
    assert.equal(state.error, "");

    errorObserver = (
      await page.cdp("Page.addScriptToEvaluateOnNewDocument", {
        source:
          'window.__cmpErrors=[];window.addEventListener("cmp:error",e=>window.__cmpErrors.push(e.detail.reason));',
      })
    ).identifier;
    await page.cdp("Network.setBlockedURLs", {
      urls: [target.origin + "/v1/web/config*"],
    });
    await page.reload();
    await page.waitForFunction(
      () => window.__cmpErrors?.includes("CONFIG_UNAVAILABLE"),
      undefined,
      { timeout: 10000 },
    );
    state = await capture("설정 API 연결 실패");
    noTags(state);
    assert.equal(state.panelHidden, null);
    await page.cdp("Network.setBlockedURLs", { urls: [] });
    await page.reload();
    await ready();
    noTags(await capture("설정 API 복구 후 재방문"));
    report.status = "passed";
    report.finished_at = new Date().toISOString();
    await save();
    console.log({
      status: report.status,
      checks: report.scenarios.length,
      output,
    });
    console.log(await page.snapshot());
  } catch (error) {
    report.status = "failed";
    report.error = String(error);
    await save();
    throw error;
  } finally {
    await page.cdp("Network.setBlockedURLs", { urls: [] });
    if (errorObserver)
      await page.cdp("Page.removeScriptToEvaluateOnNewDocument", {
        identifier: errorObserver,
      });
  }
}
