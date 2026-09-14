import {nativeAssetsFixture, isNativeAssetsRead} from "./native-assets-fixture.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../runtime/preload.cjs", import.meta.url), "utf8");
export const presentationSource = source.slice(source.indexOf("function syncWebAstraProLabels("), source.indexOf("\nfunction isTopFrame("));

// Native attributes and __reactProps$ children shapes observed in 26.901.41600 staging.
export function fixture(document) {
  const host = document.createElement("section");
  host.innerHTML = `<div role="presentation" data-composer-layout="multiline">
    <button id="web-pro-test-trigger" data-codex-intelligence-trigger="true" data-composer-navigation-target="reasoning" data-selected-reasoning-effort="high" aria-controls="web-pro-test-menu" aria-describedby="web-pro-test-tip">
      <span id="model-label">Astra</span><span id="trigger-effort">High</span>
    </button>
    <div id="warning-owner"><div role="status" id="swarm-warning"><span>Ultra with up to 8 agents can use your usage limits quickly</span><button>Dismiss</button></div></div>
  </div>
  <div role="menu" id="web-pro-test-menu" aria-labelledby="web-pro-test-trigger">
    <div role="menuitem" id="pro-option"><span>High</span></div>
    <div role="menuitem" id="native-option"><span class="name">Astra</span><span class="effort">High</span></div>
  </div>
  <div role="tooltip" id="web-pro-test-tip"><span>High</span></div>
  <div role="dialog" id="permission-dialog"><span>Use Ultra with Full access?</span><button>Use Full access</button></div>
  <p id="unrelated">High</p>`;
  document.body.append(host);
  const get = (selector) => host.querySelector(selector);
  const props = (element, children) => { element.__reactProps$fixture = { children }; };
  const model = (id) => ({ props: { model: id, displayName: "Astra" } });
  const effort = { props: { id: "composer.mode.local.reasoning.high.label" } };
  for (const selector of ["#trigger-effort", "#pro-option span", "#native-option .effort", "#web-pro-test-tip span"]) props(get(selector), effort);
  props(get("#native-option .name"), model("gpt-6-astra"));
  props(get("#swarm-warning span"), { props: { id: "composer.intelligenceDropdown.ultraAgentUsageWarning" } });
  function select(id, warningModel = id) {
    props(get("#model-label"), model(id));
    props(get("#warning-owner"), { props: { showUltraWarning: true, ultraWarningModel: warningModel } });
  }
  select("chatgpt-web/astra");
  return { host, get, props, effort, model, select };
}

test("Web Astra Pro presentation is exact-model scoped, reversible, and permission-neutral", () => {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "app://-/index.html", runScripts: "outside-only" });
  const { window } = dom;
  const f = fixture(window.document);
  window.eval(presentationSource);
  const sync = window.syncWebAstraProLabels;
  let selected = null;
  const onSelect = () => { selected = "high"; };
  f.get("#pro-option").addEventListener("click", onSelect);
  const permissionBefore = f.get("#permission-dialog").outerHTML;
  const warningBefore = f.get("#swarm-warning").outerHTML;
  sync();
  for (const selector of ["#trigger-effort", "#pro-option span", "#web-pro-test-tip span"]) assert.equal(f.get(selector).textContent, "Pro");
  assert.equal(f.get("#native-option .effort").textContent, "High");
  assert.equal(f.get("#swarm-warning").outerHTML, warningBefore);
  assert.equal(f.get("#unrelated").textContent, "High");
  assert.equal(f.get("#permission-dialog").outerHTML, permissionBefore);
  f.get("#pro-option").click();
  assert.equal(selected, "high");
  assert.equal(f.get("#web-pro-test-trigger").dataset.selectedReasoningEffort, "high");
  const applied = f.host.innerHTML;
  sync();
  assert.equal(f.host.innerHTML, applied, "idempotent without DOM churn");

  for (const native of ["gpt-6-astra", "chatgpt-web/astra-other", "cursor/grok-4.6"]) {
    f.select(native);
    sync();
    assert.equal(f.get("#trigger-effort").textContent, "High");
    assert.equal(f.get("#pro-option span").textContent, "High");
    assert.equal(f.get("#swarm-warning").hasAttribute("hidden"), false);
  }
  f.select("chatgpt-web/astra", "gpt-6-astra");
  sync();
  assert.equal(f.get("#trigger-effort").textContent, "Pro");
  assert.equal(f.get("#swarm-warning").hidden, false, "native turn warning has independent ownership");

  // Mixed-model slider labels have no safe selected-model fallback.
  f.get("#web-pro-test-menu").dataset.modelPickerView = "simple";
  const mixed = window.document.createElement("div");
  mixed.dataset.modelPickerView = "simple";
  f.get("#web-pro-test-menu").prepend(mixed);
  sync();
  assert.equal(f.get("#pro-option span").textContent, "High");
  f.props(f.get("#native-option .name"), f.model("chatgpt-web/astra"));
  sync();
  assert.equal(f.get("#native-option .effort").textContent, "Pro", "a mixed row with exact ownership can be relabeled");
  f.props(f.get("#native-option .name"), f.model("gpt-6-astra"));
  mixed.dataset.explicitModel = "true";
  sync();
  assert.equal(f.get("#pro-option span").textContent, "Pro");
  mixed.remove();

  // A React render supersedes our snapshot; never restore stale text over it.
  f.get("#trigger-effort").textContent = "Medium";
  f.props(f.get("#trigger-effort"), { props: { id: "composer.mode.local.reasoning.medium.label" } });
  sync();
  assert.equal(f.get("#trigger-effort").textContent, "Medium");
  f.get("#trigger-effort").textContent = "High";
  f.props(f.get("#trigger-effort"), f.effort);
  sync();
  assert.equal(f.get("#trigger-effort").textContent, "Pro");

  // Unsupported/ambiguous native props fail closed, independent of visible name.
  delete f.get("#model-label").__reactProps$fixture;
  sync();
  assert.equal(f.get("#trigger-effort").textContent, "High");
  f.props(f.get("#model-label"), [f.model("chatgpt-web/astra"), f.model("gpt-6-astra")]);
  sync();
  assert.equal(f.get("#trigger-effort").textContent, "High");
  f.select("chatgpt-web/astra");
  f.get("#native-option").remove();
  sync();
  assert.equal(f.get("#pro-option span").textContent, "Pro", "singleton high menu displays Pro");
  f.get("#trigger-effort").textContent = "Ultra";
  f.get("#web-pro-test-trigger").dataset.selectedReasoningEffort = "ultra";
  f.props(f.get("#trigger-effort"), { props: { id: "composer.mode.local.reasoning.ultra.label" } });
  sync();
  assert.equal(f.get("#trigger-effort").textContent, "Ultra", "Ultra is no longer aliased, even on Web Astra");
  f.get("#trigger-effort").textContent = "High";
  f.get("#web-pro-test-trigger").dataset.selectedReasoningEffort = "high";
  f.props(f.get("#trigger-effort"), f.effort);
  sync();
  sync(false);
  assert.equal(f.get("#trigger-effort").textContent, "High");
  assert.equal(f.get("#swarm-warning").hasAttribute("hidden"), false);
  assert.equal(f.get("#permission-dialog").outerHTML, permissionBefore);
  f.host.remove();
  sync();
  assert.equal(window.__codexWorkflowWebAstraProLabels.size, 0);
  dom.window.close();
});

test("preload bridge follows native composer and portal remounts without a mutation loop", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "app://-/index.html", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  const f = fixture(window.document);
  let calls = 0;
  window.require = (name) => {
    assert.equal(name, "electron");
    return {
      ipcRenderer: { invoke: async () => ({}), on() {}, send() {} },
      webFrame: { executeJavaScript: async (code) => { if (isNativeAssetsRead(code)) return nativeAssetsFixture; calls++; return window.eval(code); } },
    };
  };
  // Discovery, bridge writes and their observer follow-up run on animation frames.
  // Six actual frames preserve the old settling window even when the suite is busy.
  const settle = async () => {
    for (let frame = 0; frame < 6; frame++) await new Promise(resolve => window.requestAnimationFrame(resolve));
  };
  try {
    window.eval(source);
    await settle();
    assert.equal(f.get("#trigger-effort").textContent, "Pro");
    assert.equal(f.get("#pro-option span").textContent, "Pro");
    const before = calls;
    await settle();
    assert.equal(calls, before, "stable labels must not feed their observer indefinitely");
    const old = f.get("#pro-option span");
    const replacement = window.document.createElement("span");
    replacement.textContent = "High";
    f.props(replacement, f.effort);
    old.replaceWith(replacement);
    await settle();
    assert.equal(replacement.textContent, "Pro", "owned portal observer handles React remount");
    f.select("gpt-6-astra");
    f.get("#model-label").textContent = "Native Astra";
    await settle();
    assert.equal(f.get("#trigger-effort").textContent, "High");
    assert.equal(replacement.textContent, "High");
    f.host.remove();
    await settle();
    assert.equal(window.__codexWorkflowWebAstraProLabels.size, 0);
  } finally { dom.window.close(); }
});
