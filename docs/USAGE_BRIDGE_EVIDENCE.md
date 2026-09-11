# Usage bridge evidence — 26.901.41600 / 7982

Investigation and delegated source implementation, 8 September 2026. Source baseline: isolated worktree `workflow-usage-bridge`. Changed only the new self-contained `installNativeUsageBridge(enabled)` function before `isTopFrame` in `runtime/preload.cjs`, `tests/usage-bridge.test.mjs`, and this evidence document. This worker performed no app interaction, bundle mutation, account request, credential access, or account payload capture.

## Decision

Use the audited **main-world ESM exports**: `rp()` returns the mounted route scope, which exposes the existing QueryClient and inherited AppScope bindings. This enables cached `rate-limit-status` reads/subscriptions and the native registered request client. The integration owner reported its isolated staging probe passed: mounted scope, QueryClient, successful cache, registered client, and actual core window fields. This worker did not independently execute the probe in Electron.

Avoid the raw-IPC prototype below: it bypasses the renderer request registry and introduces unknown-ID logs, timeout cleanup and chunk handling. The ESM route reuses all of that native machinery.

The actual feature contract is the shortest plan rate window, with an exhausted longer window overriding it. Monthly-duration windows are supported when present. The current bundled schema has **no `monthlyLimit` field**; monthly dollar/spend/credit aggregation is outside this contract.

## Preferred ESM bridge and executable test

All aliases below are verified against the final export statement of `webview/assets/app-initial-86767c3d23e5.js` in the inspected ASAR. They are build-specific, not stable product APIs.

| Export | Native symbol / offset | Contract |
| --- | --- | --- |
| `rp` | `u7o`, 8828912 | Non-hook getter returning current mounted route scope `g7o`, or null. |
| `j1t` | `Eb`, 2282520 vicinity | `scope.get(Db).forHost(hostId)`: existing registered app-server client. |
| `VDt` | `SP`, 4086870 vicinity | Existing native `['rate-limit-status']` query definition. |
| `Run` | `U`, 50300 vicinity | Existing message dispatcher; `dispatchHostMessage` routes navigation internally. |
| `vP` | `QQa`, 7397000 vicinity | Native raw-usage conversion to core and named/model-limited snapshot entries. |
| `gP` | `e$a`, 7397600 vicinity | Picks relevant blocked model bucket, otherwise core, using selectedModel/activeLimitName. |
| `pP` | `$Qa`, 7397400 vicinity | Filters entries to core plus selected model/active limit. |
| `bP` | `ZQa`, 7396860 vicinity | Reads/trims raw `rate_limit_name`. |
| `m0` | `EW`, 5696870 vicinity | Native asynchronous auth-method check; requires scope + host. |
| `N1t` | `Q` | AppScope token, **not** a mounted instance. |
| `r0t` / `e0t` | `hb` / `gb` | React scope/query-client hooks: do not invoke outside React. |

Getter provenance: `l7o(scope)` at 8828814 sets `g7o` and returns cleanup that clears it only if still owned by that scope. `b7o` at 8830000 calls `hb(Lj)` and unconditionally registers `l7o(n)` in its effect. `allowDebugMenu` gates debug controls, not this registration. The shell renders `b7o` except `/debug` and the special `VPs` window condition (9582700 vicinity). A null scope during startup/unmount or those routes is a supported unavailable state; do not create a new scope or scan fibers.

The scope returned by `hb` has `queryClient`, `get`, `query`, `watch`, and its parent scope chain. `lb` at 2271400 inherits `parent.queryClient`; `QNs` at 9564000 constructs one QueryClient using `useState(nPs)`. Thus ordinary route remounts replace the route scope while retaining the app's query client. Reacquire `rp()` for each imperative operation; cache-subscription ownership should follow QueryClient identity, not route-scope object identity.

Run this exact **main-world** expression in isolated staging. It returns shapes/booleans only and makes no account/network request:

```js
(async () => {
  const links = document.querySelectorAll(
    'link[rel="modulepreload"][href="./assets/app-initial-86767c3d23e5.js"]'
  );
  if (links.length !== 1) return {ready: false, reason: 'asset-identity'};
  const m = await import(links[0].href);
  const scope = m.rp();
  if (!scope) return {ready: false, reason: 'scope-not-mounted'};
  const client = scope.queryClient;
  const state = client.getQueryState(['rate-limit-status']);
  return {
    ready: typeof client.getQueryCache === 'function',
    registeredClient: typeof m.j1t(scope, 'local')?.sendRequest === 'function',
    nativeQuery: scope.query.getOptions(m.VDt).queryKey.join('/') === 'rate-limit-status',
    cached: state?.data != null,
    status: state?.status ?? null,
    fetchStatus: state?.fetchStatus ?? null,
    // Field names only: no account IDs, balances, or full payloads.
    windowFields: Object.keys(state?.data?.rate_limit?.primary_window ?? {}),
  };
})()
```

The single exact `link` comes from `webview/index.html`; it uses that relative href verbatim. Resolve its `.href` rather than guessing the app protocol host or route-relative asset base. A static string containing this expression may be passed to `require('electron').webFrame.executeJavaScript(...)`. Keep the string fixed, validate the exact app build/asset, and serialize only an allowlisted projection back to preload. Never expose code, module URL, method, query key, or navigation arguments as a generic renderer-controlled bridge.

Once `m` is imported in the main world, these are the concrete reusable operations:

```js
// Cached read: no network, no new QueryClient.
const scope = m.rp();
const cached = scope.queryClient.getQueryData(['rate-limit-status']);
// Equivalent native scoped accessor:
const sameCached = scope.query.getData(m.VDt);

// Native fetch machinery; respects native staleTime and deduplicates.
await scope.query.fetch(m.VDt);

// Force an existing query to refresh, only on explicit refresh/invalidating event.
await scope.queryClient.refetchQueries({
  queryKey: ['rate-limit-status'], exact: true, type: 'all',
});

// Registered app-server request, if needed instead of the renderer query.
const response = await m.j1t(m.rp(), 'local').sendRequest(
  'account/rateLimits/read', undefined, {timeoutMs: 10000}
);

// Actual native navigation dispatcher, no synthetic IPC response handling.
m.Run.dispatchHostMessage({type: 'navigate-to-route', path: '/settings/usage'});
```

Subscribe **before** reading cache to avoid a missed-update gap. `getQueryCache().subscribe` returns an unsubscribe function. Filter events to the exact one-element query key and never enumerate all cached queries or copy unrelated data:

```js
const client = m.rp().queryClient;
const unsubscribe = client.getQueryCache().subscribe(event => {
  const key = event.query?.queryKey;
  if (key?.length === 1 && key[0] === 'rate-limit-status') publishProjection();
});
publishProjection();
// On disable/page unload or replacement of QueryClient: unsubscribe().
```

Cache subscription is passive: it does not make an inactive query an active polling observer. Use an initial `scope.query.fetch(m.VDt)` when cache is missing/stale; rely on existing native observers when present. If this feature must sustain native polling without another observer, use the existing scoped query reader `scope.watch(({get}) => { get(m.VDt); publishProjection(); })` and retain its returned disposer. `scope.watch` uses the native reactive subscription at 2270670; it is a provisional alternative requiring staging proof of polling, cleanup, and route-scope replacement. Do not layer another interval over the native query scheduler.

Publish only validated percentage/window/reset metadata to the isolated preload through a fixed event or fixed return value; retain the module, scope and QueryClient in the main world. Fixed enable/disable/refresh/navigation operations must own and dispose their listeners, deduplicate reads, reject stale completion after disable/account change, and stop showing stale cache on error. Do not log query payloads or raw native exceptions.

### Exact current plan-window projection

Raw cached query fields:

```text
rate_limit: {allowed, limit_reached, primary_window, secondary_window}
primary_window / secondary_window:
  {used_percent, limit_window_seconds, reset_at, reset_after_seconds}
additional_rate_limits[]:
  {limit_name, metered_feature, rate_limit: <same rate-window structure>}
rate_limit_name: current named rate limit, if supplied
```

Core plan windows come only from `raw.rate_limit.primary_window/secondary_window`. Validate finite `used_percent` and positive finite `limit_window_seconds`; convert duration by `/60`, preserve null reset timestamps and percentage zero. Five-hour/weekly/monthly labels follow actual durations (300 / 10080 / approximately 43200 minutes), not primary/secondary slot names.

For the requested global plan indicator: choose the shortest valid core window; if a longer valid core window has `used_percent >= 100`, show an exhausted longer window instead. Never aggregate `additional_rate_limits`, purchased credits, `individualLimit`, or sidebar monthly warnings into that plan percentage. Model-specific state needs explicit model identity: native `vP` preserves named entries and `gP` / `pP` select/filter a relevant model instead of allowing an unrelated exhausted bucket to override every task. Native conversion defaults absent `used_percent` to zero, so validate raw numeric availability before using converted snapshots for Workflow.

## Generated bundled protocol schema

The integration owner generated `Resources/codex app-server generate-json-schema --experimental --out /private/tmp/workflow-usage-schema-20260908`; this worker read the target definitions there. The CLI help was inspected first; no server/account session was started.

`v2/GetAccountRateLimitsResponse.json` requires `rateLimits`; optional properties are `accountId`, `rateLimitResetCredits`, `rateLimitUpsell`, and nullable `rateLimitsByLimitId` (map of snapshots). `RateLimitSnapshot` contains exactly these nine properties: `limitId`, `limitName`, `primary`, `secondary`, `credits`, `individualLimit`, `spendControlReached`, `planType`, `rateLimitReachedType`. There is **no `monthlyLimit`** in this build's generated snapshot schema.

`RateLimitWindow` requires integer `usedPercent`; nullable integer `windowDurationMins` and `resetsAt` are optional. `v2/AccountRateLimitsUpdatedNotification.json` requires `{rateLimits: RateLimitSnapshot}` and explicitly describes it as a **sparse rolling update**: merge available values into the previous read or refetch; unavailable nullable metadata does not clear previously observed values. Thus the notification envelope's `params` shape is now proven. Refetching avoids inventing sparse merge semantics.

## Installed-source references

Paths below are entries **inside** `/Applications/ChatGPT.app/Contents/Resources/app.asar`. Offsets are zero-based JavaScript string offsets from `extractFile(...).toString()`, not stable byte offsets or line numbers. Exact search anchors remain the preferred locator.

| Entry | Offset / anchor | Evidence |
| --- | --- | --- |
| `.vite/build/preload.js` | 1679, `codex_desktop:message-from-view`; 2420, `sendMessageFromView` | `electronBridge.sendMessageFromView` awaits `ipcRenderer.invoke` and does not return its result. |
| `.vite/build/preload.js` | `ipcRenderer.on(S`; `exposeInMainWorld` | Main-to-view channel is `codex_desktop:message-for-view`. Each payload is dispatched as `new MessageEvent('message', {data: payload})`. Main-world API name is **`electronBridge`**, not `electron-api`. |
| `.vite/build/main-C5K7o1Hr.js` | 2645029, `ipcMain.handle(r.tt` | Trusted IPC event check, then lookup of the sender's window context and `handleMessage(sender, message)`. |
| `.vite/build/main-C5K7o1Hr.js` | 1922305, `case\`mcp-request\`` | Uses existing host app-server connection and `handleClientRequest`; forwards priority/source/timeout/expiry options. |
| `.vite/build/main-C5K7o1Hr.js` | 1940467, `sendAppServerResponseToView` | Native delivery failure also returns a correlated `mcp-response`, with error code `-32000`. |
| `.vite/build/src-VqXTPopo.js` | 976324, `sendClientResponse`; 1070022, `type:\`mcp-notification\`` | Response and notification envelopes below. |
| `webview/assets/app-initial-86767c3d23e5.js` | 5697735, `sendRequest(\`account/rateLimits/read\`,void 0)` | Native `get_usage_limits` implementation calls this method with no parameters, after its ChatGPT-auth guard. |
| Same | 3254783, `dispatchMessage?.(\`mcp-request\`` | Native request envelope and registry-backed caller. |
| Same | 3248274, `onResult(e,t,n)`; 3249139, `onError(e,t,n)` | Unknown response IDs produce a native error log; raw preload requests are not registered here. |
| Same | 49038, `function A`; 9143650–9144900, `z(\`navigate-to-route\`,E)` | Window message acceptance and actual React Router navigation handler. |
| `webview/assets/app-primary-139889e10fbd.js` | 2548192, `function iln` | Native usage CTA dispatches `{type:'navigate-to-route',path:'/settings/usage'}` internally. |

Package version was read from `package.json`; build `7982` from `Contents/Info.plist/CFBundleVersion`. SHA-256 of the inspected entries:

```text
.vite/build/preload.js
6418d42c99961587e70f644f9757e7a2c124b4bf09a39ed75ca11a7dedffdc49
.vite/build/main-C5K7o1Hr.js
1a12a4625ca931b86befd0c40e3ab1b17355bbb8ef87092b1d239e0439ce0d26
.vite/build/src-VqXTPopo.js
8d056524ea3f5714e5e0a254afd88f018d58465bc6ea026adee3c80ff7799e29
webview/assets/app-initial-86767c3d23e5.js
fb72076ee44f6596f8dafa9a3effe37a3527a87db21fde8b4042233957b554bb
webview/assets/settings-5bce25bbd38e.js
d8f3256aacbe40dc299ad9ddd9511747b22c9a8e8ee71b2335178e0a132b7960
```

## Request, response, and event contracts

Fixed request from Workflow's existing `require('electron').ipcRenderer`:

```js
ipcRenderer.invoke('codex_desktop:message-from-view', {
  type: 'mcp-request',
  hostId: 'local',
  request: {
    id: 'codex-workflow-usage:' + crypto.randomUUID(),
    method: 'account/rateLimits/read',
    // Native caller passes undefined; omit params.
  },
  source: 'account',
  priority: 'interactive',
  timeoutMs: 10000,
  expiresAtMs: Date.now() + 10000,
});
```

Do not await `invoke` as the data result. Success/error data arrives separately:

```js
// codex_desktop:message-for-view -> native window MessageEvent
{
  type: 'mcp-response',
  hostId: 'local',
  message: { id: requestId, result: resultObject },
  // Or message: { id: requestId, error: { code, message, ... } }
  // Optional hostMetrics; tracing fields only when a trace was supplied.
}

{
  type: 'mcp-notification',
  hostId: 'local',
  method: 'account/rateLimits/updated',
  params: notificationParams,
}
```

Native tool copy explicitly documents result fields `rateLimitsByLimitId` (preferred), legacy `rateLimits`, and window fields `usedPercent`, `windowDurationMins`, `resetsAt` (Unix seconds). Native window helpers consume `primary` and `secondary`. Preserve bucket identity and missing/null values; never treat absent values as zero usage. Remaining percentage is clamped `100 - usedPercent` after finite-number validation.

The generated bundled schema above resolves the payload: `notificationParams` is `{rateLimits: RateLimitSnapshot}` with sparse-update semantics. The implementation merges only validated matching core windows into an established local-account snapshot, then coalesces a native query refresh. Do not invent `account/usage/read` parameters: only a method-to-priority-category listing was found for that method.

The main connection broadcasts `account/rateLimits/updated`; no subscription request is needed. Listen only while the feature is enabled. Clear cached display on local `account/updated` or disconnected `codex-app-server-connection-changed`; do not mix local and remote host events. Production notification timing/frequency was not tested.

## Executable staging prototype

These functions are a reviewable transport probe for the existing top-frame Workflow preload. They intentionally do not expose an arbitrary method/channel API to the page. They do not solve cached monthly data. The integration owner must test them in the isolated staging app before runtime adoption.

```js
function readNativeUsage(ipcRenderer) {
  const id = 'codex-workflow-usage:' + crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Usage unavailable')), 10000);
    function finish(error, value) {
      clearTimeout(timer);
      window.removeEventListener('message', receive, true);
      error ? reject(error) : resolve(value);
    }
    function receive(event) {
      const data = event.data;
      if (event.source != null || data?.type !== 'mcp-response' ||
          data.hostId !== 'local' || data.message?.id !== id) return;
      // Native preload emits source=null events. Capture only our response,
      // before the native renderer's registry sees our unregistered ID.
      event.stopImmediatePropagation();
      const message = data.message;
      if (message.error || !message.result || typeof message.result !== 'object') {
        finish(new Error('Usage unavailable'));
      } else {
        finish(null, message.result);
      }
    }
    window.addEventListener('message', receive, true);
    ipcRenderer.invoke('codex_desktop:message-from-view', {
      type: 'mcp-request', hostId: 'local', source: 'account',
      priority: 'interactive', timeoutMs: 10000,
      expiresAtMs: Date.now() + 10000,
      request: { id, method: 'account/rateLimits/read' },
    }).catch(() => finish(new Error('Usage unavailable')));
  });
}

function openNativeUsageSettings() {
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'navigate-to-route', path: '/settings/usage' },
  }));
}
```

Constraints on this prototype:

- The stock renderer accepts a message with `source === null` and an object/string `type`; native preload itself uses this event shape. This is not a new privileged navigation IPC handler. Sending `navigate-to-route` **to main** is not the established route.
- Synthetic Node checks establish the native preload forwarding shape, not cross-world event propagation in Electron. Verify that the capture listener runs before stock handlers, stops **only** its own response, and leaves all unrelated messages untouched.
- Native transport supports `codex-host-chunked-message-v1`. Stock renderer reassembles chunks inside its private message dispatcher; it does not re-emit an assembled window event. This prototype does not support a chunked usage response. Fail unavailable on timeout; do not implement a second general chunk decoder or suppress unrelated chunks.
- A late response after timeout no longer has the prototype's capture listener and can produce the native unknown-ID log. Runtime adoption needs a bounded cleanup strategy for its own expired IDs, or a proven native registered request client. Do not hide all MCP responses or weaken native handling.
- One in-flight read, latest-response protection, account-change invalidation, validated projection, and disable cleanup belong in the real feature. Do not persist raw usage data or errors. The intentionally narrow prototype is not that lifecycle implementation.
- `window.electronBridge` is exposed into the **main world**. Its existence in another sandbox preload's global must not be assumed; direct use of that preload's already-available `ipcRenderer` avoids this assumption.
- Navigation can still be gated by native compact/onboarding route restrictions. Restore Workflow-owned Settings content before invoking native navigation and verify unsaved-settings behavior in staging.

## Cached native query and monthly support

`app-initial-86767c3d23e5.js`, offsets 4086600–4089000:

```js
SP = ib(Q, ({get, scope}) => ({
  queryKey: ['rate-limit-status'],
  // Actual queryFn uses native DO.safeGet('/wham/usage', ...).
  // retry: false, staleTime: configured base interval (default 30 seconds),
  // refetchOnWindowFocus: true; usage-scaled interval, minimum 5 seconds.
}));
```

This is a live query, not a `rate-limit-status` IPC event. Its bundle alias is `VDt`; obtain the mounted inherited scope with `rp()` as established above. `Q` is the AppScope token (`N1t` export), not the mounted scope instance; `hb(Q)` is a React hook. Creating another scope/query client would not read the existing cache.

Do not use legacy `fetch` IPC for `/wham/usage`: main `handleRequest` at 920946 explicitly throws `HTTP requests must use the HTTP fetch service.` for general HTTP URLs. Renderer `sendRequest` at roughly 3339800 routes HTTP through its separate fetch service; passive `fetch-response` IPC observation therefore does not establish native usage-cache updates either.

Native monthly concepts must remain distinct:

| Concept | Installed evidence | Feasibility here |
| --- | --- | --- |
| Monthly-duration rate window | `Blr` / `Vlr`, 4089000–4091830: 30 × 1440 minutes with ±5% tolerance; annual checked first | Label a returned window by actual duration. Do not assume secondary means weekly or monthly. Availability of such a returned window was not observed. |
| Sidebar monthly warning | 4086417: `sidebar_usage_warnings.default.monthly_limit` and optional `by_model` | Available in the native cache through ESM; excluded from this feature. Schema has `limit`, `used`, `remaining` strings; `remaining_percent` integer 0–100; `reset_at`, `used_percent`, `reset_after_seconds` numbers; nullable `source`. |
| Monthly spend control | 4092490: `effective_monthly_limit.limit`, `current_month_usage`, `enforcement_mode === 'HARD_CAP'`; Settings at 85741 uses a separate query | Not a proven field in the app-server response. Do not substitute a rate window or purchased-credit balance. |

The sidebar monthly warning is optional warning content, not proof of an always-present monthly allocation. The native query itself converts HTTP 401/403/404 to `null`. Missing account/data must render unavailable or omit the indicator, not show a full allowance.

## Verification and handoff

Passed a synthetic Node `vm` check executing the **exact installed** `.vite/build/preload.js` against stub Electron/DOM objects: `electronBridge.sendMessageFromView` invokes the expected channel with the supplied fixed request, returns `undefined`, and native inbound IPC dispatches a MessageEvent with the response object. Only synthetic data was used.

The implemented function uses native `Run.subscribe` for local notification/connection/route events, an exact cache-key subscription, and a window focus listener. It adds no polling interval and does not intercept any MCP response. Initial/focus/routine notification reads reuse native `fetchQuery` options/staleTime; only invalidating account/reconnect/reset reads force that query. It follows QueryClient replacement and exposes one owned stop/replay sentinel. Disable disposes every owned listener; late imports/read completions cannot affect a successor installation.

It emits only `CustomEvent('codex-workflow:usage', {detail: JSON.stringify({windows, blocked, unavailable})})`. Each projected window has finite `usedPercent` clamped 0–100, positive finite `windowDurationMins`, and finite nonnegative `resetsAt` or null. Only two core slots are inspected. Backend account IDs remain private in the main-world closure and are used only to permit matching sparse merges; raw data/errors are never published.

Account safety: `AccountUpdatedNotification` has only `authMode` and `planType`, **no account ID**. On account change/disconnect the bridge increments its epoch, cancels only the native usage query, clears its display and merge baseline, and rejects all cached/sparse updates until a new forced read completes in the current epoch. A subsequent cache event with a different/missing account ID also clears and forces a read before display. Non-ChatGPT auth remains unavailable. This prevents a pre-change in-flight request from satisfying the post-change query via deduplication. The new read still relies on native HTTP authentication/principal handling; the protocol cannot prove which account an arbitrarily delayed sparse notification belongs to. Matching sparse merges require `limitId === 'codex'`, compatible core `limitName`, and an established cached `account_id`; ambiguous buckets refresh instead. Do not claim stronger identity proof or infer a missing account ID.

Focused source checks: eight tests pass, covering sanitizer/zero/monthly/malformed values, exact key and model-bucket exclusions, idempotence and cleanup, sparse merge/coalescing, account epochs, disconnect/errors/late completion, missing scope recovery, QueryClient replacement, and asynchronous installation replacement. Test loader substitutes only the dynamic `import` call with a native API fixture; the complete function runs in a separate JSDOM realm. Live adapter behavior, auth switching, native cadence and UI remain the parent's staging responsibility.

`npm run check` passed all 152 tests. After the final unexpected-account-ID guard, syntax and all eight focused bridge tests were rerun successfully. `git diff --check` passed. Read-only status found the supported stock 26.901.41600 / 7982 bundle, matching ASAR integrity, valid signature, no pending transaction, and recommended `install`; the status-derived `npm run install:patch -- --dry-run` passed with no warnings. No installation was performed. Pre-existing untracked `node_modules` was untouched.

### Final bounded bridge pass

The parent subsequently reported the integrated live bridge returned successfully and displayed native cached usage (97% Weekly). This is parent staging evidence, not a production installation or this worker's UI observation.

- Routine core and unmatched/reserve rate-limit notifications now call native `fetchQuery` with its original staleTime, without forcing or queueing another network read. Matching sparse core windows still publish immediately. Unchanged data object **and** `dataUpdatedAt` are no longer reapplied even when a routine fetch promise resolves, so a still-fresh cached response cannot undo a newer sparse notification. A genuinely updated authoritative cache snapshot can replace it.
- Exactly one owned timeout targets the earliest finite core `resetsAt`. It clears the projection at expiry and forces one authoritative refresh. A backend response retaining the same expired timestamp stays unavailable and cannot create a zero-delay loop. Account changes, failures, disable and unload cancel the timer. Delays beyond the browser's 2147483647-ms maximum use a remaining-delay handoff, with no early refresh or polling interval.
- Failed asset/import/setup keeps an unavailable sentinel until explicit disable or reload; repeated enable calls do not retry imports. The exact observed `initialRoute=/avatar-overlay` URL query value is excluded before any import/subscription/timer. `app://-/index.html` remains enabled; no broader overlay heuristics were added.
- Verified actual native connection envelope in `.vite/build/src-VqXTPopo.js` at 1062056: `createConnectionStatePayload()` returns `{type:'codex-app-server-connection-changed', hostId:this.options.hostId, state:this.connectionState, progress:this.connectionProgress, error:this.connectionError, transport:this.options.transport.kind}`. State is top-level; the renderer itself compares `e.state === 'connected'`. Connecting/restarting/disconnected/error states are not ready.

Final-pass verification: syntax, all **12 focused bridge tests**, and `git diff --check` passed. Added guarantees cover native staleTime retention/no stale-cache rollback, one-shot expiry and cleanup, long monthly timer handoff, failed-asset retry suppression, and exact avatar-overlay exclusion. The broader 152-test suite and installer dry-run above are from the preceding pass; they were not repeated for this bounded bridge-only change.
