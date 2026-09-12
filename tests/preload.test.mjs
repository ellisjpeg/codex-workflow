import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import test from "node:test";
import { JSDOM } from "jsdom";

// Keep the archived feature regressions runnable while the starter owns runtime/.
const preloadSource = readFileSync(new URL("../parked/workflow-before-starter/preload.cjs", import.meta.url), "utf8");
const starterSource = readFileSync(new URL("../runtime/preload.cjs", import.meta.url), "utf8");

async function conversationHarness(options = {}) {
  const h = await createHarness({source:starterSource,...options});
  const thread = h.document.createElement('div');
  thread.className = 'thread-scroll-container'; thread.setAttribute('data-app-action-timeline-scroll','');
  thread.innerHTML = `<div data-thread-user-message-navigation-content="true" class="max-w-(--thread-content-max-width)" style="color: red !important"><div data-thread-find-target="conversation"><div data-content-search-turn-key="turn-1"><div data-local-conversation-user-anchor="true" data-content-search-unit-key="user-1"><div class="group"><div data-user-message-bubble="true">Prompt</div><div><div class="opacity-0"><span class="opacity-0">10:24</span><div class="turn-action-controls"><button>Copy message</button></div></div></div></div></div><div style="height:var(--conversation-item-gap, 16px)"></div><div><button class="max-w-full text-size-chat" aria-expanded="false"><span>Worked for 1s</span><svg class="icon-2xs"></svg></button><div data-native-activity hidden>Tool output</div></div><div data-local-conversation-final-assistant="true" data-content-search-unit-key="assistant-1"><div data-markdown-text-style="assistant-message">Answer</div><span data-assistant-message-sent-time="true" class="opacity-0">10:25</span></div></div></div></div>`;
  h.document.body.append(thread);
  const root = thread.firstElementChild;
  const button = root.querySelector('button[aria-expanded]');
  let clicks = 0;
  button.addEventListener('click',()=>{clicks++;button.setAttribute('aria-expanded',String(button.getAttribute('aria-expanded')!=='true'));root.querySelector('[data-native-activity]').hidden=button.getAttribute('aria-expanded')!=='true';});
  h.document.querySelector('[data-codex-workflow="nav-item"]').click();
  h.document.querySelector('[data-codex-workflow-section=conversation]').click();
  await flush();
  // The settings write triggers discovery just as the native route/composer mount does.
  h.emitMutation(h.document.body,{addedNodes:[thread]});
  h.document.querySelector('[data-settings-panel-slug=general-settings]').click();
  h.document.querySelector('[data-codex-workflow="nav-item"]').click();
  await flush();
  return {...h,thread,root,button,clicks:()=>clicks,choose:async(key,value)=>{
    h.document.querySelector(`[aria-labelledby="codex-workflow-${key}-label"]`).click();
    const item=[...h.document.querySelectorAll('[role=menuitemradio]')].find(n=>n.textContent===value);
    assert.ok(item,value);item.click();await flush();
  }};
}

test('Conversation preview and five settings use native tokens, preserve content and reset only their section',async()=>{
  const h=await conversationHarness({initialSettings:{showUsageRemaining:false,composerWidth:'wide'}});
  try {
    const panel=h.document.querySelector('[data-codex-workflow-panel]');
    assert.match(panel.textContent,/Make the sidebar more compact\./);
    assert.match(panel.textContent,/Updated the spacing and kept the labels readable\./);
    assert.doesNotMatch(panel.textContent,/Changes apply|Collapse long code/);
    const range=panel.querySelector('input[type=range]');
    range.value='880';range.dispatchEvent(new h.window.Event('input'));range.dispatchEvent(new h.window.Event('change'));await flush();
    [...panel.querySelectorAll('button')].find(n=>n.textContent==='Relaxed').click();await flush();
    await h.choose('userMessageStyle','Plain text');
    await h.choose('toolActivity','Expanded');
    panel.querySelector('[aria-labelledby=codex-workflow-showMessageTimestamps-label]').click();await flush();
    assert.equal(h.button.getAttribute('aria-expanded'),'true');
    const css=h.document.querySelector('[data-codex-workflow-conversation-style]').textContent;
    assert.match(css,/min\(880px/);assert.match(css,/--conversation-item-gap: calc\(var\(--spacing\) \* 6\)/);
    assert.match(css,/background: transparent/);assert.match(css,/--color-text-user-message: var\(--color-text\)/);assert.match(css,/data-assistant-message-sent-time/);
    assert.equal(h.root.querySelector('[data-user-message-bubble]').textContent,'Prompt');
    assert.equal(h.root.style.cssText,'color: red !important;');
    assert.equal(panel.querySelectorAll('time').length,2);
    const [userTime, assistantTime] = panel.querySelectorAll('time');
    assert.equal(userTime.parentElement.firstElementChild.classList.contains('w-full'), false);
    assert.equal(assistantTime.parentElement.lastElementChild, assistantTime);
    assert.equal(assistantTime.previousElementSibling.querySelector('[aria-controls]').getAttribute('aria-expanded'), 'true');
    assert.doesNotMatch(css, /padding: 0; max-width: 100%; width: 100%/);
    assert.match(css, /interpolate-size: allow-keywords/);
    assert.match(css, /inline-size: 0; opacity: 0; pointer-events: none/);
    for(const n of panel.querySelectorAll('[aria-labelledby],[aria-describedby],[aria-controls]'))for(const a of ['aria-labelledby','aria-describedby','aria-controls'])for(const id of (n.getAttribute(a)||'').split(' ').filter(Boolean))assert.equal(h.document.querySelectorAll(`[id="${id}"]`).length,1);
    [...panel.querySelectorAll('button')].find(n=>n.textContent==='Reset this section').click();await flush();
    assert.equal(h.document.querySelector('[data-codex-workflow-conversation-style]'),null);
    assert.equal(h.button.getAttribute('aria-expanded'),'false');
    assert.equal(panel.querySelectorAll('time').length,0);
    [...panel.querySelectorAll('button')].find(n=>n.textContent==='Workflow').click();
    h.document.querySelector('[data-codex-workflow-section=composer]').click();
    assert.equal([...h.document.querySelectorAll('[data-codex-workflow-panel] button')].find(n=>n.textContent==='Wide').getAttribute('aria-pressed'),'true');
  }finally{h.dom.window.close();}
});

test('Conversation activity preserves manual disclosure choices and fails closed on ambiguous targets',async()=>{
  const h=await conversationHarness();
  try {
    await h.choose('toolActivity','Expanded');
    h.button.click();assert.equal(h.button.getAttribute('aria-expanded'),'false');
    const before=h.clicks();h.emitMutation(h.root,{addedNodes:[h.button]});await flush();
    assert.equal(h.clicks(),before,'background work must not override manual collapse');
    const lookalike=h.button.cloneNode(true);h.button.parentElement.append(lookalike);
    await h.choose('toolActivity','Summary');await h.choose('toolActivity','Expanded');
    assert.equal(h.button.getAttribute('aria-expanded'),'false','ambiguous activity is not toggled');
    lookalike.remove();
    const duplicate=h.thread.cloneNode(true);h.document.body.append(duplicate);
    await h.choose('userMessageStyle','Plain text');
    assert.equal(h.document.querySelectorAll('[data-codex-workflow-conversation]').length,0);
    duplicate.remove();
    await h.choose('userMessageStyle','Bubble');
    assert.equal(h.document.querySelectorAll('[data-codex-workflow-conversation]').length,1);
  }finally{h.dom.window.close();}
});

test('Conversation failed save restores manual activity, preview and controls without concurrent writes',async()=>{
  let reject;
  const h=await conversationHarness({setSettings:()=>new Promise((_r,j)=>{reject=j;})});
  try {
    // Native manual expansion before changing the preference must survive a failed save.
    h.button.click();
    const panel=h.document.querySelector('[data-codex-workflow-panel]');
    const switchButton=panel.querySelector('[aria-labelledby=codex-workflow-showMessageTimestamps-label]');
    switchButton.click();assert.equal(switchButton.disabled,true);
    switchButton.click();assert.equal(h.invokedChannels.filter(x=>x.endsWith(':set')).length,1);
    reject(Error('disk full'));await flush();
    assert.equal(switchButton.getAttribute('aria-checked'),'false');
    assert.equal(switchButton.disabled,false);assert.match(panel.textContent,/Couldn’t save/);
    assert.equal(h.button.getAttribute('aria-expanded'),'true');
    assert.equal(panel.querySelectorAll('time').length,0);
  }finally{h.dom.window.close();}
});

test('Conversation master switch restores native state and a failed disable preserves manual disclosure',async()=>{
  let failure=false;
  let settings={schemaVersion:4,focusedInterface:true,toolActivity:'expanded',showMessageTimestamps:true};
  const h=await conversationHarness({initialSettings:settings,setSettings:async patch=>{if(failure)throw Error('disk full');settings={...settings,...patch};return settings;}});
  try {
    // Apply through a real settings update, then deliberately collapse the native disclosure.
    await h.choose('userMessageStyle','Plain text');h.button.click();
    const back=[...h.document.querySelectorAll('[data-codex-workflow-panel] button')].find(n=>n.textContent==='Workflow');back.click();
    const master=h.document.querySelector('[aria-labelledby=codex-workflow-focusedInterface-label]');
    failure=true;master.click();await flush();
    assert.equal(master.getAttribute('aria-checked'),'true');
    assert.equal(h.button.getAttribute('aria-expanded'),'false','failed master write preserves the manual collapse');
    failure=false;master.click();await flush();
    assert.equal(master.getAttribute('aria-checked'),'false');
    assert.equal(h.root.hasAttribute('data-codex-workflow-conversation'),false);
    assert.equal(h.document.querySelector('[data-codex-workflow-conversation-style]'),null);
    assert.equal(h.button.getAttribute('aria-expanded'),'false');
  }finally{h.dom.window.close();}
});

async function composerHarness(options = {}) {
  const h = await createHarness({source:starterSource, ...options});
  const old = h.document.querySelector('[role=presentation][data-composer-layout]');
  const column = h.document.createElement('div');
  column.className = 'thread-scroll-container';
  column.setAttribute('data-app-action-timeline-scroll','');
  column.style.setProperty('--thread-content-max-width','48rem','important');
  column.innerHTML = `<div role="presentation" data-composer-layout="multiline"><div data-composer-attachments>PRIVATE ATTACHMENT</div><div contenteditable="true" id="draft" data-codex-composer="true">PRIVATE DRAFT</div><div data-composer-rows="stacked"><button data-codex-intelligence-trigger="true" data-composer-navigation-target="reasoning" data-selected-reasoning-effort="medium" id="picker"><span class="_ModelPickerTriggerModelText_90m7w_41">GPT-6 Astra</span><span class="_ModelPickerTriggerEffortLabel_90m7w_53">Medium</span></button><button aria-label="Dictate" aria-describedby="draft">Mic</button><button aria-label="Send">Send</button></div></div>`;
  old.replaceWith(column);
  h.emitMutation(h.document.body,{addedNodes:[column],removedNodes:[old]});
  h.document.querySelector('[data-codex-workflow="nav-item"]').click();
  h.document.querySelector('[data-codex-workflow-section="composer"]').click();
  await flush();
  return {...h,column,choose:async(key,value)=>{
    h.document.querySelector(`[aria-labelledby="codex-workflow-${key}-label"]`).click();
    const item=[...h.document.querySelectorAll('[role=menuitemradio]')].find(n=>n.textContent.includes(value));
    assert.ok(item, value); item.click(); await flush();
  }};
}

test('Composer page clones native controls safely, saves labels and resets only its section', async () => {
  const h=await composerHarness({initialSettings:{showUsageRemaining:false}});
  try {
    const panel=h.document.querySelector('[data-codex-workflow-panel]');
    assert.doesNotMatch(panel.textContent,/Attachment button|Usage placement|Changes apply|PRIVATE/);
    const back=[...panel.querySelectorAll('button')].find(n=>n.textContent==='Workflow');
    assert.equal(back.classList.contains('bg-text/5'),false);
    assert.equal(back.classList.contains('enabled:hover:bg-primary-ghost-hover'),true);
    const preview=panel.querySelector('[data-codex-workflow-preview]');
    assert.equal(preview.firstElementChild.inert,true);
    assert.equal(preview.querySelector('[contenteditable]').getAttribute('contenteditable'),'false');
    assert.equal(preview.querySelectorAll('[id], [aria-describedby], [data-codex-composer]').length,0);
    assert.equal(h.column.querySelector('#draft').textContent,'PRIVATE DRAFT');
    const mic=panel.querySelector('[role=switch]');
    assert.equal(mic.getAttribute('aria-checked'),'true');
    mic.click(); await flush();
    assert.equal(mic.getAttribute('aria-checked'),'false');
    assert.equal(h.column.querySelector('[aria-label=Dictate]').style.display,'none');
    assert.equal(preview.querySelector('[aria-label=Dictate]').style.display,'none');
    await h.choose('composerModelLabel','Short name');
    await h.choose('composerReasoningLabel','Compact');
    assert.equal(h.column.querySelector('._ModelPickerTriggerModelText_90m7w_41').textContent,'Astra');
    assert.equal(h.column.querySelector('._ModelPickerTriggerEffortLabel_90m7w_53').textContent,'Med');
    assert.match(preview.getAttribute('aria-label'),/Astra\. Med\./);
    [...panel.querySelectorAll('button')].find(n=>n.textContent==='Wide').click(); await flush();
    assert.equal(h.column.style.getPropertyValue('--thread-content-max-width'),'calc(100% - 2 * var(--thread-wide-block-inline-shift, 0px))');
    [...panel.querySelectorAll('button')].find(n=>n.textContent==='Reset this section').click(); await flush();
    assert.equal(h.column.style.getPropertyValue('--thread-content-max-width'),'48rem');
    assert.equal(h.column.style.getPropertyPriority('--thread-content-max-width'),'important');
    assert.equal(h.column.querySelector('._ModelPickerTriggerModelText_90m7w_41').textContent,'GPT-6 Astra');
    assert.equal(h.column.querySelector('._ModelPickerTriggerEffortLabel_90m7w_53').textContent,'Medium');
    assert.equal(mic.getAttribute('aria-checked'),'true');
    h.document.querySelector('[data-settings-panel-slug=general-settings]').click();
    h.document.querySelector('[data-codex-workflow="nav-item"]').click();
    [...h.document.querySelectorAll('[data-codex-workflow-panel] button')].find(n=>n.textContent==='Workflow')?.click();
    h.document.querySelector('[data-codex-workflow-section=usage]').click();
    assert.equal(h.document.querySelector('[aria-labelledby=codex-workflow-showUsageRemaining-label]').getAttribute('aria-checked'),'false');
  } finally {h.dom.window.close();}
});

test('Composer label/width failure rolls back preview and real controls, rejecting concurrent writes', async () => {
  let reject;
  const h=await composerHarness({setSettings:()=>new Promise((_r,j)=>{reject=j;})});
  try {
    const panel=h.document.querySelector('[data-codex-workflow-panel]');
    const wide=[...panel.querySelectorAll('button')].find(n=>n.textContent==='Wide');
    wide.click();
    assert.equal(h.column.style.getPropertyValue('--thread-content-max-width'),'calc(100% - 2 * var(--thread-wide-block-inline-shift, 0px))');
    assert.equal(wide.disabled,true); wide.click();
    assert.equal(h.invokedChannels.filter(n=>n.endsWith(':set')).length,1);
    reject(Error('disk full')); await flush();
    assert.equal(h.column.style.getPropertyValue('--thread-content-max-width'),'48rem');
    assert.match(panel.querySelector('[data-codex-workflow-preview]').getAttribute('aria-label'),/Default width/);
    assert.match(panel.textContent,/Couldn’t save/);
    assert.equal(wide.disabled,false);
    const choice=h.choose('composerReasoningLabel','Compact'); await flush();
    assert.equal(h.column.querySelector('._ModelPickerTriggerEffortLabel_90m7w_53').textContent,'Med');
    reject(Error('disk full')); await choice; await flush();
    assert.equal(h.column.querySelector('._ModelPickerTriggerEffortLabel_90m7w_53').textContent,'Medium');
  } finally {h.dom.window.close();}
});

test('Composer presentation survives native text updates, ambiguity, remounts and settings navigation', async () => {
  const h=await composerHarness({initialSettings:{composerModelLabel:'short',composerReasoningLabel:'compact',composerWidth:'wide'}});
  try {
    const root=h.column.firstElementChild;
    const model=root.querySelector('._ModelPickerTriggerModelText_90m7w_41');
    model.firstChild.data='GPT-5.6 Sol';
    h.emitMutation(model); await flush();
    assert.equal(model.textContent,'Sol');
    const duplicate=root.querySelector('#picker').cloneNode(true);
    root.append(duplicate); h.emitMutation(root,{addedNodes:[duplicate]}); await flush();
    assert.equal(model.textContent,'GPT-5.6 Sol');
    duplicate.remove(); h.emitMutation(root,{removedNodes:[duplicate]}); await flush();
    assert.equal(model.textContent,'Sol');
    const replacement=root.cloneNode(true);
    replacement.querySelector('._ModelPickerTriggerModelText_90m7w_41').textContent='GPT-6 Astra';
    root.replaceWith(replacement); h.emitMutation(h.column,{addedNodes:[replacement],removedNodes:[root]}); await flush();
    assert.equal(replacement.querySelector('._ModelPickerTriggerModelText_90m7w_41').textContent,'Astra');
    assert.equal(h.column.style.getPropertyValue('--thread-content-max-width'),'calc(100% - 2 * var(--thread-wide-block-inline-shift, 0px))');
    h.document.querySelector('[data-settings-panel-slug=general-settings]').click();
    assert.equal(h.document.querySelectorAll('[data-codex-workflow-preview]').length,0);
    assert.equal(h.document.querySelectorAll('[data-codex-workflow-panel]').length,0);
  } finally {h.dom.window.close();}
});

test('Composer preview retains a complete editor across partial native unmounts and cold Settings entry', async () => {
  const h=await composerHarness();
  try {
    h.document.querySelector('[data-settings-panel-slug=general-settings]').click();
    const editor=h.column.querySelector('[contenteditable]');
    editor.remove();h.emitMutation(h.column.firstElementChild,{removedNodes:[editor]});await flush();
    h.document.querySelector('[data-codex-workflow="nav-item"]').click();
    const back=[...h.document.querySelectorAll('[data-codex-workflow-panel] button')].find(n=>n.textContent==='Workflow');
    back?.click();
    h.document.querySelector('[data-codex-workflow-section=composer]').click();
    assert.ok(h.document.querySelector('[data-codex-workflow-preview] [contenteditable="false"]'));
    assert.match(h.document.querySelector('[data-codex-workflow-preview]').getAttribute('aria-label'),/GPT-6 Astra/);
  } finally {h.dom.window.close();}
  const cold=await createHarness({source:starterSource});
  try {
    cold.document.querySelector('[data-codex-workflow="nav-item"]').click();
    cold.document.querySelector('[data-codex-workflow-section=composer]').click();
    const preview=cold.document.querySelector('[data-codex-workflow-preview]');
    assert.ok(preview.querySelector('[contenteditable="false"]'));
    assert.equal(preview.querySelectorAll('[id]').length,0);
    assert.match(preview.getAttribute('aria-label'),/GPT-6 Astra/);
  } finally {cold.dom.window.close();}
});

test("all active Workflow switches use the native blue track, including refreshed recent-chat controls", async () => {
  const h = await createHarness({source:starterSource});
  try {
    h.document.querySelector('[data-codex-workflow="nav-item"]').click();
    const check = button => {
      assert.equal(button.firstElementChild.classList.contains('bg-chart-blue'), true);
      assert.equal(button.firstElementChild.classList.contains('bg-chart-red'), false);
      assert.equal(button.firstElementChild.getAttribute('aria-hidden'), 'true');
      assert.equal(button.getAttribute('aria-checked'), 'true');
    };
    check(h.document.querySelector('[aria-labelledby="codex-workflow-focusedInterface-label"]'));
    const filter = h.document.querySelector('[aria-labelledby="codex-workflow-changed-label"]');
    filter.click(); check(filter); filter.click();
    h.document.querySelector('[data-codex-workflow-section="sidebar"]').click();
    const recent = h.document.querySelector('[data-codex-workflow-recent-switch]');
    check(recent); recent.click(); await flush();
    assert.equal(recent.firstElementChild.classList.contains('bg-text/10'), true);
    recent.click(); await flush(); check(recent);
  } finally { h.dom.window.close(); }
});

test("Workflow homepage exposes integrated sections and preserves unrelated navigation", async () => {
  const h = await createHarness({ source: starterSource, nativeSidebar: true,
    initialSettings: { focusedInterface: true, hideComposerMicrophone: true, hiddenSettingsPages: ["appearance"] } });
  try {
    h.document.querySelector('[data-codex-workflow="nav-item"]').click();
    const panel = h.document.querySelector("[data-codex-workflow-panel]");
    assert.ok(panel);
    assert.equal(panel.querySelectorAll("[data-codex-workflow-section]").length, 5);
    assert.equal(panel.querySelectorAll("[role=switch]").length, 2);
    assert.doesNotMatch(panel.textContent, /Active setup|Make Codex yours|Save as|Customise interface|Import setup|Export setup|Focused Interface|Hide microphone/iu);
    for (const row of panel.querySelectorAll("[data-codex-workflow-section]")) {
      assert.equal(row.disabled, false);
      const available = ["sidebar", "composer", "conversation", "usage"].includes(row.dataset.codexWorkflowSection);
      assert.equal(row.getAttribute("aria-disabled"), available ? null : "true");
      row.focus();
      assert.equal(h.document.activeElement, row);
      if (!available) row.click();
      assert.equal(h.document.querySelector("[data-codex-workflow-panel]"), panel);
      assert.equal(row.classList.contains("enabled:hover:bg-text/5"), true);
    }
    assert.equal(h.document.querySelector("#pull-requests").style.display, "block");
    assert.equal(h.document.querySelector("#composer-dictate").style.display, "none");
    assert.notEqual(h.document.querySelector('[data-settings-panel-slug="appearance"]').style.display, "none");
    assert.ok(!h.document.querySelector("[data-codex-workflow-settings-visibility]"));
    const ids = [...h.document.querySelectorAll("[id]")].map((node) => node.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const control of panel.querySelectorAll("[aria-labelledby], [aria-describedby]")) {
      for (const attr of ["aria-labelledby", "aria-describedby"]) {
        for (const id of (control.getAttribute(attr) || "").split(" ").filter(Boolean)) assert.ok(h.document.getElementById(id));
      }
    }
  } finally { h.dom.window.close(); }
});

test("Workflow update control uses the guarded handoff and exposes a failed handoff", async () => {
  for (const applying of [true, false]) {
    const h = await createHarness({source:starterSource, updateStatus:{available:true}, installUpdateResult:{applying}});
    try {
      h.document.querySelector('[data-codex-workflow="nav-item"]').click();
      const button = h.document.querySelector('[data-codex-workflow="update"]');
      assert.equal(button.hidden, false);
      button.click(); await flush();
      assert.equal(h.invokedChannels.filter(channel => channel === "codex-workflow:update:install").length, 1);
      assert.equal(button.disabled, applying);
      if (!applying) assert.match(h.document.querySelector('[data-codex-workflow-panel]').textContent, /Couldn’t update Workflow/);
    } finally { h.dom.window.close(); }
  }
});

test("starter search, changed-only view and reset respond without fictitious change counts", async () => {
  const h = await createHarness({ source: starterSource, initialSettings: { focusedInterface: false } });
  try {
    h.document.querySelector('[data-codex-workflow="nav-item"]').click();
    const panel = h.document.querySelector("[data-codex-workflow-panel]");
    const search = panel.querySelector("input");
    search.value = "  COMPOSER ";
    search.dispatchEvent(new h.window.Event("input", { bubbles: true }));
    assert.deepEqual([...panel.querySelectorAll("[data-codex-workflow-section]")].filter((row) => !row.hidden).map((row) => row.dataset.codexWorkflowSection), ["composer"]);
    assert.equal(panel.querySelector('[data-codex-workflow="sections"]').children.length, 1);
    panel.querySelector('[data-codex-workflow="search-clear"]').click();
    assert.equal(search.value, "");
    assert.equal(panel.querySelector('[data-codex-workflow="sections"]').children.length, 5);
    search.value = "not a section";
    search.dispatchEvent(new h.window.Event("input", { bubbles: true }));
    assert.equal(panel.querySelector('[data-codex-workflow="empty"]').textContent, "No matching customisations.");
    search.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(search.value, "");
    const filter = panel.querySelector('[aria-labelledby="codex-workflow-changed-label"]');
    const writesBefore = h.invokedChannels.filter((channel) => channel.endsWith(":set")).length;
    filter.click();
    assert.equal(filter.getAttribute("aria-checked"), "true");
    assert.equal(panel.querySelector('[data-codex-workflow="sections"]').hidden, true);
    assert.equal(panel.querySelector('[data-codex-workflow="empty"]').textContent, "No changed customisations.");
    assert.equal(h.invokedChannels.filter((channel) => channel.endsWith(":set")).length, writesBefore);
    panel.querySelector('[data-codex-workflow="reset"]').click();
    await flush();
    assert.equal(filter.getAttribute("aria-checked"), "false");
    assert.equal(panel.querySelector('[aria-labelledby="codex-workflow-focusedInterface-label"]').getAttribute("aria-checked"), "true");
    assert.equal(panel.querySelector('[data-codex-workflow="sections"]').hidden, false);
  } finally { h.dom.window.close(); }
});

test("starter saves the master preference, blocks concurrent writes and visibly rolls back failures", async () => {
  let rejectWrite;
  let writes = 0;
  const h = await createHarness({ source: starterSource, setSettings: () => {
    writes += 1;
    return new Promise((_resolve, reject) => { rejectWrite = reject; });
  } });
  try {
    h.document.querySelector('[data-codex-workflow="nav-item"]').click();
    const master = h.document.querySelector('[aria-labelledby="codex-workflow-focusedInterface-label"]');
    master.focus();
    master.click();
    assert.equal(master.getAttribute("aria-checked"), "false");
    assert.equal(master.disabled, true);
    master.click();
    assert.equal(writes, 1);
    master.blur();
    rejectWrite(new Error("disk full"));
    await flush();
    assert.equal(master.getAttribute("aria-checked"), "true");
    assert.equal(master.disabled, false);
    assert.equal(h.document.activeElement, master);
    assert.match(h.document.querySelector("[data-codex-workflow-panel]").textContent, /Couldn’t save changes/u);
    assert.equal(master.firstElementChild.classList.contains("bg-chart-blue"), true);
  } finally { h.dom.window.close(); }
});

test("starter restores native styles, supports reopening and ignores conversation mutations", async () => {
  const h = await createHarness({ source: starterSource, realObservers: true, nativeSidebar: true });
  try {
    const native = h.document.querySelector("#native-panel");
    native.style.setProperty("display", "grid", "important");
    h.document.querySelector('[data-codex-workflow="nav-item"]').click();
    assert.equal(native.style.display, "none");
    assert.equal(h.document.querySelectorAll('[aria-current="page"]').length, 1);
    h.document.querySelector('[data-settings-panel-slug="appearance"]').click();
    assert.equal(native.style.display, "grid");
    assert.equal(native.style.getPropertyPriority("display"), "important");
    assert.equal(native.inert, false);
    assert.equal(h.document.querySelector("[data-codex-workflow-panel]"), null);
    h.document.querySelector('[data-codex-workflow="nav-item"]').click();
    await flush();
    const ownedCount = () => h.document.querySelectorAll('[data-codex-workflow="nav-item"]').length;
    h.document.querySelector("#response-stream").textContent = "Unrelated response";
    await flush();
    assert.equal(ownedCount(), 1);
    assert.equal(h.document.querySelectorAll("[data-codex-workflow-panel]").length, 1);
    assert.ok(!h.observers.some((observer) => observer.active && observer.target === h.document.documentElement && observer.options.subtree));
    h.window.history.pushState({}, "", "#conversation-test");
    assert.equal(h.document.querySelector("[data-codex-workflow-panel]"), null);
  } finally { h.dom.window.close(); }
});


async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

test("navigation hides and reorders native rows before paint, preserves New chat and reverses on disable", async () => {
  const h = await createHarness({source:starterSource, realObservers:true, nativeSidebar:true, updateStatus:{available:false, installedVersion:"0.5.26"}});
  try {
    const aside = h.document.querySelector("aside");
    aside.innerHTML = `<div id="app-shell-sidebar"><nav><button class="sidebar-item"><span class="text-fade-truncate">New chat</span></button>
      <div data-app-action-sidebar-scroll><div><div class="flex flex-col">
      <div class="flex flex-col"><div class="contents"><button class="sidebar-item"><span class="text-fade-truncate">Pull requests</span></button></div>
      <div class="contents"><button class="sidebar-item"><span class="text-fade-truncate">Scheduled</span></button></div>
      <div class="contents"><button class="sidebar-item"><span class="text-fade-truncate">Plugins</span></button></div></div>
      <button class="sidebar-item"><span class="text-fade-truncate">Explore</span></button></div></div>
      <section data-app-action-sidebar-section-heading="Recents"><h2>Recents</h2><button>Fixture chat</button></section>
      </div></nav></div>`;
    h.window.dispatchEvent(new h.window.Event("resize")); await flush();
    h.document.querySelector('[data-codex-workflow="nav-item"]').click();
    h.document.querySelector('[data-codex-workflow-section="sidebar"]').click();
    const page = () => h.document.querySelector('[data-codex-workflow-panel]');
    assert.match(page().textContent, /Sidebar & navigation/);
    assert.equal(page().querySelector('[data-codex-workflow-version]').textContent, "v0.5.26");
    assert.ok(page().querySelector('[data-codex-workflow-version]').classList.contains("text-secondary"));
    for (const label of ["App sidebar", "Settings navigation", "Account menu", "App sidebar"]) {
      [...page().querySelectorAll('[aria-label="Navigation area"] button')].find(button => button.textContent === label).click();
      const tabs = [...page().querySelectorAll('[aria-label="Navigation area"] button')];
      assert.equal(tabs.filter(button => button.getAttribute("aria-pressed") === "true").length, 1);
      for (const button of tabs) {
        assert.ok(button.classList.contains(button.textContent === label
          ? "enabled:hover:bg-segmented-selected-hover" : "enabled:hover:bg-primary-ghost-hover"));
        assert.equal(button.classList.contains("bg-segmented-selected"), button.textContent === label);
        assert.ok(button.classList.contains("focus-visible:ring-2"));
        assert.equal(button.classList.contains("bg-surface-secondary"), false);
        assert.equal(button.classList.contains("text-default"), button.textContent === label);
      }
    }
    assert.doesNotMatch(page().textContent, /Show task previews|Changes apply to/);
    assert.equal(page().querySelector('[data-workflow-navigation-item="new-chat"] button').disabled, true);
    assert.equal(page().querySelector('[data-workflow-navigation-item="new-chat"] [aria-pressed]'), null);
    page().querySelector('[aria-label="Hide Pull requests"]').click(); await flush();
    const pull = () => aside.querySelector('[data-workflow-native-nav="pull-requests"]');
    assert.equal(h.window.getComputedStyle(pull()).display, "none");
    pull().style.setProperty("display", "block");
    assert.equal(h.window.getComputedStyle(pull()).display, "none");
    const old = pull(); old.replaceWith(old.cloneNode(true)); await flush();
    assert.equal(h.window.getComputedStyle(pull()).display, "none");
    page().querySelector('[data-workflow-navigation-item="plugins"] button').dispatchEvent(new h.window.KeyboardEvent("keydown", {key:"ArrowUp", bubbles:true})); await flush();
    assert.equal(h.window.getComputedStyle(aside.querySelector('[data-workflow-native-nav="plugins"]')).order, "2");
    page().querySelector('[data-codex-workflow-recent-switch]').click(); await flush();
    const recents = aside.querySelector('section');
    assert.equal(h.window.getComputedStyle(recents).display, "none");
    assert.equal(page().querySelector('[data-codex-workflow-recent-switch]').getAttribute('aria-checked'), 'false');
    page().querySelector('button').click();
    page().querySelector('[aria-labelledby="codex-workflow-focusedInterface-label"]').click(); await flush();
    assert.notEqual(h.window.getComputedStyle(recents).display,"none");
    assert.notEqual(h.window.getComputedStyle(pull()).display,"none");
  } finally { h.dom.window.close(); }
});

test("navigation pointer sorting previews, cancels, settles and rolls failed saves back", async () => {
  let reject = false;
  const h = await createHarness({source:starterSource, setSettings: patch => reject
    ? Promise.reject(new Error("disk full")) : Promise.resolve({focusedInterface:true, ...patch})});
  try {
    h.document.querySelector('[data-codex-workflow="nav-item"]').click();
    h.document.querySelector('[data-codex-workflow-section="sidebar"]').click();
    const card = h.document.querySelector('[data-codex-workflow-navigation-rows]');
    assert.equal(card.previousElementSibling.querySelector('h2').textContent, 'Navigation items');
    let captured = null;
    for (const target of [card, ...card.querySelectorAll('button')]) {
      target.setPointerCapture = () => { captured = target; };
      target.hasPointerCapture = () => captured === target;
      target.releasePointerCapture = () => { captured = null; };
    }
    const insertBefore = card.insertBefore.bind(card);
    card.insertBefore = (node, reference) => {
      const losesCapture = captured && node.contains(captured);
      const result = insertBefore(node, reference);
      if (losesCapture) {
        const target = captured; captured = null;
        target.dispatchEvent(new h.window.Event('lostpointercapture', {bubbles:true}));
      }
      return result;
    };
    let reduced = false;
    h.window.matchMedia = () => ({matches:reduced});
    const animations = [];
    for (const row of card.children) {
      row.getBoundingClientRect = () => {
        const offset = Number(/translateY\(([-.\d]+)px\)/.exec(row.style.transform)?.[1] || 0);
        const top = [...card.children].indexOf(row) * 48 + offset;
        return {top, bottom:top + 48, height:48, width:600, left:0, right:600};
      };
      row.animate = (frames, options) => { animations.push({frames, options}); return {}; };
    }
    const order = () => [...card.children].map(row => row.dataset.workflowNavigationItem);
    const original = order();
    const handle = card.querySelector('[data-workflow-navigation-item="plugins"] button');
    const pointer = (type, y) => (captured || handle).dispatchEvent(new h.window.MouseEvent(type, {button:0, clientY:y, bubbles:true}));
    pointer('pointerdown', 150); pointer('pointermove', 55);
    assert.equal(order()[1], 'plugins');
    assert.equal(h.invokedChannels.filter(channel => channel.endsWith(':settings:set')).length, 0);
    h.document.dispatchEvent(new h.window.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
    assert.deepEqual(order(), original);
    pointer('pointerdown', 150); pointer('pointermove', 55); pointer('pointerup', 55); await flush();
    assert.equal(order()[1], 'plugins');
    assert.equal(card.querySelector('[data-workflow-navigation-item="plugins"] button'), handle);
    assert.ok(animations.some(({options}) => options.duration === 200 && options.easing === 'ease'));
    assert.ok(animations.some(({options}) => options.duration === 250));
    const saved = order();
    reject = true; reduced = true; animations.length = 0;
    pointer('pointerdown', 55); pointer('pointermove', 150); pointer('pointerup', 150); await flush();
    assert.deepEqual(order(), saved);
    assert.equal(animations.length, 0);
    assert.match(h.document.querySelector('[role="status"]').textContent, /Couldn’t save/);
    assert.equal(card.firstElementChild.dataset.workflowNavigationItem, 'new-chat');
    reject = false; reduced = false; h.document.documentElement.dataset.reducedMotion = 'true';
    pointer('pointerdown', 55); pointer('pointermove', 150); pointer('pointerup', 150); await flush();
    assert.equal(animations.length, 0, 'native Reduce motion On overrides the system preference');
  } finally { h.dom.window.close(); }
});

test("sidebar width displays its unit inside the field and rolls a failed native write back", async () => {
  const requests = [];
  const h = await createHarness({source:starterSource, sidebarWidth: request => {
    requests.push(request);
    return request.action === 'get' ? Promise.resolve(317) : Promise.reject(new Error('native write failed'));
  }});
  try {
    h.document.querySelector('[data-codex-workflow="nav-item"]').click();
    h.document.querySelector('[data-codex-workflow-section="sidebar"]').click(); await flush();
    const input = h.document.querySelector('input[aria-label="Sidebar width"]');
    assert.equal(input.value, '317');
    assert.equal(input.parentElement.textContent, 'px');
    input.value = '521'; input.dispatchEvent(new h.window.Event('change')); await flush();
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.equal(requests.length, 1);
    input.value = '350'; input.dispatchEvent(new h.window.Event('change')); await flush();
    assert.equal(input.value, '317');
    assert.equal(input.disabled, false);
    assert.match(h.document.querySelector('[role="status"]').textContent, /Couldn’t resize/);
  } finally { h.dom.window.close(); }
});

test("settings visibility applies before frames in fixed and floating sidebar mounts", async () => {
  const h = await createHarness({source:starterSource, nativeSidebar:true,
    initialSettings:{schemaVersion:4, sidebarNavigation:{settingsHidden:['voice']}}});
  try {
    const nav = h.document.querySelector('nav[aria-label="Settings"]');
    const owner = nav.parentElement;
    const voice = nav.querySelector('[data-settings-panel-slug="voice"]');
    const display = () => h.window.getComputedStyle(voice).display;
    assert.equal(display(), 'none');
    // Native floating panels wrap the nav and do not carry the fixed-panel class.
    owner.className = '';
    owner.dataset.testid = 'app-shell-floating-left-panel';
    const wrapper = h.document.createElement('div');
    owner.append(wrapper); wrapper.append(nav);
    assert.equal(display(), 'none');
    voice.style.display = 'flex';
    owner.hidden = true; owner.hidden = false;
    assert.equal(display(), 'none');
    assert.notEqual(h.window.getComputedStyle(nav.querySelector('[data-settings-panel-slug="appearance"]')).display, 'none');
    owner.className = 'app-shell-left-panel';
    delete owner.dataset.testid;
    assert.equal(display(), 'none');
    owner.setAttribute('role', 'dialog');
    assert.equal(display(), 'flex');
    owner.removeAttribute('role');
    h.document.querySelector('[data-codex-workflow="nav-item"]').click();
    h.document.querySelector('[aria-labelledby="codex-workflow-focusedInterface-label"]').click();
    await flush();
    assert.equal(display(), 'flex');
  } finally { h.dom.window.close(); }
});

test("empty settings headings stay hidden before rows arrive and preserve unowned content", async () => {
  const h = await createHarness({source:starterSource, nativeSidebar:true,
    initialSettings:{schemaVersion:4, sidebarNavigation:{settingsHidden:['appshots']}}});
  try {
    const group = h.document.querySelector('#integrations');
    const rows = group.lastElementChild;
    const display = () => h.window.getComputedStyle(group).display;
    rows.replaceChildren();
    assert.equal(display(), 'none', 'empty heading must not paint while rows mount');
    rows.innerHTML = '<button data-settings-panel-slug="appshots">Appshots</button>';
    assert.equal(display(), 'none');
    rows.firstElementChild.style.display = 'flex';
    assert.equal(display(), 'none');
    rows.insertAdjacentHTML('beforeend', '<button data-settings-panel-slug="computer-use">Computer use</button><button data-settings-panel-slug="chronicle">Computer history</button>');
    assert.notEqual(display(), 'none', 'visible integrations remain available');
    rows.lastElementChild.remove(); rows.lastElementChild.remove();
    rows.firstElementChild.disabled = true;
    assert.notEqual(display(), 'none', 'disabled native row is not owned');
    rows.firstElementChild.disabled = false;
    const extra = h.document.createElement('span'); extra.textContent = 'Extension settings';
    rows.append(extra); assert.notEqual(display(), 'none');
    extra.remove();
    group.append(extra); assert.notEqual(display(), 'none'); extra.remove();
    group.firstElementChild.append(h.document.createElement('button'));
    assert.notEqual(display(), 'none', 'header action remains available');
    group.firstElementChild.lastElementChild.remove();
    assert.equal(display(), 'none');
    h.document.querySelector('[data-codex-workflow="nav-item"]').click();
    h.document.querySelector('[aria-labelledby="codex-workflow-focusedInterface-label"]').click();
    await flush();
    assert.notEqual(display(), 'none');
  } finally { h.dom.window.close(); }
});

test("settings ordering preserves the native Account wrapper and follows visual keyboard order", async () => {
  const h = await createHarness({source:starterSource});
  try {
    h.document.querySelector('aside').remove();
    h.document.querySelector('#settings-shell').classList.add('app-shell-left-panel');
    const nav = h.document.querySelector('nav[aria-label="Settings"]');
    nav.classList.add('sidebar-navigation');
    const group = h.document.createElement('div'); group.className = 'flex flex-col';
    group.append(...nav.children); nav.append(group);
    const account = h.document.createElement('span'); account.className = 'contents'; account.innerHTML = '<button class="sidebar-item">Account</button>'; group.append(account);
    h.document.querySelector('[data-codex-workflow="nav-item"]').click();
    h.document.querySelector('[data-codex-workflow-section="sidebar"]').click();
    [...h.document.querySelectorAll('[aria-label="Navigation area"] button')].find(n=>n.textContent === 'Settings navigation').click();
    h.document.querySelector('[data-workflow-navigation-item="appearance"] button').dispatchEvent(new h.window.KeyboardEvent('keydown', {key:'ArrowUp', bubbles:true})); await flush();
    const appearance = nav.querySelector('[data-settings-panel-slug="appearance"]');
    const general = nav.querySelector('[data-settings-panel-slug="general-settings"]');
    assert.equal(h.window.getComputedStyle(appearance).order, '1');
    assert.equal(h.window.getComputedStyle(account).order, '101');
    assert.equal(h.window.getComputedStyle(account.firstElementChild).order, '101');
    for (const node of group.children) node.getBoundingClientRect = () => ({top:Number(h.window.getComputedStyle(node).order) * 32,height:32,left:0});
    appearance.focus();
    appearance.dispatchEvent(new h.window.KeyboardEvent('keydown', {key:'Tab', bubbles:true,cancelable:true}));
    assert.equal(h.document.activeElement, general);
  } finally { h.dom.window.close(); }
});

test("account menu follows the measured sidebar width and restores on disable", async () => {
  const h = await createHarness({source:starterSource, realObservers:true});
  try {
    let resize;
    h.window.ResizeObserver = class { constructor(callback) { resize = callback; } observe() {} disconnect() {} };
    let sidebarWidth = 400;
    h.document.querySelector('.app-shell-left-panel').getBoundingClientRect = () => ({width:sidebarWidth});
    h.document.querySelector('[aria-label="Open profile menu"]').click();
    const menu = h.document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-labelledby', 'account-menu-trigger');
    menu.style.width = '504px';
    menu.innerHTML = '<div role="menuitem"><span class="truncate">Settings</span></div>';
    h.document.body.append(menu); await flush();
    const sizingRule = () => [...h.document.querySelector('[data-codex-workflow-navigation-style]').sheet.cssRules]
      .find(rule => rule.selectorText === '[role="menu"][data-workflow-account-sizing]');
    assert.equal(menu.hasAttribute('data-workflow-account-sizing'), true);
    assert.equal(sizingRule().style.getPropertyValue('width'), 'calc(var(--codex-workflow-account-sidebar-width) - 2 * var(--padding-row-cell-x, var(--padding-row-x)))');
    assert.equal(menu.style.getPropertyValue('--codex-workflow-account-sidebar-width'), '400px');
    sidebarWidth = 240; resize();
    assert.equal(menu.style.getPropertyValue('--codex-workflow-account-sidebar-width'), '240px');
    sidebarWidth = 0; resize();
    assert.equal(menu.style.getPropertyValue('--codex-workflow-account-sidebar-width'), '240px');
    // JSDOM drops priority on calc() declarations with nested var(); Chromium is checked live.
    assert.match(h.document.querySelector('[data-codex-workflow-navigation-style]').textContent,
      /\[data-workflow-account-sizing\]\{width:calc\(var\(--codex-workflow-account-sidebar-width\)[^;]+!important;/);
    menu.style.width = '224px';
    assert.ok(sizingRule());
    const replacement = menu.cloneNode(true);
    replacement.removeAttribute('data-workflow-account-sizing');
    menu.replaceWith(replacement); await flush();
    assert.equal(replacement.hasAttribute('data-workflow-account-sizing'), true);
    const unrelated = replacement.cloneNode(true);
    unrelated.removeAttribute('data-workflow-account-sizing');
    unrelated.setAttribute('aria-labelledby', 'sidebar-help-trigger');
    replacement.replaceWith(unrelated); await flush();
    assert.equal(unrelated.hasAttribute('data-workflow-account-sizing'), false);
    unrelated.replaceWith(replacement); await flush();
    h.document.querySelector('[data-codex-workflow="nav-item"]').click();
    h.document.querySelector('[aria-labelledby="codex-workflow-focusedInterface-label"]').click(); await flush();
    assert.equal(sizingRule(), undefined);
    assert.equal(replacement.style.width, '224px');
    assert.equal(replacement.hasAttribute('data-workflow-account-sizing'), false);
  } finally { h.dom.window.close(); }
});

test("account customization survives portal replacement and skips hidden rows in keyboard traversal", async () => {
  const h = await createHarness({source:starterSource, realObservers:true, initialSettings:{focusedInterface:true,
    sidebarNavigation:{accountOrder:['pet','usage','invite','settings','logout'], accountHidden:['invite']}}});
  try {
    h.document.querySelector('[aria-label="Open profile menu"]').click();
    let menu = h.document.createElement('div'); menu.setAttribute('role','menu');
    menu.innerHTML = '<div style="display:flex;flex-direction:column">' + ['Usage','Show pet','Invite a friend','Settings','Log out']
      .map(label=>`<div role="menuitem" tabindex="-1"><span class="truncate">${label}</span></div>`).join('') + '</div>';
    h.document.body.append(menu); await flush();
    const item = id => menu.querySelector(`[data-workflow-account-item="${id}"]`);
    assert.equal(h.window.getComputedStyle(item('invite')).display, 'none');
    assert.equal(h.window.getComputedStyle(item('pet')).order, '1');
    assert.equal(h.window.getComputedStyle(item('usage')).order, '2');
    for (const node of menu.querySelectorAll('[role="menuitem"]')) node.getBoundingClientRect = () => ({
      top:Number(h.window.getComputedStyle(node).order) * 32, height:h.window.getComputedStyle(node).display === 'none' ? 0 : 32, left:0});
    item('pet').focus(); item('pet').dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
    assert.equal(h.document.activeElement,item('usage'));
    item('usage').dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
    assert.equal(h.document.activeElement,item('settings'));
    const replacement = menu.cloneNode(true);
    replacement.querySelectorAll('[data-workflow-account-item]').forEach(node=>node.removeAttribute('data-workflow-account-item'));
    menu.replaceWith(replacement); menu = replacement; await flush();
    assert.equal(h.window.getComputedStyle(item('invite')).display,'none');
  } finally { h.dom.window.close(); }
});

test("schema 4 renderer keeps removed Settings out of the list after restart", async () => {
  const h = await createHarness({source:starterSource,initialSettings:{schemaVersion:4,sidebarNavigation:{order:['usage-shortcut','invalid','usage-shortcut'],hidden:['settings-shortcut']}}});
  try {
    h.document.querySelector('[data-codex-workflow="nav-item"]').click();
    h.document.querySelector('[data-codex-workflow-section="sidebar"]').click();
    assert.deepEqual([...h.document.querySelectorAll('[data-workflow-navigation-item]')].map(x=>x.dataset.workflowNavigationItem),['new-chat','usage-shortcut','pull-requests','scheduled','plugins','explore']);
    h.document.querySelector('[data-workflow-add-shortcut]').click();
    assert.deepEqual([...h.document.querySelectorAll('#codex-workflow-add-shortcut-menu [role="menuitem"]')].map(x=>x.textContent),['Settings',"What's New",'Workflow','Profile']);
    h.document.querySelector('[aria-label="Navigation area"] button[aria-pressed="false"]').click();
    assert.equal(h.document.querySelector('#codex-workflow-add-shortcut-menu'),null);
    assert.equal(h.document.querySelector('[data-workflow-add-shortcut]'),null);
  } finally { h.dom.window.close(); }
});

test("shortcut picker adds, reorders, hides and removes shared rows with keyboard and rollback", async () => {
  let reject = false;
  let saved = {schemaVersion:4, focusedInterface:true};
  const h = await createHarness({source:starterSource, realObservers:true, setSettings: patch => {
    if (reject) return Promise.reject(new Error("disk full"));
    saved = {...saved, ...patch}; return Promise.resolve(saved);
  }});
  try {
    const aside = h.document.querySelector("aside");
    const help = aside.querySelector('[aria-label="Open help menu"]');
    const host = h.document.createElement("div");
    host.id = "app-shell-sidebar";
    host.innerHTML = `<button class="sidebar-item"><svg></svg><span class="text-fade-truncate">New chat</span></button><div>${["Pull requests","Scheduled","Plugins","Explore"].map(label => `<button class="sidebar-item"><svg></svg><span class="text-fade-truncate">${label}</span></button>`).join("")}</div>`;
    aside.replaceChildren(host,help);
    h.window.dispatchEvent(new h.window.Event("resize")); await flush();
    h.document.querySelector('[data-codex-workflow="nav-item"]').click();
    h.document.querySelector('[data-codex-workflow-section="sidebar"]').click();
    let add = h.document.querySelector('[data-workflow-add-shortcut]');
    const row = id => h.document.querySelector(`[data-workflow-navigation-item="${id}-shortcut"]`);
    const menu = () => h.document.querySelector('#codex-workflow-add-shortcut-menu');
    const open = () => { add.click(); return menu(); };
    assert.deepEqual([...open().querySelectorAll('[role="menuitem"]')].map(x=>x.textContent),["Usage","What's New","Workflow","Profile"]);
    assert.equal(menu().querySelectorAll('svg').length,4);
    menu().dispatchEvent(new h.window.KeyboardEvent("keydown",{key:"End",bubbles:true}));
    assert.equal(h.document.activeElement.textContent,"Profile");
    menu().dispatchEvent(new h.window.KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
    assert.equal(h.document.activeElement,add); assert.equal(menu(),null);
    for (const id of ["usage","whats-new","workflow","profile"]) {
      open().querySelector(`[data-value="${id}-shortcut"]`).click(); await flush();
      assert.ok(row(id)); assert.ok(row(id).querySelector('svg'));
    }
    assert.equal(add.disabled,true);
    assert.equal(aside.querySelectorAll('[data-workflow-shortcut]').length,5);
    const messages=[]; h.window.addEventListener('message',e=>messages.push(e.data));
    for(const id of ["usage","profile"]) aside.querySelector(`[data-workflow-native-nav="${id}-shortcut"]`).click();
    assert.deepEqual(messages.map(x=>x.path),['/settings/usage','/settings/profile']);
    assert.equal(h.document.querySelector('[data-codex-workflow-panel]'),null);
    aside.querySelector('[data-workflow-native-nav="workflow-shortcut"]').click();
    assert.equal(h.document.querySelector('[data-codex-workflow-panel] h1').textContent,'Workflow');
    h.document.querySelector('[data-codex-workflow-section="sidebar"]').click();
    h.document.querySelector('[data-codex-workflow="nav-item"]').click();
    add = h.document.querySelector('[data-workflow-add-shortcut]');
    const news = aside.querySelector('[data-workflow-native-nav="whats-new-shortcut"]');
    let anchorTop = 200;
    news.getBoundingClientRect = () => ({left:8,right:248,top:anchorTop,bottom:anchorTop+32,width:240,height:32});
    const popup = h.document.createElement('div');
    popup.setAttribute('role','menu'); popup.setAttribute('aria-labelledby',help.id);
    Object.defineProperty(popup,'scrollHeight',{value:160});
    popup.getBoundingClientRect = () => {
      const [x=0,y=0] = popup.style.translate.split(' ').map(value=>parseFloat(value)||0);
      return {left:8+x,right:248+x,top:400+y,bottom:560+y,width:240,height:160};
    };
    let helpOpened=0; help.addEventListener('keydown',event=>{
      if(event.key==='ArrowDown' && event.cancelable && event.composed) { helpOpened++; h.document.body.append(popup); }
    });
    popup.addEventListener('keydown', event => { if (event.key === 'Escape') popup.remove(); });
    news.click(); assert.equal(helpOpened,1);
    assert.equal(help.style.display, 'none');
    assert.equal(aside.querySelector('[data-workflow-footer-shortcut]').getAttribute('aria-expanded'), 'false');
    assert.equal(news.getAttribute('aria-expanded'), 'true');
    assert.equal(popup.getBoundingClientRect().top,236);
    assert.equal(popup.style.width,'240px');
    anchorTop=700; h.window.dispatchEvent(new h.window.Event('resize'));
    assert.equal(popup.getBoundingClientRect().bottom,696);
    popup.remove(); await flush();
    assert.equal(popup.style.translate,''); assert.equal(popup.style.width,'');
    assert.equal(popup.hasAttribute('data-workflow-news-popup'),false);
    news.click(); assert.equal(helpOpened,2);
    news.dispatchEvent(new h.window.MouseEvent('pointerdown', {bubbles:true,cancelable:true}));
    news.click(); assert.equal(helpOpened,2); assert.equal(popup.isConnected,false);
    assert.equal(news.getAttribute('aria-expanded'), 'false');
    row('workflow').querySelector('button').dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true})); await flush();
    assert.ok(saved.sidebarNavigation.order.indexOf('workflow-shortcut') < saved.sidebarNavigation.order.indexOf('whats-new-shortcut'));
    row('usage').querySelector('[aria-pressed]').click(); await flush();
    assert.ok(saved.sidebarNavigation.hidden.includes('usage-shortcut'));
    const controls=row('usage').lastElementChild;
    assert.equal(controls.querySelectorAll('button')[0].className,controls.querySelectorAll('button')[1].className);
    assert.equal(controls.lastElementChild.getAttribute('aria-label'), 'Show Usage');
    assert.equal(controls.querySelector('button').getAttribute('aria-label'), 'Remove Usage shortcut');
    reject=true; row('usage').querySelector('[aria-label="Remove Usage shortcut"]').click(); await flush();
    assert.ok(row('usage')); assert.match(h.document.querySelector('[role="status"]').textContent,/Couldn’t save/);
    reject=false; row('usage').querySelector('[aria-label="Remove Usage shortcut"]').click(); await flush();
    assert.equal(row('usage'),null); assert.equal(add.disabled,false);
    assert.equal(h.document.activeElement,add);
    assert.ok(!saved.sidebarNavigation.hidden.includes('usage-shortcut'));
    assert.deepEqual([...open().querySelectorAll('[role="menuitem"]')].map(x=>x.textContent),['Usage']);
    h.window.dispatchEvent(new h.window.Event('resize')); assert.equal(menu(),null);
    const before=aside.querySelectorAll('[data-workflow-shortcut]').length;
    host.replaceWith(host.cloneNode(true)); await flush();
    assert.equal(aside.querySelectorAll('[data-workflow-shortcut]').length,before);
    row('settings').querySelector('[aria-label="Remove Settings shortcut"]').click(); await flush();
    assert.equal(row('settings'),null);
    assert.ok(!saved.sidebarNavigation.order.includes('settings-shortcut'));
    [...h.document.querySelectorAll('button')].find(button=>button.textContent==='Account menu').click();
    const footer = h.document.querySelector('[aria-label="Footer shortcut"]');
    assert.ok(footer); assert.equal(footer.closest('[data-codex-workflow-navigation-rows]'),null);
    footer.click();
    const footerMenu = () => h.document.querySelector('#codex-workflow-footer-shortcut-menu');
    assert.equal(footerMenu().querySelectorAll('[role="menuitemradio"]').length,5);
    footerMenu().querySelector('[data-value="usage-shortcut"]').click(); await flush();
    assert.equal(saved.sidebarNavigation.footerShortcut,'usage-shortcut');
    assert.match(footer.textContent,/Usage/);
    const footerAction=aside.querySelector('[data-workflow-footer-shortcut]');
    footerAction.click(); assert.equal(messages.at(-1).path,'/settings/usage');
    h.document.querySelector('[data-codex-workflow="nav-item"]').click();
    const footerAgain=h.document.querySelector('[aria-label="Footer shortcut"]');
    reject=true; footerAgain.click(); footerMenu().querySelector('[data-value="profile-shortcut"]').click(); await flush();
    assert.match(footerAgain.textContent,/Usage/);
    assert.equal(footerAction.getAttribute('aria-label'),'Usage unavailable. Open Usage settings');
    reject=false;
    footerAgain.click(); footerMenu().querySelector('[data-value="profile-shortcut"]').click(); await flush();
    assert.ok(footerAction.querySelector('svg'));
    assert.equal(footerAction.className, help.className);
    footerAction.click(); assert.equal(messages.at(-1).path,'/settings/profile');
    h.document.querySelector('[data-codex-workflow="nav-item"]').click();
    h.document.querySelector('[aria-label="Footer shortcut"]').click();
    footerMenu().querySelector('[data-value="workflow-shortcut"]').click(); await flush();
    footerAction.click();
    assert.equal(h.document.querySelector('[data-codex-workflow-panel] h1').textContent,'Workflow');
    assert.equal(h.document.querySelectorAll('[data-codex-workflow-panel]').length,1);
  } finally { h.dom.window.close(); }
});

test("Workflow footer waits for the settings shell and General migrates without duplicate rows", async () => {
  const h = await createHarness({source:starterSource,realObservers:true,initialSettings:{schemaVersion:4,focusedInterface:true,
    sidebarNavigation:{order:['general-shortcut','settings-shortcut','workflow-shortcut','profile-shortcut'],hidden:['general-shortcut'],footerShortcut:'workflow-shortcut'}}});
  try {
    const host=h.document.createElement('div'); host.id='app-shell-sidebar';
    h.document.querySelector('aside').prepend(host);
    h.window.dispatchEvent(new h.window.Event('resize')); await flush();
    h.document.querySelector('[data-codex-workflow="nav-item"]').click();
    h.document.querySelector('[data-codex-workflow-section="sidebar"]').click();
    assert.equal(h.document.querySelectorAll('[data-workflow-navigation-item="settings-shortcut"]').length,1);
    assert.equal(h.document.querySelector('[data-workflow-navigation-item="general-shortcut"]'),null);
    assert.equal(h.document.querySelector('[data-workflow-navigation-item="settings-shortcut"]').dataset.workflowNavigationHidden,'true');
    const shell=h.document.querySelector('#settings-shell');
    shell.remove(); await flush();
    const messages=[]; h.window.addEventListener('message',e=>messages.push(e.data));
    h.document.querySelector('[data-workflow-footer-shortcut]').click();
    assert.equal(messages.at(-1).path,'/settings/general-settings');
    h.document.body.append(shell); await flush();
    assert.equal(h.document.querySelector('[data-codex-workflow-panel] h1').textContent,'Workflow');
    assert.equal(h.document.querySelectorAll('[data-codex-workflow-panel]').length,1);
  } finally { h.dom.window.close(); }
});

async function createHarness({ initialSettings, installUpdateResult, setSettings, sidebarWidth, updateStatus, getUpdateStatus, source = preloadSource, delayedRoots = false, nativeSidebar = false, realObservers = false } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <header id="top-toolbar" class="flex h-toolbar draggable">
      <div id="toolbar-actions" class="@container flex items-center">
        <button type="button" aria-label="Share"></button>
        <button type="button" aria-label="Toggle summary"></button>
        <button type="button" aria-label="Toggle bottom panel"></button>
        <button type="button" aria-label="Toggle top panel"></button>
      </div>
    </header>
    <aside class="app-shell-left-panel">
      <div id="sidebar-toolbar" class="h-toolbar w-full shrink-0 draggable"></div>
      <div id="pull-requests" class="sidebar-item" style="display: block !important" aria-hidden="false" tabindex="3">
        <a href="/pull-requests"><span class="text-fade-truncate">Pull requests</span></a>
      </div>
      <div class="min-w-0 flex-1">
        <button id="account-menu-trigger" type="button" aria-haspopup="menu" aria-label="Open profile menu">Account</button>
      </div>
      <button id="sidebar-help-trigger" type="button" aria-haspopup="menu" aria-label="Open help menu" class="size-8 shrink-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0">
        <svg class="icon-sm" viewBox="0 0 20 20" fill="none"><path d="native-question" fill="currentColor"></path></svg>
      </button>
    </aside>
    <div id="primary-composer" role="presentation" data-composer-layout="multiline">
      <div id="composer-footer" class="_ComposerLayoutFooter_kbwao_2" data-composer-footer-responsive="" data-composer-layout="multiline" data-composer-rows="inline" data-composer-spacing="default">
        <div id="composer-expanding-controls" class="flex min-w-0 flex-1 justify-end">
          <button id="model-reasoning-selector" type="button" aria-label="Select model and reasoning"></button>
        </div>
        <div id="composer-actions" class="flex shrink-0 items-center gap-2">
          <button id="context-window-ring" type="button" aria-label="Context window"></button>
          <button id="composer-dictate" type="button" aria-label="Dictate" style="display: inline-flex !important" aria-hidden="false" tabindex="4"></button>
          <div id="composer-submit-slot" class="ms-2 flex items-center">
            <button id="composer-submit" type="button" aria-label="Send"></button>
          </div>
        </div>
      </div>
    </div>
    <button id="outside-dictate" type="button" aria-label="Dictate"></button>
    <div id="settings-shell">
      <nav aria-label="Settings">
        <button class="nav active" data-settings-panel-slug="general-settings" aria-current="page"><svg class="icon active"><path></path></svg><span class="text-fade-truncate active-label">General</span></button>
        <button class="nav inactive" data-settings-panel-slug="appearance"><svg class="icon inactive"><path></path></svg><span class="text-fade-truncate inactive-label">Appearance</span></button>
        <button class="nav inactive" data-settings-panel-slug="voice"><svg class="icon inactive"><path></path></svg><span class="text-fade-truncate inactive-label">Voice</span></button>
        <button class="nav inactive" data-settings-panel-slug="personalization"><svg class="icon inactive"><path></path></svg><span class="text-fade-truncate inactive-label">Personalization</span></button>
      </nav>
      <main id="settings-content"><section id="native-panel">Native settings</section></main>
    </div>
    <section id="response-stream"></section>
  </body></html>`, {
    url: "app://codex/settings",
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const { window } = dom;
  const { document } = window;
  if (nativeSidebar) {
    const nav = document.querySelector("nav");
    nav.classList.add("sidebar-navigation");
    const sidebar = document.createElement("aside");
    sidebar.className = "app-shell-left-panel";
    nav.before(sidebar);
    sidebar.append(nav);
    const items = Array.from(nav.children);
    nav.innerHTML = `<div class="flex min-h-0 flex-1 flex-col"><input aria-label="Search settings"><div id="settings-scroll" class="min-h-0 flex-1 overflow-y-auto pb-2 flex flex-col gap-4"><div id="personal" class="flex flex-col gap-1"><div class="group/nav-section-title flex items-center justify-between gap-2 pe-0.5 ps-2"><div class="min-w-0 flex-1 text-base font-medium text-tertiary opacity-75">Personal</div></div><div class="flex flex-col gap-px browser:gap-0"></div></div><div id="integrations" class="flex flex-col gap-1"><div class="group/nav-section-title flex items-center justify-between gap-2 pe-0.5 ps-2"><div class="min-w-0 flex-1 text-base font-medium text-tertiary opacity-75">Integrations</div></div><div class="flex flex-col gap-px browser:gap-0"><button data-settings-panel-slug="mcp" aria-label="MCP servers" class="nav inactive"><span class="text-fade-truncate">MCP servers</span></button></div></div></div><footer>Fixed footer</footer></div>`;
    nav.querySelector("#personal").lastElementChild.append(...items);
  }
  const delayedSidebar = document.querySelector(".app-shell-left-panel");
  const delayedSettingsShell = document.querySelector("#settings-shell");
  if (delayedRoots) {
    delayedSidebar.remove();
    delayedSettingsShell.remove();
  }
  const observers = [];
  const intervalCalls = [];
  const timeoutCallbacks = new Map();
  const animationFrameCallbacks = [];
  const invokedChannels = [];
  let deferAnimationFrames = false;
  let nextTimer = 1;
  let deliveredMutationCallbacks = 0;
  let persistedSettings = initialSettings
    ? { ...initialSettings }
    : {
      schemaVersion: source === starterSource ? 3 : 2,
      focusedInterface: true,
      hidePullRequests: true,
      hidePetMenuItem: true,
      hideInviteFriendMenuItem: true,
      replaceHelpWithSettings: true,
      hideComposerMicrophone: false,
    };
  const ipcRenderer = {
    invoke(channel, patch) {
      invokedChannels.push(channel);
      if (channel === "codex-workflow:settings:get") {
        return Promise.resolve({ ...persistedSettings });
      }
      if (channel === "codex-workflow:sidebar-width") return sidebarWidth ? sidebarWidth(patch) : Promise.resolve(275);
      if (channel === "codex-workflow:update:get") {
        if (getUpdateStatus) return getUpdateStatus();
        return Promise.resolve(updateStatus || { available: false });
      }
      if (channel === "codex-workflow:update:install") {
        if (installUpdateResult !== undefined) return Promise.resolve(installUpdateResult);
        return Promise.resolve({ ...(updateStatus || {}), applying: true });
      }
      if (channel === "codex-workflow:settings:activate") {
        if (patch.target !== "keyboard-shortcut") return Promise.reject(new Error("invalid activation"));
        document.dispatchEvent(new window.KeyboardEvent("keydown", {
          key: ",",
          code: "Comma",
          metaKey: true,
          bubbles: true,
        }));
        return Promise.resolve(true);
      }
      if (setSettings) return setSettings(patch);
      persistedSettings = { ...persistedSettings, ...patch, schemaVersion: source === starterSource ? 4 : 2 };
      return Promise.resolve({ ...persistedSettings });
    },
    on() {},
    send() {},
  };

  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.matches("nav")) return { width: 240, height: 420, left: 0, right: 240, top: 0, bottom: 420 };
    if (this.id === "settings-content") return { width: 640, height: 520, left: 240, right: 880, top: 0, bottom: 520 };
    return { width: 120, height: 32, left: 0, right: 120, top: 0, bottom: 32 };
  };

  const context = dom.getInternalVMContext();
  const NativeMutationObserver = window.MutationObserver;
  context.require = (name) => {
    if (name === "electron") return { ipcRenderer };
    throw new Error(`Unexpected preload require: ${name}`);
  };
  context.MutationObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.active = false;
      this.target = null;
      this.options = null;
      this.native = realObservers ? new NativeMutationObserver((records) => {
        deliveredMutationCallbacks += 1;
        if (deliveredMutationCallbacks > 60) { this.disconnect(); return; }
        callback(records);
      }) : null;
      observers.push(this);
    }

    observe(target, options) {
      this.active = true;
      this.target = target;
      this.options = options;
      this.native?.observe(target, options);
    }

    disconnect() {
      this.active = false;
      this.native?.disconnect();
    }
  };
  context.setInterval = (...args) => {
    intervalCalls.push(args);
    return nextTimer++;
  };
  context.clearInterval = () => {};
  context.setTimeout = (callback) => {
    const id = nextTimer++;
    timeoutCallbacks.set(id, callback);
    return id;
  };
  context.clearTimeout = (id) => timeoutCallbacks.delete(id);
  context.requestAnimationFrame = (callback) => {
    if (deferAnimationFrames) animationFrameCallbacks.push(callback);
    else callback();
    return nextTimer++;
  };
  Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });

  const nav = document.querySelector("nav") || delayedSettingsShell.querySelector("nav");
  nav.addEventListener("keydown", (event) => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const item = event.target.closest("[data-settings-panel-slug]");
    if (!item) return;
    event.preventDefault();
    const items = Array.from(nav.querySelectorAll("[data-settings-panel-slug]"));
    const next = items[items.indexOf(item) + (event.key === "ArrowDown" ? 1 : -1)];
    next?.focus();
    next?.click();
  });
  nav.addEventListener("click", (event) => {
    const item = event.target.closest("[data-settings-panel-slug]");
    if (!item || item.dataset.codexWorkflow === "nav-item") return;
    for (const entry of nav.querySelectorAll("[data-settings-panel-slug]")) {
      entry.className = "nav inactive";
      entry.removeAttribute("aria-current");
    }
    item.className = "nav active";
    item.setAttribute("aria-current", "page");
  });

  new Script(source, { filename: "preload.cjs" }).runInContext(context);
  await flush();
  document.dispatchEvent(new window.Event("DOMContentLoaded"));
  await flush();
  const emitMutation = (target, { addedNodes = [], removedNodes = [] } = {}) => {
    const record = { target, addedNodes, removedNodes };
    for (const observer of observers.slice()) {
      if (!observer.active || !observer.target) continue;
      const inScope = observer.target === target ||
        (observer.options?.subtree && observer.target.contains(target));
      if (inScope) {
        deliveredMutationCallbacks += 1;
        observer.callback([record], observer);
      }
    }
  };

  return {
    dom,
    window,
    document,
    nav,
    ipcRenderer,
    invokedChannels,
    observers,
    intervalCalls,
    timeoutCallbacks,
    runNextTimeout: () => {
      const entry = timeoutCallbacks.entries().next().value;
      if (!entry) return false;
      timeoutCallbacks.delete(entry[0]);
      entry[1]();
      return true;
    },
    mountDelayedRoots: () => {
      document.body.prepend(delayedSidebar);
      document.body.appendChild(delayedSettingsShell);
      emitMutation(document.body, { addedNodes: [delayedSidebar, delayedSettingsShell] });
    },
    emitMutation,
    deliveredMutationCallbacks: () => deliveredMutationCallbacks,
    deferAnimationFrames: () => {
      deferAnimationFrames = true;
    },
    flushAnimationFrame: () => {
      const callbacks = animationFrameCallbacks.splice(0);
      for (const callback of callbacks) callback();
    },
    resumeAnimationFrames: () => {
      deferAnimationFrames = false;
    },
  };
}

test("sidebar editing hides navigation only, keeps Workflow reachable, and restores exact nodes", async () => {
  const harness = await createHarness({ nativeSidebar: true });
  try {
    const { document, nav } = harness;
    const general = nav.querySelector('[data-settings-panel-slug="general-settings"]');
    const appearance = nav.querySelector('[data-settings-panel-slug="appearance"]');
    const parent = appearance.parentElement;
    appearance.setAttribute("style", "display: inline-flex !important");
    appearance.setAttribute("aria-hidden", "false");
    const before = appearance.outerHTML;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    const edit = document.querySelector('[data-codex-workflow="sidebar-edit"]');
    assert.equal(edit.textContent, "Customise");
    assert.equal(document.querySelector('[data-codex-workflow="hidden-pages"]'), null);
    edit.click();
    assert.equal(edit.textContent, "Done");
    assert.equal(nav.querySelectorAll('[data-codex-workflow="sidebar-row"]').length, 5);
    assert.equal(nav.querySelector('[aria-label="Hide Workflow"]'), null);
    assert.equal(appearance.parentElement, parent);
    nav.querySelector('[aria-label="Hide Appearance"]').click();
    await flush();
    const group = nav.querySelector('[data-codex-workflow="hidden-pages"]');
    assert.equal(group.previousElementSibling.id, "integrations");
    assert.equal(group.parentElement.id, "settings-scroll");
    assert.equal(group.querySelector("button").getAttribute("aria-expanded"), "true");
    assert.equal(document.querySelector('[data-codex-workflow-panel]').isConnected, true);
    assert.equal(general.getAttribute("aria-current"), null);
    assert.equal(appearance.style.display, "none");
    assert.equal(appearance.getAttribute("aria-hidden"), "true");
    nav.querySelector('[aria-label="Restore Appearance"]').click();
    await flush();
    assert.equal(nav.querySelector('[data-codex-workflow="hidden-pages"]'), null);
    edit.click();
    assert.equal(appearance.outerHTML, before);
    assert.equal(nav.querySelectorAll('[data-codex-workflow="sidebar-row"]').length, 0);
    edit.click();
    appearance.style.display = "grid";
    appearance.style.color = "red";
    appearance.setAttribute("aria-hidden", "false");
    edit.click();
    assert.equal(appearance.style.display, "grid");
    assert.equal(appearance.style.color, "red");
    assert.equal(appearance.getAttribute("aria-hidden"), "false");
  } finally { harness.dom.window.close(); }
});

test("hidden current pages remain open and disclosure navigation never restores preferences", async () => {
  const harness = await createHarness({ nativeSidebar: true, initialSettings: { hiddenSettingsPages: ["general-settings", "workflow", "mcp", "mcp", 42] } });
  try {
    const { document, nav, invokedChannels, emitMutation } = harness;
    const panel = document.querySelector("#native-panel");
    const general = nav.querySelector('[data-settings-panel-slug="general-settings"]');
    assert.equal(general.getAttribute("aria-current"), "page");
    assert.equal(panel.style.display, "");
    assert.equal(nav.querySelector('[data-settings-panel-slug="workflow"]').style.display, "");
    const group = nav.querySelector('[data-codex-workflow="hidden-pages"]');
    const disclosure = group.querySelector("button");
    assert.equal(disclosure.getAttribute("aria-expanded"), "false");
    assert.equal(group.lastElementChild.hidden, true);
    disclosure.click();
    assert.equal(group.lastElementChild.hidden, false);
    assert.equal(group.querySelectorAll('[data-codex-workflow-page]').length, 2);
    const proxy = group.querySelector('[data-codex-workflow-page="mcp"]');
    proxy.click();
    await flush();
    assert.equal(nav.querySelector('[data-settings-panel-slug="mcp"]').getAttribute("aria-current"), "page");
    assert.equal(panel.style.display, "");
    assert.equal(general.style.display, "none");
    assert.equal(invokedChannels.includes("codex-workflow:settings:set"), false);
    for (let index = 0; index < 4; index += 1) emitMutation(nav, { addedNodes: [proxy] });
    assert.equal(nav.querySelectorAll('[data-codex-workflow="hidden-pages"]').length, 1);
    assert.equal(nav.querySelectorAll('[data-codex-workflow-page="mcp"]').length, 1);
    group.querySelector('[data-codex-workflow-page="mcp"]').focus();
    disclosure.click();
    assert.equal(document.activeElement, disclosure);
    assert.equal(group.lastElementChild.hidden, true);
  } finally { harness.dom.window.close(); }
});

test("sidebar IPC failure rolls back and concurrent writes cannot overwrite other settings", async () => {
  let rejectWrite;
  const writes = [];
  const harness = await createHarness({ nativeSidebar: true, setSettings: (patch) => {
    writes.push(patch);
    return new Promise((_resolve, reject) => { rejectWrite = reject; });
  } });
  try {
    const { document, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('[data-codex-workflow="sidebar-edit"]').click();
    const hide = nav.querySelector('[aria-label="Hide Voice"]');
    hide.click();
    assert.equal(hide.disabled, true);
    assert.equal(document.querySelector('[role="switch"]').disabled, true);
    nav.querySelector('[aria-label="Hide Appearance"]').click();
    assert.equal(writes.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(writes[0])), { hiddenSettingsPages: ["voice"] });
    rejectWrite(new Error("disk full"));
    await flush();
    assert.equal(nav.querySelector('[data-codex-workflow="hidden-pages"]'), null);
    assert.ok(nav.querySelector('[aria-label="Hide Voice"]'));
    assert.equal(document.querySelector('[role="switch"]').disabled, false);
  } finally { harness.dom.window.close(); }
});

test("native search results remain untouched and open hidden pages without unhiding", async () => {
  const harness = await createHarness({ nativeSidebar: true, initialSettings: { hiddenSettingsPages: ["voice"] } });
  try {
    const { document, nav, emitMutation, invokedChannels } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    const owner = document.querySelector("#settings-scroll");
    const savedGroups = [...owner.children].filter((element) => element.id === "personal" || element.id === "integrations");
    owner.replaceChildren();
    const result = document.createElement("button");
    result.dataset.listNavigationItem = "true";
    result.textContent = "Voice";
    result.addEventListener("click", () => { document.querySelector("#native-panel").textContent = "Voice settings"; });
    owner.append(result);
    emitMutation(owner, { addedNodes: [result] });
    assert.ok(nav.querySelector('[data-settings-panel-slug="workflow"]'));
    assert.equal(result.style.display, "");
    assert.equal(nav.querySelector('[data-codex-workflow="hidden-pages"]'), null);
    result.click();
    await flush();
    assert.equal(document.querySelector("#native-panel").style.display, "");
    assert.equal(document.querySelector("#native-panel").textContent, "Voice settings");
    owner.replaceChildren(...savedGroups);
    emitMutation(owner, { addedNodes: savedGroups });
    assert.equal(nav.querySelector('[data-settings-panel-slug="voice"]').style.display, "none");
    assert.equal(invokedChannels.includes("codex-workflow:settings:set"), false);
  } finally { harness.dom.window.close(); }
});

test("sidebar proxies sanitize identity, skip hidden rows with arrows, and preserve section layout", async () => {
  const harness = await createHarness({ nativeSidebar: true, initialSettings: { hiddenSettingsPages: ["voice"] } });
  try {
    const { document, nav, window, emitMutation } = harness;
    const appearance = nav.querySelector('[data-settings-panel-slug="appearance"]');
    const general = nav.querySelector('[data-settings-panel-slug="general-settings"]');
    const groups = [document.querySelector("#personal"), document.querySelector("#integrations")];
    const footer = nav.querySelector("footer");
    const originalParents = groups.map((group) => group.parentElement);
    appearance.querySelector("span").id = "native-label";
    appearance.setAttribute("aria-describedby", "native-label");
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('[data-codex-workflow="sidebar-edit"]').click();
    emitMutation(nav, { addedNodes: [] });
    assert.equal(document.querySelectorAll("#native-label").length, 1);
    assert.equal(nav.querySelector('[data-codex-workflow-page="appearance"]').hasAttribute("aria-describedby"), false);
    for (const control of nav.querySelectorAll('[data-codex-workflow="sidebar-row"] button')) {
      assert.equal(control.querySelector("button"), null);
      assert.ok(control.getAttribute("aria-label") || control.textContent);
    }
    assert.equal(nav.querySelector('[aria-label="Hide Appearance"]').style.position, "absolute");
    groups.forEach((group, index) => assert.equal(group.parentElement, originalParents[index]));
    assert.equal(footer.parentElement.lastElementChild, footer);
    assert.equal(general.parentElement.id, "");
    document.querySelector('[data-codex-workflow="sidebar-edit"]').click();
    const disclosure = nav.querySelector('[data-codex-workflow="hidden-pages"] button');
    disclosure.click();
    const workflow = nav.querySelector('[data-settings-panel-slug="workflow"]');
    workflow.focus();
    workflow.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    assert.equal(document.activeElement.dataset.settingsPanelSlug, "personalization");
    assert.equal(nav.querySelector('[data-settings-panel-slug="voice"]').style.display, "none");
    assert.equal(nav.querySelector('[data-codex-workflow="hidden-pages"]').className.includes("sticky"), false);
  } finally { harness.dom.window.close(); }
});

test("hidden pages survive native remounts and repeated sidebar synchronization", async () => {
  const harness = await createHarness({ nativeSidebar: true, initialSettings: { hiddenSettingsPages: ["appearance"] } });
  try {
    const { nav, emitMutation } = harness;
    const original = nav.querySelector('[data-settings-panel-slug="appearance"]');
    const replacement = original.cloneNode(true);
    replacement.removeAttribute("style");
    replacement.removeAttribute("aria-hidden");
    original.replaceWith(replacement);
    replacement.focus();
    emitMutation(replacement.parentElement, { addedNodes: [replacement], removedNodes: [original] });
    assert.equal(replacement.style.display, "none");
    assert.equal(original.style.display, "");
    assert.equal(harness.document.activeElement, nav.querySelector('[data-codex-workflow="hidden-pages"] button'));
    const count = nav.querySelectorAll('[data-codex-workflow="sidebar-row"]').length;
    for (let index = 0; index < 5; index += 1) emitMutation(nav, { addedNodes: [] });
    assert.equal(nav.querySelectorAll('[data-codex-workflow="sidebar-row"]').length, count);
    assert.equal(nav.querySelectorAll('[data-codex-workflow-page="appearance"]').length, 1);
    assert.equal(nav.querySelectorAll('[data-codex-workflow="nav-item"]').length, 1);
  } finally { harness.dom.window.close(); }
});

test("sidebar mutations settle with real observers and hiding the current page never navigates", async () => {
  const harness = await createHarness({ nativeSidebar: true, realObservers: true });
  try {
    const { document, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('[data-codex-workflow="sidebar-edit"]').click();
    nav.querySelector('[data-codex-workflow-page="appearance"]').click();
    await flush();
    const panel = document.querySelector("#native-panel");
    const originalContent = panel.outerHTML;
    nav.querySelector('[aria-label="Hide Appearance"]').click();
    await flush();
    assert.equal(panel.outerHTML, originalContent);
    assert.equal(nav.querySelector('[data-settings-panel-slug="appearance"]').getAttribute("aria-current"), "page");
    assert.ok(harness.deliveredMutationCallbacks() < 30);
    const settled = harness.deliveredMutationCallbacks();
    await flush();
    assert.equal(harness.deliveredMutationCallbacks(), settled);
    const duplicate = nav.querySelector('[data-settings-panel-slug="appearance"]').cloneNode(true);
    duplicate.removeAttribute("style");
    duplicate.removeAttribute("aria-hidden");
    document.querySelector("#integrations").lastElementChild.append(duplicate);
    await flush();
    assert.equal(nav.querySelector('[data-codex-workflow="hidden-pages"]'), null);
    assert.equal(nav.querySelectorAll('[data-codex-workflow="sidebar-row"]').length, 0);
  } finally {
    harness.observers.forEach((observer) => observer.disconnect());
    harness.dom.window.close();
  }
});

test("sidebar disclosure matches its muted heading and edit circles sit inside the row padding", async () => {
  const harness = await createHarness({ nativeSidebar: true, initialSettings: { hiddenSettingsPages: ["voice"] } });
  try {
    const { nav, document } = harness;
    const glyph = nav.querySelector('[data-codex-workflow="hidden-pages"] button svg');
    assert.ok(glyph.classList.contains("text-tertiary"));
    assert.ok(glyph.classList.contains("opacity-75"));
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('[data-codex-workflow="sidebar-edit"]').click();
    for (const label of ["Hide Appearance", "Restore Voice"]) {
      const action = nav.querySelector(`[aria-label="${label}"]`);
      assert.ok(action.classList.contains("size-6"));
      assert.ok(action.firstElementChild.classList.contains("size-4"));
      assert.equal(action.style.insetInlineEnd, "var(--padding-row-x)");
      assert.equal(action.previousElementSibling.style.paddingInlineEnd, "calc(var(--height-token-row) + var(--padding-row-x))");
    }
  } finally { harness.dom.window.close(); }
});

test("hide and restore preserve the viewport including user scrolling during persistence", async () => {
  let resolveWrite;
  const harness = await createHarness({ nativeSidebar: true, setSettings: (patch) =>
    new Promise((resolve) => { resolveWrite = () => resolve(patch); }) });
  try {
    const { nav, document, window } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('[data-codex-workflow="sidebar-edit"]').click();
    const owner = document.querySelector("#settings-scroll");
    const nativeFocus = window.HTMLElement.prototype.focus;
    window.HTMLElement.prototype.focus = function (options) {
      if (this.closest("#settings-scroll") && !options?.preventScroll) owner.scrollTop = 999;
      nativeFocus.call(this, options);
    };
    for (const label of ["Hide Appearance", "Restore Appearance"]) {
      owner.scrollTop = 80;
      nav.querySelector(`[aria-label="${label}"]`).click();
      assert.equal(owner.scrollTop, 80);
      owner.scrollTop = 120;
      resolveWrite();
      await flush();
      assert.equal(owner.scrollTop, 120);
    }
  } finally { harness.dom.window.close(); }
});

test("empty native sidebar sections disappear and restore exactly without hiding unowned destinations", async () => {
  const harness = await createHarness({ nativeSidebar: true });
  try {
    const { document, nav, emitMutation } = harness;
    const section = document.querySelector("#integrations");
    section.setAttribute("style", "display: grid !important; color: red");
    section.setAttribute("aria-hidden", "false");
    const original = section.outerHTML;
    const owner = section.parentElement;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    const edit = document.querySelector('[data-codex-workflow="sidebar-edit"]');
    edit.click();
    nav.querySelector('[aria-label="Hide MCP servers"]').click();
    await flush();
    assert.equal(section.style.display, "none");
    assert.equal(section.getAttribute("aria-hidden"), "true");
    assert.equal(section.parentElement, owner);
    assert.equal(section.nextElementSibling.dataset.codexWorkflow, "hidden-pages");
    assert.equal(document.querySelector("#personal").style.display, "");
    for (const html of ['<button disabled>Unavailable</button>', '<a href="https://example.test">External</a>', '<button>Extension settings</button>']) {
      section.lastElementChild.insertAdjacentHTML("beforeend", html);
      const extra = section.lastElementChild.lastElementChild;
      emitMutation(section, { addedNodes: [extra] });
      assert.equal(section.style.display, "grid");
      extra.remove();
      emitMutation(section, { removedNodes: [extra] });
      assert.equal(section.style.display, "none");
    }
    nav.querySelector('[aria-label="Restore MCP servers"]').click();
    await flush();
    edit.click();
    assert.equal(section.outerHTML, original);
    assert.equal(nav.querySelector("footer").parentElement.lastElementChild.tagName, "FOOTER");
  } finally { harness.dom.window.close(); }
});

test("Revert remains available outside editing and resets only sidebar choices", async () => {
  const initialSettings = { hiddenSettingsPages: ["voice", "mcp", "future-page"], focusedInterface: false, hideComposerMicrophone: true };
  const harness = await createHarness({ nativeSidebar: true, initialSettings });
  try {
    const { document, nav, ipcRenderer, invokedChannels } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    const revert = document.querySelector('[data-codex-workflow="sidebar-revert"]');
    const edit = document.querySelector('[data-codex-workflow="sidebar-edit"]');
    assert.ok(revert);
    assert.equal(revert.parentElement, edit.parentElement);
    assert.equal(revert.textContent, "Revert");
    assert.equal(revert.getAttribute("aria-label"), "Revert settings sidebar to default");
    assert.ok(revert.classList.contains("text-chart-red"));
    assert.ok(revert.classList.contains("bg-chart-red/10"));
    revert.focus();
    revert.click();
    assert.equal(revert.disabled, true);
    await flush();
    assert.equal(document.activeElement, revert);
    assert.equal(edit.textContent, "Customise");
    assert.equal(nav.querySelector('[data-codex-workflow="hidden-pages"]'), null);
    assert.equal(nav.querySelector('[data-settings-panel-slug="voice"]').style.display, "");
    assert.equal(document.querySelector("#integrations").hasAttribute("style"), false);
    const saved = await ipcRenderer.invoke("codex-workflow:settings:get");
    assert.deepEqual(JSON.parse(JSON.stringify(saved)), { ...initialSettings, schemaVersion: 2, hiddenSettingsPages: [] });
    revert.click();
    assert.equal(invokedChannels.filter((channel) => channel === "codex-workflow:settings:set").length, 1);
    edit.click();
    nav.querySelector('[aria-label="Hide Voice"]').click();
    await flush();
    assert.equal(revert.disabled, false);
    revert.click();
    await flush();
    assert.equal(edit.textContent, "Done");
    assert.ok(nav.querySelector('[aria-label="Hide Voice"]'));
    assert.equal(nav.querySelector('[aria-label="Hide Workflow"]'), null);
  } finally { harness.dom.window.close(); }
});

test("Revert serializes writes and rolls rows and headers back on persistence failure", async () => {
  let rejectWrite;
  const writes = [];
  const harness = await createHarness({ nativeSidebar: true, initialSettings: { hiddenSettingsPages: ["mcp"] }, setSettings: (patch) => {
    writes.push(patch);
    return new Promise((_resolve, reject) => { rejectWrite = reject; });
  } });
  try {
    const { document, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    const revert = document.querySelector('[data-codex-workflow="sidebar-revert"]');
    assert.ok(revert);
    revert.click();
    revert.click();
    document.querySelector('[role="switch"]').click();
    assert.equal(writes.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(writes[0])), { hiddenSettingsPages: [] });
    assert.equal(document.querySelector("#integrations").style.display, "");
    rejectWrite(new Error("disk full"));
    await flush();
    assert.equal(revert.disabled, false);
    assert.equal(document.querySelector("#integrations").style.display, "none");
    assert.equal(nav.querySelector('[data-settings-panel-slug="mcp"]').style.display, "none");
    assert.equal(nav.querySelector('[data-codex-workflow="hidden-pages"] button').getAttribute("aria-expanded"), "false");
  } finally { harness.dom.window.close(); }
});

test("hidden settings and empty headings are suppressed before paint on delayed mounts and remounts", async () => {
  const harness = await createHarness({ nativeSidebar: true, delayedRoots: true, realObservers: true, initialSettings: { hiddenSettingsPages: ["voice", "mcp"] } });
  try {
    const { document, window, nav, deferAnimationFrames, flushAnimationFrame } = harness;
    const replacementShell = nav.closest("#settings-shell").cloneNode(true);
    const replacementVoice = nav.querySelector('[data-settings-panel-slug="voice"]').cloneNode(true);
    const assertSuppressed = () => {
      assert.equal(document.querySelector('[data-settings-panel-slug="voice"]').style.display, "none");
      assert.equal(document.querySelector("#integrations").style.display, "none");
      assert.equal(document.querySelectorAll('[data-codex-workflow="hidden-pages"]').length, 1);
    };
    deferAnimationFrames();
    window.requestAnimationFrame(harness.mountDelayedRoots);
    flushAnimationFrame();
    await flush();
    assertSuppressed();
    window.requestAnimationFrame(() => document.querySelector("#settings-shell").replaceWith(replacementShell));
    flushAnimationFrame();
    await flush();
    assertSuppressed();
    window.requestAnimationFrame(() => document.querySelector('[data-settings-panel-slug="voice"]').replaceWith(replacementVoice));
    flushAnimationFrame();
    await flush();
    assertSuppressed();
    harness.resumeAnimationFrames();
    flushAnimationFrame();
    await flush();
    const settled = harness.deliveredMutationCallbacks();
    await flush();
    assert.equal(harness.deliveredMutationCallbacks(), settled);
    assert.ok(settled < 60);
    assert.equal(harness.observers.some((observer) => observer.active && observer.target === document.documentElement), false);
  } finally {
    harness.observers.forEach((observer) => observer.disconnect());
    harness.dom.window.close();
  }
});

test("Done collapses Hidden without restoring pages or navigating away", async () => {
  const harness = await createHarness({ nativeSidebar: true, initialSettings: { hiddenSettingsPages: ["voice"] } });
  try {
    const { document, nav, invokedChannels } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    const edit = document.querySelector('[data-codex-workflow="sidebar-edit"]');
    const group = nav.querySelector('[data-codex-workflow="hidden-pages"]');
    const disclosure = group.querySelector("button");
    edit.click();
    assert.equal(disclosure.getAttribute("aria-expanded"), "true");
    edit.focus();
    edit.click();
    assert.equal(disclosure.getAttribute("aria-expanded"), "false");
    assert.equal(group.lastElementChild.hidden, true);
    assert.equal(document.activeElement, edit);
    assert.ok(document.querySelector('[data-codex-workflow-panel]'));
    assert.equal(nav.querySelector('[data-settings-panel-slug="voice"]').style.display, "none");
    assert.equal(invokedChannels.includes("codex-workflow:settings:set"), false);
    disclosure.click();
    assert.equal(group.lastElementChild.hidden, false);
    edit.click();
    edit.click();
    assert.equal(group.lastElementChild.hidden, true);
  } finally { harness.dom.window.close(); }
});

test("saved visibility survives attribute-only native resets before any observer or frame runs", async () => {
  const harness = await createHarness({ nativeSidebar: true, initialSettings: { hiddenSettingsPages: ["voice", "mcp"] } });
  try {
    const { document, window, nav } = harness;
    harness.deferAnimationFrames();
    const voice = nav.querySelector('[data-settings-panel-slug="voice"]');
    const section = document.querySelector("#integrations");
    voice.style.display = "";
    section.style.display = "";
    nav.parentElement.style.display = "none";
    nav.parentElement.style.display = "";
    assert.equal(window.getComputedStyle(voice).display, "none");
    assert.equal(window.getComputedStyle(section).display, "none");
    assert.notEqual(window.getComputedStyle(nav.querySelector('[data-settings-panel-slug="workflow"]')).display, "none");
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('[data-codex-workflow="sidebar-revert"]').click();
    await flush();
    assert.notEqual(window.getComputedStyle(voice).display, "none");
    assert.notEqual(window.getComputedStyle(section).display, "none");
  } finally { harness.dom.window.close(); }
});

test("first-paint visibility does not depend on Settings geometry or slow update IPC", async () => {
  let resolveUpdate;
  const harness = await createHarness({ nativeSidebar: true, delayedRoots: true,
    initialSettings: { hiddenSettingsPages: ["voice", "mcp"] },
    getUpdateStatus: () => new Promise((resolve) => { resolveUpdate = resolve; }),
  });
  try {
    const { document, window, nav } = harness;
    nav.getBoundingClientRect = () => ({ width: 0, height: 0, left: 0, right: 0, top: 0, bottom: 0 });
    harness.deferAnimationFrames();
    harness.mountDelayedRoots();
    const voice = nav.querySelector('[data-settings-panel-slug="voice"]');
    assert.equal(window.getComputedStyle(voice).display, "none");
    assert.equal(window.getComputedStyle(document.querySelector("#integrations")).display, "none");
    assert.equal(nav.querySelector('[data-codex-workflow="nav-item"]'), null);
    resolveUpdate({ available: false });
    await flush();
    assert.equal(window.getComputedStyle(voice).display, "none");
    delete nav.getBoundingClientRect;
    harness.resumeAnimationFrames();
    harness.flushAnimationFrame();
    await flush();
    assert.equal(nav.querySelectorAll('[data-codex-workflow="nav-item"]').length, 1);
    assert.equal(nav.querySelectorAll('[data-codex-workflow-page="voice"]').length, 1);
    assert.equal(voice.style.display, "none");
  } finally { harness.dom.window.close(); }
});

test("visibility CSS excludes lookalikes, search and disabled rows, and preserves native hiding", async () => {
  const harness = await createHarness({ nativeSidebar: true, initialSettings: { hiddenSettingsPages: ["voice"] } });
  try {
    const { document, window, nav, emitMutation } = harness;
    document.body.insertAdjacentHTML("beforeend", `<nav class="sidebar-navigation" aria-label="Settings"><button id="outside-voice" data-settings-panel-slug="voice">Voice</button></nav><div role="dialog"><aside class="app-shell-left-panel"><nav class="sidebar-navigation" aria-label="Settings"><button id="dialog-voice" data-settings-panel-slug="voice">Voice</button></nav></aside></div>`);
    const owner = document.querySelector("#settings-scroll");
    owner.insertAdjacentHTML("beforeend", '<button id="search-voice" data-list-navigation-item>Voice</button><button id="disabled-voice" data-settings-panel-slug="voice" disabled>Voice</button>');
    for (const id of ["outside-voice", "dialog-voice", "search-voice", "disabled-voice"]) {
      assert.notEqual(window.getComputedStyle(document.getElementById(id)).display, "none");
    }
    const style = document.createElement("style");
    style.textContent = ".native-hidden { display: none; }";
    document.head.append(style);
    const original = nav.querySelector('[data-settings-panel-slug="voice"]');
    const replacement = document.createElement("button");
    replacement.className = "native-hidden";
    replacement.dataset.settingsPanelSlug = "voice";
    replacement.textContent = "Voice";
    original.replaceWith(replacement);
    emitMutation(replacement.parentElement, { addedNodes: [replacement], removedNodes: [original] });
    assert.equal(nav.querySelector('[data-codex-workflow-page="voice"]'), null);
    assert.equal(replacement.style.display, "");
    assert.equal(window.getComputedStyle(replacement).display, "none");
    assert.equal(nav.hasAttribute("data-codex-workflow-sidebar-measuring"), false);
    assert.equal(document.querySelectorAll('style[data-codex-workflow="sidebar-visibility"]').length, 1);
  } finally { harness.dom.window.close(); }
});

test("Workflow Update uses the native sidebar hover-reveal pill", async () => {
  const harness = await createHarness({
    updateStatus: {
      available: true,
      installedVersion: "0.5.0",
      availableVersion: "0.5.1",
    },
  });
  try {
    const { document, window, emitMutation, invokedChannels } = harness;
    const toolbar = document.querySelector("#sidebar-toolbar");
    const pill = document.querySelector('[data-codex-workflow-update="true"]');
    const slot = document.querySelector('[data-codex-workflow-update-slot="true"]');
    assert.ok(pill);
    assert.equal(slot.parentElement, toolbar);
    assert.equal(pill.parentElement, slot);
    assert.ok(slot.className.includes("pointer-events-auto"));
    assert.ok(slot.className.includes("justify-end"));
    assert.ok(slot.className.includes("px-panel"));
    assert.equal(pill.getAttribute("aria-label"), "Workflow Update");
    assert.ok(pill.className.includes("bg-chart-blue"));
    assert.ok(pill.className.includes("pointer-events-auto"));
    assert.ok(pill.className.includes("grid-cols-[0fr]"));
    assert.ok(pill.className.includes("hover:grid-cols-[1fr]"));
    assert.ok(pill.querySelector('[data-codex-workflow-update-icon="true"]').className.includes("group-hover:opacity-0"));
    assert.ok(pill.querySelector('[data-codex-workflow-update-sliding-label="true"]').className.includes("group-hover:translate-x-0"));
    assert.equal(
      pill.querySelector('[data-codex-workflow-update-label="true"]').textContent,
      "Workflow Update",
    );

    const actions = document.querySelector("#toolbar-actions");
    const share = actions.querySelector('[aria-label="Share"]');
    const summary = actions.querySelector('[aria-label="Toggle summary"]');
    share.remove();
    summary.remove();
    emitMutation(document.querySelector("#top-toolbar"), { removedNodes: [share, summary] });
    await flush();
    assert.equal(pill.parentElement, slot);

    pill.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await flush();
    assert.ok(invokedChannels.includes("codex-workflow:update:install"));
    assert.equal(pill.disabled, true);
    assert.equal(pill.getAttribute("aria-label"), "Installing Workflow Update");
  } finally {
    harness.dom.window.close();
  }
});

test("Workflow Update follows the current global titlebar sidebar region", async () => {
  const harness = await createHarness({
    updateStatus: {
      available: true,
      installedVersion: "0.5.3",
      availableVersion: "0.5.4",
    },
  });
  try {
    const { document, emitMutation } = harness;
    const sidebar = document.querySelector(".app-shell-left-panel");
    sidebar.getBoundingClientRect = () => ({
      width: 275, height: 763, left: 0, right: 275, top: 0, bottom: 763,
    });
    const legacyToolbar = document.querySelector("#sidebar-toolbar");
    legacyToolbar.remove();
    emitMutation(sidebar, { removedNodes: [legacyToolbar] });
    await flush();
    assert.equal(document.querySelector('[data-codex-workflow-update="true"]'), null);

    const titlebar = document.querySelector("#top-toolbar");
    const dormantTitlebar = titlebar.cloneNode(false);
    dormantTitlebar.id = "dormant-top-toolbar";
    dormantTitlebar.innerHTML = '<div id="dormant-sidebar-region" style="visibility: hidden"></div>';
    dormantTitlebar.getBoundingClientRect = () => ({
      width: 1200, height: 46, left: 0, right: 1200, top: 0, bottom: 46,
    });
    const dormantRegion = dormantTitlebar.firstElementChild;
    dormantRegion.getBoundingClientRect = () => ({
      width: 275, height: 46, left: 0, right: 275, top: 0, bottom: 46,
    });
    titlebar.before(dormantTitlebar);
    titlebar.innerHTML = `
      <div id="sidebar-titlebar-region">
        <div id="sidebar-titlebar-controls-wrapper">
          <div id="sidebar-titlebar-controls" class="inline-flex h-full items-center pointer-events-none w-full">
            <button aria-label="Hide sidebar"></button>
            <button aria-label="Back"></button>
            <button aria-label="Forward"></button>
          </div>
        </div>
      </div>
      <div id="main-titlebar-region"></div>
    `;
    titlebar.getBoundingClientRect = () => ({
      width: 1200, height: 46, left: 0, right: 1200, top: 0, bottom: 46,
    });
    const region = titlebar.querySelector("#sidebar-titlebar-region");
    region.getBoundingClientRect = () => ({
      width: 275, height: 46, left: 0, right: 275, top: 0, bottom: 46,
    });
    const controls = titlebar.querySelector("#sidebar-titlebar-controls");
    const controlsWrapper = titlebar.querySelector("#sidebar-titlebar-controls-wrapper");
    const nativeControls = Array.from(controls.children);
    controlsWrapper.getBoundingClientRect = () => ({
      width: 275, height: 46, left: 0, right: 275, top: 0, bottom: 46,
    });
    controls.style.display = "inline-flex";
    controls.getBoundingClientRect = () => ({
      width: 187, height: 46, left: 88, right: 275, top: 0, bottom: 46,
    });
    emitMutation(titlebar, { addedNodes: [region] });
    await flush();

    const slot = document.querySelector('[data-codex-workflow-update-slot="true"]');
    const pill = document.querySelector('[data-codex-workflow-update="true"]');
    assert.equal(slot.parentElement, controls);
    assert.equal(slot.className.includes("no-drag"), true);
    assert.equal(slot.className.includes("fixed"), true);
    assert.equal(slot.className.includes("pe-3"), true);
    assert.equal(slot.className.includes("flex-1"), false);
    assert.equal(slot.className.includes("px-panel"), false);
    assert.deepEqual(Array.from(controls.children).slice(0, 3), nativeControls);
    assert.equal(slot.style.left, "0px");
    assert.equal(slot.style.top, "0px");
    assert.equal(slot.style.width, "275px");
    assert.equal(slot.style.height, "46px");
    assert.equal(pill.getAttribute("aria-label"), "Workflow Update");
    assert.equal(
      pill.querySelector('[data-codex-workflow-update-label="true"]').textContent,
      "Update",
    );

    slot.remove();
    emitMutation(controls, { removedNodes: [slot] });
    await flush();
    assert.equal(
      document.querySelectorAll('[data-codex-workflow-update="true"]').length,
      1,
    );

    const replacement = titlebar.cloneNode(true);
    replacement.id = "replacement-top-toolbar";
    replacement.querySelectorAll('[data-codex-workflow-update-slot="true"]').forEach((element) => element.remove());
    replacement.getBoundingClientRect = titlebar.getBoundingClientRect;
    const replacementRegion = replacement.querySelector("#sidebar-titlebar-region");
    replacementRegion.getBoundingClientRect = region.getBoundingClientRect;
    const replacementControls = replacement.querySelector("#sidebar-titlebar-controls");
    replacementControls.getBoundingClientRect = controls.getBoundingClientRect;
    const replacementControlsWrapper = replacement.querySelector("#sidebar-titlebar-controls-wrapper");
    replacementControlsWrapper.getBoundingClientRect = controlsWrapper.getBoundingClientRect;
    titlebar.replaceWith(replacement);
    emitMutation(document.body, { addedNodes: [replacement], removedNodes: [titlebar] });
    await flush();

    assert.equal(
      replacementControls.querySelectorAll('[data-codex-workflow-update="true"]').length,
      1,
    );
  } finally {
    harness.dom.window.close();
  }
});

test("Workflow Update is absent when no newer Workflow release exists", async () => {
  const harness = await createHarness({ updateStatus: { available: false } });
  try {
    assert.equal(
      harness.document.querySelector('[data-codex-workflow-update="true"]'),
      null,
    );
  } finally {
    harness.dom.window.close();
  }
});

test("stale Workflow Update disappears when the main process reports no update", async () => {
  const harness = await createHarness({
    updateStatus: {
      available: true,
      installedVersion: "0.5.3",
      availableVersion: "0.5.4",
    },
    installUpdateResult: { available: false },
  });
  try {
    const { document, invokedChannels, window } = harness;
    const pill = document.querySelector('[data-codex-workflow-update="true"]');
    assert.ok(pill);

    pill.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await flush();

    assert.ok(invokedChannels.includes("codex-workflow:update:install"));
    assert.equal(document.querySelector('[data-codex-workflow-update="true"]'), null);
    assert.equal(document.querySelector('[data-codex-workflow-update-slot="true"]'), null);
  } finally {
    harness.dom.window.close();
  }
});

test("Workflow participates in native keyboard navigation and clones active styling", async () => {
  const harness = await createHarness();
  try {
    const { document, nav, window } = harness;
    const general = nav.querySelector('[data-settings-panel-slug="general-settings"]');
    const appearance = nav.querySelector('[data-settings-panel-slug="appearance"]');
    const workflow = nav.querySelector('[data-settings-panel-slug="workflow"]');
    const voice = nav.querySelector('[data-settings-panel-slug="voice"]');
    assert.ok(workflow);

    appearance.focus();
    appearance.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    assert.equal(document.activeElement, workflow);
    assert.equal(workflow.getAttribute("aria-current"), "page");
    assert.equal(workflow.className, "nav active");
    assert.equal(general.className, "nav inactive");
    assert.ok(document.querySelector('[data-codex-workflow-panel="true"]'));

    workflow.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    assert.equal(document.activeElement, voice);
    assert.equal(voice.getAttribute("aria-current"), "page");
    assert.equal(document.querySelector('[data-codex-workflow-panel="true"]'), null);
    assert.equal(document.querySelector("#native-panel").style.display, "");
  } finally {
    harness.dom.window.close();
  }
});

test("Focused Interface exposes a native customize disclosure with unique switches", async () => {
  const harness = await createHarness();
  try {
    const { document, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();

    assert.equal(
      document.querySelector("#codex-workflow-focusedInterface-label").textContent,
      "Focused Interface",
    );
    assert.equal(
      document.querySelector("#codex-workflow-focusedInterface-description").textContent,
      "Hide optional Codex features and destinations to keep the interface focused on your workflow.",
    );

    const customize = document.querySelector('button[aria-controls="codex-workflow-focused-options"]');
    const master = document.querySelector('[aria-labelledby="codex-workflow-focusedInterface-label"]');
    assert.equal(customize.parentElement, master.parentElement);
    assert.equal(customize.nextElementSibling, master);
    const options = document.querySelector("#codex-workflow-focused-options");
    assert.equal(customize.getAttribute("aria-expanded"), "false");
    assert.equal(options.hidden, true);

    customize.click();
    assert.equal(customize.getAttribute("aria-expanded"), "true");
    assert.equal(options.hidden, false);
    assert.equal(document.querySelector("#codex-workflow-hidePullRequests-label").textContent, "Hide Pull requests");
    assert.equal(document.querySelector("#codex-workflow-hidePetMenuItem-label").textContent, "Hide pet controls");
    assert.equal(document.querySelector("#codex-workflow-hideInviteFriendMenuItem-label").textContent, "Hide friend invite");
    assert.equal(document.querySelector("#codex-workflow-replaceHelpWithSettings-label").textContent, "Replace Help with Settings");
    assert.equal(document.querySelector("#codex-workflow-hideComposerMicrophone-label").textContent, "Hide microphone button");
    assert.equal(
      document.querySelector("#codex-workflow-hideComposerMicrophone-description").textContent,
      "Remove the Dictate button from the composer.",
    );
    const interfaceCard = document.querySelector("#codex-workflow-focusedInterface-label")
      .closest("section").querySelector("[role='switch']").parentElement.parentElement.parentElement;
    const microphoneToggle = document.querySelector('[aria-labelledby="codex-workflow-hideComposerMicrophone-label"]');
    assert.equal(interfaceCard.contains(microphoneToggle), true);
    assert.equal(options.contains(microphoneToggle), false);

    const switches = Array.from(document.querySelectorAll('[role="switch"]'));
    assert.equal(switches.length, 6);
    assert.equal(new Set(switches.map((control) => control.getAttribute("aria-labelledby"))).size, 6);
    assert.equal(new Set(switches.map((control) => control.getAttribute("aria-describedby"))).size, 6);
  } finally {
    harness.dom.window.close();
  }
});

test("composer microphone preference hides only the idle button and restores it exactly", async () => {
  const harness = await createHarness({
    initialSettings: { hideComposerMicrophone: true },
  });
  try {
    const { document, emitMutation, nav, window } = harness;
    const dictate = document.querySelector("#composer-dictate");
    const actions = document.querySelector("#composer-actions");
    const originalActionsClass = actions.className;
    const modelSelector = document.querySelector("#model-reasoning-selector");
    const contextRing = document.querySelector("#context-window-ring");
    const submitSlot = document.querySelector("#composer-submit-slot");
    const outside = document.querySelector("#outside-dictate");

    assert.equal(dictate.style.getPropertyValue("display"), "none");
    assert.equal(dictate.style.getPropertyPriority("display"), "important");
    assert.equal(dictate.getAttribute("aria-hidden"), "true");
    assert.equal(dictate.getAttribute("tabindex"), "-1");
    assert.equal(dictate.dataset.codexWorkflowComposerMicrophoneHidden, "true");
    assert.equal(actions.className, originalActionsClass);
    assert.equal(actions.style.cssText, "");
    assert.equal(modelSelector.style.display, "");
    assert.equal(contextRing.style.display, "");
    assert.equal(submitSlot.style.display, "");
    assert.equal(outside.style.display, "");

    emitMutation(actions);
    emitMutation(actions);
    await flush();
    assert.equal(
      document.querySelectorAll('[data-codex-workflow-composer-microphone-hidden="true"]').length,
      1,
    );
    window.history.pushState({}, "", "#composer-route-change");
    assert.equal(dictate.style.getPropertyValue("display"), "none");

    dictate.setAttribute("aria-label", "Stop dictation");
    emitMutation(dictate);
    await flush();
    assert.equal(dictate.style.getPropertyValue("display"), "inline-flex");
    assert.equal(dictate.style.getPropertyPriority("display"), "important");
    assert.equal(dictate.getAttribute("aria-hidden"), "false");
    assert.equal(dictate.getAttribute("tabindex"), "4");

    dictate.setAttribute("aria-label", "Dictate");
    emitMutation(dictate);
    await flush();
    assert.equal(dictate.style.getPropertyValue("display"), "none");

    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    const toggle = document.querySelector('[aria-labelledby="codex-workflow-hideComposerMicrophone-label"]');
    toggle.click();
    await flush();
    assert.equal(toggle.getAttribute("aria-checked"), "false");
    assert.equal(dictate.style.getPropertyValue("display"), "inline-flex");
    assert.equal(dictate.style.getPropertyPriority("display"), "important");
    assert.equal(dictate.getAttribute("aria-hidden"), "false");
    assert.equal(dictate.getAttribute("tabindex"), "4");
    assert.equal(dictate.hasAttribute("data-codex-workflow-composer-microphone-hidden"), false);
    assert.equal(actions.className, originalActionsClass);
    assert.equal(modelSelector.parentElement.id, "composer-expanding-controls");
    assert.equal(contextRing.parentElement, actions);
    assert.equal(submitSlot.parentElement, actions);
  } finally {
    harness.dom.window.close();
  }
});

test("absent and ambiguous composer microphone targets are left untouched", async () => {
  const harness = await createHarness();
  try {
    const { document, emitMutation, nav } = harness;
    const actions = document.querySelector("#composer-actions");
    const original = document.querySelector("#composer-dictate");
    original.remove();
    emitMutation(actions, { removedNodes: [original] });

    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    const toggle = document.querySelector('[aria-labelledby="codex-workflow-hideComposerMicrophone-label"]');
    toggle.click();
    await flush();
    assert.equal(toggle.getAttribute("aria-checked"), "true");
    assert.equal(document.querySelector("#outside-dictate").style.display, "");

    const first = document.createElement("button");
    first.id = "ambiguous-dictate-one";
    first.setAttribute("aria-label", "Dictate");
    const second = document.createElement("button");
    second.id = "ambiguous-dictate-two";
    second.setAttribute("aria-label", "Dictate");
    actions.prepend(first, second);
    emitMutation(actions, { addedNodes: [first, second] });
    await flush();
    assert.equal(first.style.display, "");
    assert.equal(second.style.display, "");
    assert.equal(actions.style.cssText, "");

    second.remove();
    emitMutation(actions, { removedNodes: [second] });
    await flush();
    assert.equal(first.style.getPropertyValue("display"), "none");
    assert.equal(document.querySelector("#context-window-ring").style.display, "");
    assert.equal(document.querySelector("#composer-submit-slot").style.display, "");
  } finally {
    harness.dom.window.close();
  }
});

test("composer microphone preference follows composer root remounts", async () => {
  const harness = await createHarness({
    initialSettings: { hideComposerMicrophone: true },
  });
  try {
    const { document, emitMutation, observers } = harness;
    const oldRoot = document.querySelector("#primary-composer");
    const oldDictate = document.querySelector("#composer-dictate");
    const replacement = document.createElement("div");
    replacement.id = "replacement-composer";
    replacement.setAttribute("role", "presentation");
    replacement.dataset.composerLayout = "multiline";
    replacement.innerHTML = `
      <div data-composer-rows="inline">
        <div class="flex min-w-0 flex-1 justify-end"><button aria-label="Select model and reasoning"></button></div>
        <div class="flex shrink-0 items-center gap-2">
          <button id="remounted-dictate" aria-label="Dictate"></button>
          <div class="ms-2 flex items-center"><button id="remounted-submit" aria-label="Send"></button></div>
        </div>
      </div>
    `;
    oldRoot.replaceWith(replacement);
    emitMutation(document.body, { addedNodes: [replacement], removedNodes: [oldRoot] });
    await flush();

    const remounted = document.querySelector("#remounted-dictate");
    assert.equal(oldDictate.style.getPropertyValue("display"), "inline-flex");
    assert.equal(remounted.style.getPropertyValue("display"), "none");
    assert.equal(document.querySelector("#remounted-submit").style.display, "");
    assert.ok(!observers.some((observer) => observer.active && observer.target === oldRoot));
    assert.ok(observers.some((observer) => observer.active && observer.target === replacement && observer.options?.subtree));
  } finally {
    harness.dom.window.close();
  }
});

test("failed composer microphone persistence rolls back optimistic state and effect", async () => {
  let rejectWrite;
  let receivedPatch;
  const pendingWrite = new Promise((_resolve, reject) => {
    rejectWrite = reject;
  });
  const harness = await createHarness({
    setSettings: (patch) => {
      receivedPatch = patch;
      return pendingWrite;
    },
  });
  try {
    const { document, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    const toggle = document.querySelector('[aria-labelledby="codex-workflow-hideComposerMicrophone-label"]');
    const dictate = document.querySelector("#composer-dictate");
    toggle.click();

    assert.deepEqual(JSON.parse(JSON.stringify(receivedPatch)), { hideComposerMicrophone: true });
    assert.equal(toggle.getAttribute("aria-checked"), "true");
    assert.equal(toggle.disabled, true);
    assert.equal(dictate.style.getPropertyValue("display"), "none");

    rejectWrite(new Error("fixture write failed"));
    await flush();
    assert.equal(toggle.getAttribute("aria-checked"), "false");
    assert.equal(toggle.disabled, false);
    assert.equal(dictate.style.getPropertyValue("display"), "inline-flex");
    assert.equal(dictate.getAttribute("aria-hidden"), "false");
    assert.equal(dictate.getAttribute("tabindex"), "4");
  } finally {
    harness.dom.window.close();
  }
});

test("composer microphone preference remains usable when Focused Interface is off", async () => {
  const harness = await createHarness({
    initialSettings: { focusedInterface: false, hideComposerMicrophone: true },
  });
  try {
    const { document, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    const master = document.querySelector('[aria-labelledby="codex-workflow-focusedInterface-label"]');
    const microphone = document.querySelector('[aria-labelledby="codex-workflow-hideComposerMicrophone-label"]');
    assert.equal(master.getAttribute("aria-checked"), "false");
    assert.equal(microphone.getAttribute("aria-checked"), "true");
    assert.equal(microphone.disabled, false);
    assert.equal(document.querySelector("#composer-dictate").style.getPropertyValue("display"), "none");
  } finally {
    harness.dom.window.close();
  }
});

test("renderer normalisation keeps the microphone visible for malformed settings", async () => {
  const harness = await createHarness({
    initialSettings: { hideComposerMicrophone: "yes" },
  });
  try {
    const { document, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    const microphone = document.querySelector('[aria-labelledby="codex-workflow-hideComposerMicrophone-label"]');
    assert.equal(microphone.getAttribute("aria-checked"), "false");
    assert.equal(document.querySelector("#composer-dictate").style.getPropertyValue("display"), "inline-flex");
  } finally {
    harness.dom.window.close();
  }
});

test("legacy Efficiency mode state migrates to Focused Interface", async () => {
  const harness = await createHarness({
    initialSettings: { schemaVersion: 1, efficiencyMode: false },
  });
  try {
    const { document, nav } = harness;
    assert.equal(document.querySelector("#pull-requests").style.getPropertyValue("display"), "block");
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('button[aria-controls="codex-workflow-focused-options"]').click();

    const master = document.querySelector('[aria-labelledby="codex-workflow-focusedInterface-label"]');
    const pullRequests = document.querySelector('[aria-labelledby="codex-workflow-hidePullRequests-label"]');
    const petControls = document.querySelector('[aria-labelledby="codex-workflow-hidePetMenuItem-label"]');
    const friendInvite = document.querySelector('[aria-labelledby="codex-workflow-hideInviteFriendMenuItem-label"]');
    assert.equal(master.getAttribute("aria-checked"), "false");
    assert.equal(pullRequests.getAttribute("aria-checked"), "true");
    assert.equal(petControls.getAttribute("aria-checked"), "true");
    assert.equal(friendInvite.getAttribute("aria-checked"), "true");
    assert.equal(pullRequests.disabled, true);
    assert.equal(petControls.disabled, true);
    assert.equal(friendInvite.disabled, true);
  } finally {
    harness.dom.window.close();
  }
});

test("pet controls are hidden only in the account menu and restore exactly", async () => {
  const harness = await createHarness({
    initialSettings: {
      schemaVersion: 2,
      focusedInterface: true,
      hidePullRequests: true,
      hidePetMenuItem: true,
      hideInviteFriendMenuItem: true,
      replaceHelpWithSettings: false,
    },
  });
  try {
    const { document, emitMutation, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('button[aria-controls="codex-workflow-focused-options"]').click();
    document.querySelector("#account-menu-trigger").click();

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <div id="pet-menu-item" role="menuitem" style="display: flex !important" aria-hidden="false" tabindex="2"><svg aria-hidden="true"></svg><span>Show pet</span></div>
      <div role="menuitem"><svg aria-hidden="true"></svg><span>Settings</span><span>⌘,</span></div>
      <button role="menuitem">Log out</button>
    `;
    document.body.appendChild(menu);
    emitMutation(document.body, { addedNodes: [menu] });
    await flush();

    const petMenuItem = document.querySelector("#pet-menu-item");
    const petToggle = document.querySelector('[aria-labelledby="codex-workflow-hidePetMenuItem-label"]');
    assert.equal(petMenuItem.style.getPropertyValue("display"), "none");
    assert.equal(petMenuItem.style.getPropertyPriority("display"), "important");
    assert.equal(petMenuItem.getAttribute("aria-hidden"), "true");
    assert.equal(petMenuItem.getAttribute("tabindex"), "-1");
    assert.equal(menu.querySelector('[role="menuitem"]:nth-child(2)').style.display, "");

    petToggle.click();
    await flush();
    assert.equal(petMenuItem.style.getPropertyValue("display"), "flex");
    assert.equal(petMenuItem.style.getPropertyPriority("display"), "important");
    assert.equal(petMenuItem.getAttribute("aria-hidden"), "false");
    assert.equal(petMenuItem.getAttribute("tabindex"), "2");
    assert.equal(petMenuItem.hasAttribute("data-codex-workflow-pet-menu-hidden"), false);

    petMenuItem.querySelector("span").textContent = "Hide pet";
    petToggle.click();
    await flush();
    assert.equal(petMenuItem.style.getPropertyValue("display"), "none");
    assert.equal(petMenuItem.hasAttribute("data-codex-workflow-pet-menu-hidden"), true);
  } finally {
    harness.dom.window.close();
  }
});

test("friend invite is hidden before the account menu's first rendered frame and restores exactly", async () => {
  const harness = await createHarness();
  try {
    const { document, emitMutation, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('button[aria-controls="codex-workflow-focused-options"]').click();
    document.querySelector("#account-menu-trigger").click();

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <div id="usage-menu-item" role="menuitem">Usage</div>
      <div id="invite-friend-menu-item" role="menuitem" style="display: flex !important" aria-hidden="false" tabindex="4"><svg aria-hidden="true"></svg><span>Invite a friend</span></div>
      <div role="menuitem"><svg aria-hidden="true"></svg><span>Settings</span><span>⌘,</span></div>
      <button role="menuitem">Log out</button>
    `;
    document.body.appendChild(menu);
    emitMutation(document.body, { addedNodes: [menu] });

    const inviteItem = document.querySelector("#invite-friend-menu-item");
    const inviteToggle = document.querySelector('[aria-labelledby="codex-workflow-hideInviteFriendMenuItem-label"]');
    assert.equal(inviteItem.style.getPropertyValue("display"), "none");
    assert.equal(inviteItem.style.getPropertyPriority("display"), "important");
    assert.equal(inviteItem.getAttribute("aria-hidden"), "true");
    assert.equal(inviteItem.getAttribute("tabindex"), "-1");
    assert.equal(document.querySelector("#usage-menu-item").style.display, "");

    inviteToggle.click();
    await flush();
    assert.equal(inviteItem.style.getPropertyValue("display"), "flex");
    assert.equal(inviteItem.style.getPropertyPriority("display"), "important");
    assert.equal(inviteItem.getAttribute("aria-hidden"), "false");
    assert.equal(inviteItem.getAttribute("tabindex"), "4");
    assert.equal(inviteItem.hasAttribute("data-codex-workflow-invite-friend-menu-hidden"), false);

    inviteToggle.click();
    await flush();
    assert.equal(inviteItem.style.getPropertyValue("display"), "none");
    assert.equal(inviteItem.hasAttribute("data-codex-workflow-invite-friend-menu-hidden"), true);
  } finally {
    harness.dom.window.close();
  }
});

test("account menu discovery starts before the native pointerdown opener", async () => {
  const harness = await createHarness();
  try {
    const { document, window, emitMutation } = harness;
    const trigger = document.querySelector("#account-menu-trigger");
    let menu;
    trigger.addEventListener("pointerdown", () => {
      menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `
        <button id="pointerdown-pet-menu-item" role="menuitem">Show pet</button>
        <button id="pointerdown-invite-menu-item" role="menuitem">Invite a friend</button>
        <button role="menuitem">Settings</button>
      `;
      document.body.appendChild(menu);
      emitMutation(document.body, { addedNodes: [menu] });
    });

    trigger.dispatchEvent(new window.MouseEvent("pointerdown", {
      bubbles: true,
      button: 0,
    }));

    assert.equal(menu.querySelector("#pointerdown-pet-menu-item").style.display, "none");
    assert.equal(menu.querySelector("#pointerdown-invite-menu-item").style.display, "none");
  } finally {
    harness.dom.window.close();
  }
});

test("account menu discovery handles labels populated after portal mount", async () => {
  const harness = await createHarness();
  try {
    const { document, emitMutation } = harness;
    document.querySelector("#account-menu-trigger").click();

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const petItem = document.createElement("button");
    petItem.id = "late-pet-menu-item";
    petItem.setAttribute("role", "menuitem");
    const petLabel = document.createTextNode("");
    petItem.appendChild(petLabel);
    const inviteItem = document.createElement("button");
    inviteItem.id = "late-invite-menu-item";
    inviteItem.setAttribute("role", "menuitem");
    const inviteLabel = document.createTextNode("");
    inviteItem.appendChild(inviteLabel);
    const settingsItem = document.createElement("button");
    settingsItem.setAttribute("role", "menuitem");
    const settingsLabel = document.createTextNode("");
    settingsItem.appendChild(settingsLabel);
    menu.append(petItem, inviteItem, settingsItem);
    document.body.appendChild(menu);
    emitMutation(document.body, { addedNodes: [menu] });
    await flush();
    assert.equal(petItem.style.getPropertyValue("display"), "");
    assert.equal(inviteItem.style.getPropertyValue("display"), "");

    petLabel.nodeValue = "Show pet";
    inviteLabel.nodeValue = "Invite a friend";
    settingsLabel.nodeValue = "Settings";
    emitMutation(petLabel);
    emitMutation(inviteLabel);
    emitMutation(settingsLabel);
    await flush();
    assert.equal(petItem.style.getPropertyValue("display"), "none");
    assert.equal(petItem.getAttribute("aria-hidden"), "true");
    assert.equal(inviteItem.style.getPropertyValue("display"), "none");
    assert.equal(inviteItem.getAttribute("aria-hidden"), "true");
  } finally {
    harness.dom.window.close();
  }
});

test("account menu items are hidden before the first paint after a deferred portal mount", async () => {
  const harness = await createHarness();
  try {
    const {
      document,
      window,
      emitMutation,
      deferAnimationFrames,
      flushAnimationFrame,
    } = harness;
    deferAnimationFrames();
    document.querySelector("#account-menu-trigger").click();

    let petItem;
    let inviteItem;
    window.requestAnimationFrame(() => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `
        <button id="deferred-pet-menu-item" role="menuitem">Show pet</button>
        <button id="deferred-invite-menu-item" role="menuitem">Invite a friend</button>
        <button role="menuitem">Settings</button>
      `;
      document.body.appendChild(menu);
      petItem = menu.querySelector("#deferred-pet-menu-item");
      inviteItem = menu.querySelector("#deferred-invite-menu-item");
      emitMutation(document.body, { addedNodes: [menu] });
    });

    flushAnimationFrame();
    await flush();
    assert.equal(petItem.style.getPropertyValue("display"), "none");
    assert.equal(inviteItem.style.getPropertyValue("display"), "none");
  } finally {
    harness.dom.window.close();
  }
});

test("Help and Settings swap preserves native behavior, alignment, dismissal, and restoration", async () => {
  const harness = await createHarness();
  try {
    const { document, window, emitMutation, nav } = harness;
    const accountTrigger = document.querySelector("#account-menu-trigger");
    const shortcut = document.querySelector("#sidebar-help-trigger");
    let accountMenu = null;
    let helpMenu = null;
    let settingsOpenCount = 0;

    const unmountAccount = () => {
      if (!accountMenu) return;
      const removed = accountMenu;
      accountMenu = null;
      removed.remove();
      emitMutation(document.body, { removedNodes: [removed] });
    };
    const unmountHelp = () => {
      if (!helpMenu) return;
      const removed = helpMenu;
      helpMenu = null;
      removed.remove();
      emitMutation(document.body, { removedNodes: [removed] });
    };
    const mountAccount = () => {
      accountMenu = document.createElement("div");
      accountMenu.id = "native-account-menu";
      accountMenu.setAttribute("role", "menu");
      accountMenu.innerHTML = `
        <button id="native-settings-item" role="menuitem">
          <svg class="icon-xs" viewBox="0 0 20 20"><path d="native-settings"></path></svg>
          <span>Settings</span><span id="native-settings-shortcut">⌘,</span>
        </button>
        <button role="menuitem">Log out</button>
      `;
      accountMenu.getBoundingClientRect = () => ({
        width: 260, height: 300, left: 24, right: 284, top: 400, bottom: 700,
      });
      accountMenu.querySelector("#native-settings-item").addEventListener("click", () => {
        settingsOpenCount += 1;
        unmountAccount();
      });
      document.body.appendChild(accountMenu);
      emitMutation(document.body, { addedNodes: [accountMenu] });
    };
    const mountHelp = () => {
      helpMenu = document.createElement("div");
      helpMenu.id = "native-help-menu";
      helpMenu.setAttribute("role", "menu");
      helpMenu.innerHTML = `
        <div>What’s new</div>
        <div role="separator"></div>
        <button role="menuitem"><svg class="icon-xs"></svg><span>Set up Chrome extension</span></button>
        <button role="menuitem"><svg class="icon-xs"></svg><span>Keyboard shortcuts</span></button>
        <button role="menuitem"><svg class="icon-xs"></svg><span>Help</span></button>
      `;
      helpMenu.getBoundingClientRect = () => {
        const values = helpMenu.style.translate.match(/-?\d+(?:\.\d+)?/gu)?.map(Number) || [];
        const x = values[0] || 0;
        const y = values[1] || 0;
        return {
          width: 320, height: 300, left: 56 + x, right: 376 + x,
          top: 320 + y, bottom: 620 + y,
        };
      };
      document.body.appendChild(helpMenu);
      emitMutation(document.body, { addedNodes: [helpMenu] });
    };
    accountTrigger.addEventListener("click", () => {
      if (accountMenu) unmountAccount();
      else mountAccount();
    });
    accountTrigger.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown") return;
      if (accountMenu) unmountAccount();
      else mountAccount();
    });
    shortcut.addEventListener("click", () => {
      if (helpMenu) unmountHelp();
      else mountHelp();
    });
    shortcut.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown") return;
      if (helpMenu) unmountHelp();
      else mountHelp();
    });
    document.addEventListener("pointerdown", (event) => {
      if (helpMenu && !helpMenu.contains(event.target) && event.target !== shortcut) unmountHelp();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") unmountHelp();
      if (event.key === "Escape" && accountMenu) unmountAccount();
      if (event.metaKey && event.key === ",") {
        settingsOpenCount += 1;
        unmountAccount();
      }
    });

    assert.equal(shortcut.getAttribute("aria-label"), "Open settings");
    assert.equal(shortcut.className, "size-8 shrink-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0");
    assert.equal(shortcut.querySelector("svg").className.baseVal, "icon-sm");
    assert.equal(shortcut.querySelectorAll("svg path").length, 2);
    const firstGearPath = shortcut.querySelector("svg path");
    emitMutation(shortcut);
    await flush();
    assert.equal(shortcut.querySelector("svg path"), firstGearPath);

    shortcut.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    shortcut.dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
    await flush();
    assert.equal(settingsOpenCount, 1);
    assert.equal(accountMenu, null);
    assert.equal(helpMenu, null);
    assert.equal(harness.invokedChannels.filter((channel) =>
      channel === "codex-workflow:settings:activate").length, 1);

    accountTrigger.click();
    const helpUpdates = accountMenu.querySelector('[data-codex-workflow-help-updates="true"]');
    assert.ok(helpUpdates);
    assert.equal(helpUpdates.getAttribute("aria-label"), "Help & Updates");
    assert.equal(helpUpdates.textContent.includes("Settings"), false);
    assert.equal(helpUpdates.textContent.includes("Help & Updates"), true);
    assert.equal(helpUpdates.querySelectorAll("svg path").length, 2);
    assert.ok(Array.from(helpUpdates.querySelectorAll("*")).some((element) =>
      element.style.getPropertyValue("display") === "none" && element.getAttribute("aria-hidden") === "true"));

    helpUpdates.click();
    await flush();
    assert.equal(accountMenu, null);
    assert.ok(helpMenu);
    assert.equal(helpMenu.getBoundingClientRect().left, 24);
    assert.equal(helpMenu.getBoundingClientRect().bottom, 700);
    const back = helpMenu.querySelector('[data-codex-workflow-help-back="true"]');
    assert.ok(back);
    assert.equal(back.getAttribute("aria-label"), "Back");
    assert.equal(back.querySelector("svg").className.baseVal, "icon-xs");
    assert.equal(helpMenu.querySelectorAll('[data-codex-workflow-help-back="true"]').length, 1);

    back.click();
    await flush();
    assert.equal(helpMenu, null);
    assert.equal(accountMenu, null);

    accountTrigger.click();
    accountMenu.querySelector('[data-codex-workflow-help-updates="true"]').click();
    await flush();
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(helpMenu, null);

    accountTrigger.click();
    accountMenu.querySelector('[data-codex-workflow-help-updates="true"]').click();
    await flush();
    document.body.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    assert.equal(helpMenu, null);

    accountTrigger.click();
    accountMenu.querySelector('[data-codex-workflow-help-updates="true"]').click();
    await flush();
    accountTrigger.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    accountTrigger.click();
    assert.equal(helpMenu, null);
    assert.ok(accountMenu);
    assert.ok(accountMenu.querySelector('[data-codex-workflow-help-updates="true"]'));

    shortcut.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    shortcut.dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
    await flush();
    assert.equal(settingsOpenCount, 2);
    assert.equal(accountMenu, null);

    shortcut.focus();
    shortcut.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    shortcut.dispatchEvent(new window.MouseEvent("click", { bubbles: true, detail: 0 }));
    await flush();
    assert.equal(settingsOpenCount, 3);
    assert.equal(accountMenu, null);

    accountTrigger.click();
    assert.ok(accountMenu.querySelector('[data-codex-workflow-help-updates="true"]'));

    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('button[aria-controls="codex-workflow-focused-options"]').click();
    document.querySelector('[aria-labelledby="codex-workflow-replaceHelpWithSettings-label"]').click();
    await flush();
    assert.equal(shortcut.getAttribute("aria-label"), "Open help menu");
    assert.equal(shortcut.querySelector("path").getAttribute("d"), "native-question");
    assert.equal(accountMenu.querySelector("#native-settings-item").textContent.includes("Settings"), true);
    assert.equal(accountMenu.querySelector("#native-settings-shortcut").style.display, "");
  } finally {
    harness.dom.window.close();
  }
});

test("account-menu remounts cannot reintroduce Settings before paint", async () => {
  const harness = await createHarness();
  try {
    const { document, emitMutation } = harness;
    document.querySelector("#account-menu-trigger").click();
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <button id="remounted-settings" role="menuitem">
        <svg class="icon-xs"><path d="native-settings"></path></svg>
        <span>Settings</span><span>⌘,</span>
      </button>
      <button role="menuitem">Show pet</button>
      <button role="menuitem">Invite a friend</button>
    `;
    document.body.appendChild(menu);
    emitMutation(document.body, { addedNodes: [menu] });

    const item = menu.querySelector("#remounted-settings");
    let helpUpdates = menu.querySelector('[data-codex-workflow-help-updates="true"]');
    assert.equal(item.style.getPropertyValue("display"), "none");
    assert.equal(helpUpdates.textContent.includes("Settings"), false);
    assert.equal(helpUpdates.textContent.includes("Help & Updates"), true);

    const replacement = document.createElement("button");
    replacement.id = "remounted-settings-replacement";
    replacement.setAttribute("role", "menuitem");
    replacement.innerHTML = `
      <svg class="icon-xs"><path d="native-settings-remount"></path></svg>
      <span>Settings</span><span>⌘,</span>
    `;
    item.replaceWith(replacement);
    emitMutation(menu, { addedNodes: [replacement], removedNodes: [item] });
    helpUpdates = menu.querySelector('[data-codex-workflow-help-updates="true"]');
    assert.equal(item.isConnected, false);
    assert.equal(replacement.style.getPropertyValue("display"), "none");
    assert.equal(helpUpdates.textContent.includes("Settings"), false);
    assert.equal(helpUpdates.textContent.includes("Help & Updates"), true);
    assert.equal(menu.querySelectorAll('[data-codex-workflow-help-updates="true"]').length, 1);
  } finally {
    harness.dom.window.close();
  }
});

test("Focused Interface controls all configured interface effects", async () => {
  const harness = await createHarness();
  try {
    const { document, emitMutation, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('button[aria-controls="codex-workflow-focused-options"]').click();
    document.querySelector("#account-menu-trigger").click();

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <button id="pet-menu-item" role="menuitem">Show pet</button>
      <button id="invite-friend-menu-item" role="menuitem">Invite a friend</button>
      <button role="menuitem">Settings</button>
    `;
    document.body.appendChild(menu);
    emitMutation(document.body, { addedNodes: [menu] });
    await flush();

    const master = document.querySelector('[aria-labelledby="codex-workflow-focusedInterface-label"]');
    const childToggles = [
      document.querySelector('[aria-labelledby="codex-workflow-hidePullRequests-label"]'),
      document.querySelector('[aria-labelledby="codex-workflow-hidePetMenuItem-label"]'),
      document.querySelector('[aria-labelledby="codex-workflow-hideInviteFriendMenuItem-label"]'),
    ];
    const pullRequests = document.querySelector("#pull-requests");
    const petMenuItem = document.querySelector("#pet-menu-item");
    const inviteItem = document.querySelector("#invite-friend-menu-item");
    assert.equal(pullRequests.style.getPropertyValue("display"), "none");
    assert.equal(petMenuItem.style.getPropertyValue("display"), "none");
    assert.equal(inviteItem.style.getPropertyValue("display"), "none");

    master.click();
    await flush();
    assert.equal(master.getAttribute("aria-checked"), "false");
    assert.ok(childToggles.every((toggle) => toggle.disabled));
    assert.equal(pullRequests.style.getPropertyValue("display"), "block");
    assert.equal(petMenuItem.style.getPropertyValue("display"), "");
    assert.equal(inviteItem.style.getPropertyValue("display"), "");

    master.click();
    await flush();
    assert.equal(master.getAttribute("aria-checked"), "true");
    assert.ok(childToggles.every((toggle) => !toggle.disabled));
    assert.equal(pullRequests.style.getPropertyValue("display"), "none");
    assert.equal(petMenuItem.style.getPropertyValue("display"), "none");
    assert.equal(inviteItem.style.getPropertyValue("display"), "none");
  } finally {
    harness.dom.window.close();
  }
});

test("ambiguous pet menu targets are left untouched", async () => {
  const harness = await createHarness();
  try {
    const { document, emitMutation } = harness;
    document.querySelector("#account-menu-trigger").click();
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <button role="menuitem">Show pet</button>
      <button role="menuitem">Hide pet</button>
      <button role="menuitem">Settings</button>
    `;
    document.body.appendChild(menu);
    emitMutation(document.body, { addedNodes: [menu] });
    await flush();
    const petItems = menu.querySelectorAll('[role="menuitem"]');
    assert.equal(petItems[0].style.display, "");
    assert.equal(petItems[1].style.display, "");
  } finally {
    harness.dom.window.close();
  }
});

test("ambiguous friend invite targets are left untouched", async () => {
  const harness = await createHarness();
  try {
    const { document, emitMutation } = harness;
    document.querySelector("#account-menu-trigger").click();
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <button role="menuitem">Invite a friend</button>
      <button role="menuitem" aria-label="Invite a friend">Invite</button>
      <button role="menuitem">Settings</button>
    `;
    document.body.appendChild(menu);
    emitMutation(document.body, { addedNodes: [menu] });
    await flush();
    const inviteItems = menu.querySelectorAll('[role="menuitem"]');
    assert.equal(inviteItems[0].style.display, "");
    assert.equal(inviteItems[1].style.display, "");
  } finally {
    harness.dom.window.close();
  }
});

test("failed pet preference persistence restores its switch and menu effect", async () => {
  const harness = await createHarness({
    setSettings: () => Promise.reject(new Error("fixture write failed")),
  });
  try {
    const { document, emitMutation, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('button[aria-controls="codex-workflow-focused-options"]').click();
    document.querySelector("#account-menu-trigger").click();

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <button id="pet-menu-item" role="menuitem">Show pet</button>
      <button role="menuitem">Settings</button>
    `;
    document.body.appendChild(menu);
    emitMutation(document.body, { addedNodes: [menu] });
    await flush();

    const petMenuItem = document.querySelector("#pet-menu-item");
    const petToggle = document.querySelector('[aria-labelledby="codex-workflow-hidePetMenuItem-label"]');
    assert.equal(petMenuItem.style.getPropertyValue("display"), "none");
    petToggle.click();
    await flush();
    assert.equal(petToggle.getAttribute("aria-checked"), "true");
    assert.equal(petToggle.disabled, false);
    assert.equal(petMenuItem.style.getPropertyValue("display"), "none");
    assert.equal(petMenuItem.getAttribute("aria-hidden"), "true");
  } finally {
    harness.dom.window.close();
  }
});

test("failed friend invite preference persistence restores its switch and menu effect", async () => {
  const harness = await createHarness({
    setSettings: () => Promise.reject(new Error("fixture write failed")),
  });
  try {
    const { document, emitMutation, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('button[aria-controls="codex-workflow-focused-options"]').click();
    document.querySelector("#account-menu-trigger").click();

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <button id="invite-friend-menu-item" role="menuitem">Invite a friend</button>
      <button role="menuitem">Settings</button>
    `;
    document.body.appendChild(menu);
    emitMutation(document.body, { addedNodes: [menu] });
    await flush();

    const inviteItem = document.querySelector("#invite-friend-menu-item");
    const inviteToggle = document.querySelector('[aria-labelledby="codex-workflow-hideInviteFriendMenuItem-label"]');
    assert.equal(inviteItem.style.getPropertyValue("display"), "none");
    inviteToggle.click();
    await flush();
    assert.equal(inviteToggle.getAttribute("aria-checked"), "true");
    assert.equal(inviteToggle.disabled, false);
    assert.equal(inviteItem.style.getPropertyValue("display"), "none");
    assert.equal(inviteItem.getAttribute("aria-hidden"), "true");
  } finally {
    harness.dom.window.close();
  }
});

test("failed Help and Settings preference persistence restores both native surfaces", async () => {
  const harness = await createHarness({
    setSettings: () => Promise.reject(new Error("fixture write failed")),
  });
  try {
    const { document, emitMutation, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('button[aria-controls="codex-workflow-focused-options"]').click();
    document.querySelector("#account-menu-trigger").click();
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <button id="rollback-settings-item" role="menuitem">
        <svg class="icon-xs"><path d="native-settings"></path></svg>
        <span>Settings</span><span>⌘,</span>
      </button>
    `;
    document.body.appendChild(menu);
    emitMutation(document.body, { addedNodes: [menu] });

    const toggle = document.querySelector('[aria-labelledby="codex-workflow-replaceHelpWithSettings-label"]');
    const shortcut = document.querySelector("#sidebar-help-trigger");
    assert.equal(shortcut.getAttribute("aria-label"), "Open settings");
    assert.ok(menu.querySelector('[data-codex-workflow-help-updates="true"]'));

    toggle.click();
    await flush();
    assert.equal(toggle.getAttribute("aria-checked"), "true");
    assert.equal(toggle.disabled, false);
    assert.equal(shortcut.getAttribute("aria-label"), "Open settings");
    const restoredHelp = menu.querySelector('[data-codex-workflow-help-updates="true"]');
    assert.ok(restoredHelp);
    assert.equal(restoredHelp.textContent.includes("Settings"), false);
    assert.equal(menu.querySelector("#rollback-settings-item").style.getPropertyValue("display"), "none");
  } finally {
    harness.dom.window.close();
  }
});

test("failed settings persistence rolls the switch and sidebar effect back", async () => {
  const harness = await createHarness({
    setSettings: () => Promise.reject(new Error("fixture write failed")),
  });
  try {
    const { document, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    const toggle = document.querySelector('[role="switch"]');
    const pullRequests = document.querySelector("#pull-requests");
    assert.equal(toggle.getAttribute("aria-checked"), "true");
    assert.equal(pullRequests.style.getPropertyValue("display"), "none");

    toggle.click();
    await flush();
    assert.equal(toggle.getAttribute("aria-checked"), "true");
    assert.equal(toggle.disabled, false);
    assert.equal(pullRequests.style.getPropertyValue("display"), "none");
    assert.equal(pullRequests.style.getPropertyPriority("display"), "important");
    assert.equal(pullRequests.getAttribute("aria-hidden"), "true");
    assert.equal(pullRequests.getAttribute("tabindex"), "-1");
  } finally {
    harness.dom.window.close();
  }
});

test("route and native settings changes restore the original view", async () => {
  const harness = await createHarness();
  try {
    const { document, nav, window } = harness;
    const workflow = nav.querySelector('[data-settings-panel-slug="workflow"]');
    workflow.click();
    window.history.pushState({}, "", "#projects");
    assert.equal(document.querySelector('[data-codex-workflow-panel="true"]'), null);
    assert.equal(document.querySelector("#native-panel").style.display, "");

    workflow.click();
    nav.querySelector('[data-settings-panel-slug="general-settings"]').removeAttribute("aria-current");
    nav.querySelector('[data-settings-panel-slug="appearance"]').setAttribute("aria-current", "page");
    window.history.replaceState({}, "", "#projects");
    assert.equal(document.querySelector('[data-codex-workflow-panel="true"]'), null);
    assert.equal(document.querySelector("#native-panel").style.display, "");
  } finally {
    harness.dom.window.close();
  }
});

test("root discovery remains active through a slow Codex route mount", async () => {
  const harness = await createHarness({ delayedRoots: true });
  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      assert.equal(harness.runNextTimeout(), true);
    }
    assert.equal(harness.runNextTimeout(), false);
    assert.ok(harness.observers.some((observer) =>
      observer.active && observer.target === harness.document.documentElement));
    harness.mountDelayedRoots();
    await flush();
    assert.equal(harness.document.querySelector("#pull-requests").style.getPropertyValue("display"), "none");
    assert.equal(harness.document.querySelector("#sidebar-help-trigger").getAttribute("aria-label"), "Open settings");
    assert.ok(harness.nav.querySelector('[data-settings-panel-slug="workflow"]'));
  } finally {
    harness.dom.window.close();
  }
});

test("scoped observers ignore 120 response-stream mutations", async () => {
  const harness = await createHarness();
  try {
    const { document, observers, intervalCalls, emitMutation, deliveredMutationCallbacks } = harness;
    const sidebar = document.querySelector(".app-shell-left-panel");
    const settingsShell = document.querySelector("#settings-shell");
    const composer = document.querySelector("#primary-composer");
    const activeSubtreeTargets = observers
      .filter((observer) => observer.active && observer.options?.subtree)
      .map((observer) => observer.target);

    assert.equal(intervalCalls.length, 0);
    assert.deepEqual(new Set(activeSubtreeTargets), new Set([sidebar, settingsShell, composer]));
    assert.ok(!activeSubtreeTargets.includes(document.documentElement));

    const beforeCallbacks = deliveredMutationCallbacks();
    const responseStream = document.querySelector("#response-stream");
    for (let index = 0; index < 120; index += 1) {
      const streamed = document.createElement("p");
      responseStream.appendChild(streamed);
      emitMutation(responseStream, { addedNodes: [streamed] });
    }
    await flush();
    assert.equal(deliveredMutationCallbacks(), beforeCallbacks);

    const remountedRow = document.createElement("div");
    remountedRow.className = "sidebar-item";
    remountedRow.innerHTML = '<a href="/pull-requests"><span class="text-fade-truncate">Pull requests</span></a>';
    sidebar.appendChild(remountedRow);
    emitMutation(sidebar, { addedNodes: [remountedRow] });
    await flush();
    assert.equal(remountedRow.style.getPropertyValue("display"), "none");
    assert.equal(deliveredMutationCallbacks(), beforeCallbacks + 1);
  } finally {
    harness.dom.window.close();
  }
});

test("scoped roots rebind after sidebar and settings remounts", async () => {
  const harness = await createHarness();
  try {
    const { document, observers, emitMutation } = harness;
    const oldSidebar = document.querySelector(".app-shell-left-panel");
    const newSidebar = document.createElement("aside");
    newSidebar.className = "app-shell-left-panel";
    newSidebar.innerHTML = '<div class="sidebar-item"><a href="/pull-requests"><span class="text-fade-truncate">Pull requests</span></a></div>';
    oldSidebar.replaceWith(newSidebar);
    emitMutation(document.body, { addedNodes: [newSidebar], removedNodes: [oldSidebar] });
    await flush();
    assert.equal(
      newSidebar.querySelector(".sidebar-item").style.getPropertyValue("display"),
      "none",
    );
    assert.ok(!observers.some((observer) => observer.active && observer.target === oldSidebar));

    const oldShell = document.querySelector("#settings-shell");
    const newShell = oldShell.cloneNode(true);
    newShell.querySelectorAll("[data-codex-workflow], [data-codex-workflow-panel]")
      .forEach((element) => element.remove());
    oldShell.replaceWith(newShell);
    emitMutation(document.body, { addedNodes: [newShell], removedNodes: [oldShell] });
    await flush();
    assert.equal(newShell.querySelectorAll('[data-settings-panel-slug="workflow"]').length, 1);
    assert.ok(!observers.some((observer) => observer.active && observer.target === oldShell));
  } finally {
    harness.dom.window.close();
  }
});
