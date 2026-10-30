"use strict";

// Offline only. The workflow's fetch is replaced inside a VM; this file never
// imports a network client, runs the real monitor, or writes published data.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { format } = require("node:util");
const { execFileSync, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const workflowPath = ".github/workflows/infra-health.yml";
const statusPath = "api/infra-health/status.json";
const baselineCommit = "f04cb3a375a0d8b4ba87f5de7b929520798e51b1";
const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
const workflow = fs.readFileSync(path.join(root, workflowPath), "utf8");
const baseline = git(["show", `${baselineCommit}:${workflowPath}`]);
const fixture = JSON.parse(fs.readFileSync(path.join(root, statusPath), "utf8"));
const clone = value => structuredClone(value);
const watchIndex = fixture.checks.findIndex(check => check.id === "watch-feed");

function scriptFrom(yaml) {
  const match = yaml.match(/          node <<'NODE'\r?\n([\s\S]*?)\r?\n          NODE/);
  assert.ok(match, "embedded monitor script must be found");
  return match[1].split("\n").map(line => line.replace(/^          /, "")).join("\n");
}

const script = scriptFrom(workflow);
const contract = script.match(/\/\/ BEGIN PUBLIC STATUS CONTRACT([\s\S]*?)\/\/ END PUBLIC STATUS CONTRACT/);
assert.ok(contract, "publication guard must be explicitly delimited");
const validate = vm.runInNewContext(`${contract[1]}\nassertPublicStatus;`, {});

function watchFixture() {
  const check = fixture.checks[watchIndex];
  return {
    schema: "mirsflr-watch-status/v1", generatedAt: check.generatedAt,
    validator: clone(check.validator), ftso: clone(check.ftso), fdc: clone(check.fdc)
  };
}

function createOfflineHarness(options = {}) {
  const now = Date.parse(fixture.generatedAt);
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const watch = options.watch === undefined ? watchFixture() : options.watch;
  const logs = [], apiCalls = [], exits = [];
  let published = null;
  const previousPublic = JSON.stringify(fixture, null, 2) + "\n";
  let storedPublic = previousPublic;
  const response = (body, status = 200) => ({
    ok: status >= 200 && status < 300, status, statusText: status === 200 ? "OK" : "Unavailable",
    text: async () => typeof body === "string" ? body : JSON.stringify(body),
    json: async () => typeof body === "string" ? JSON.parse(body) : body
  });
  const fetch = async (url, init = {}) => {
    if (url.startsWith("https://api.github.com/repos/offline/status/contents/")) {
      apiCalls.push({ url, init });
      if (init.method === "PUT") {
        if (options.publicationFailure === "put-http") return response({ message: "Synthetic publication failure" }, 503);
        if (options.publicationFailure === "put-network") throw new Error("Synthetic publication network failure");
        const request = JSON.parse(init.body);
        published = Buffer.from(request.content, "base64").toString("utf8");
        storedPublic = published;
        if (options.publicationFailure === "put-response-lost") throw new Error("Synthetic response lost after write");
        return response({});
      }
      if (options.publicationFailure === "get-http") return response({}, 503);
      if (options.publicationFailure === "get-json") return response("invalid JSON");
      if (options.publicationFailure === "get-network") throw new Error("Synthetic publication read failure");
      return response({ sha: "offline-sha" });
    }
    if (url === "https://www.mirhollio.com/") {
      return response(options.website === undefined ? "MirSFlr" : options.website);
    }
    if (url === "https://flare-api.flare.network/ext/bc/P") {
      if (options.rpcError) throw new Error("Synthetic RPC timeout");
      return response({ result: { validators: [{
        nodeID: "NodeID-8dNfgpspPNDrZD2ksKCRJoGe4Xqe6qVtz",
        connected: options.connected ?? true, uptime: options.uptime ?? "99.9975",
        delegators: Array.from({ length: 18 }, () => ({}))
      }] } });
    }
    if (url === "https://www.mirhollio.com/data/watch-status.json") return response(watch);
    if (url.startsWith("https://flare-systems-explorer.flare.network/")
        || url === "https://api.oracle-daemon.com/v1/flare/validators") {
      return response({}, options.externalDown ? 503 : 200);
    }
    throw new Error("Unexpected offline request");
  };
  const context = {
    fetch, Date: FixedDate, Buffer, AbortController,
    setTimeout: (fn, ms) => { if (ms < 20_000) queueMicrotask(fn); return 0; },
    clearTimeout: () => {},
    console: Object.fromEntries(["log", "error"].map(level => [level, (...args) => {
      // Match console.error's formatting, including Error stacks across VM realms.
      logs.push(format(...args));
    }])),
    process: { env: { GITHUB_TOKEN: "offline-only", GITHUB_REPOSITORY: "offline/status", GITHUB_REF_NAME: "offline", ...options.env },
      exit: code => exits.push(code) }
  };
  return { context, result: () => ({ published, previousPublic, storedPublic, apiCalls, exits, logs }) };
}

async function runOffline(yaml, options = {}) {
  const harness = createOfflineHarness(options);
  await vm.runInNewContext(scriptFrom(yaml), harness.context, { timeout: 3000 });
  return harness.result();
}

test("all reachable historical payloads preserve every field, type, value and JSON byte", () => {
  const commits = git(["rev-list", "--all", "--", statusPath]).trim().split("\n");
  const seen = new Set();
  let checked = 0;
  for (const commit of commits) {
    let raw;
    try { raw = git(["show", `${commit}:${statusPath}`]); } catch { continue; }
    if (seen.has(raw)) continue;
    seen.add(raw);
    const payload = JSON.parse(raw);
    const before = JSON.stringify(payload, null, 2) + "\n";
    validate(payload);
    assert.equal(JSON.stringify(payload, null, 2) + "\n", before, `mutation in ${commit}`);
    checked += 1;
  }
  assert.ok(checked > 1, "compatibility must include history, not one snapshot");
  console.log(`Historical compatibility: ${checked} distinct payloads`);
});

test("current payload and nullable/empty values remain unchanged", () => {
  const payload = clone(fixture);
  const check = payload.checks[watchIndex];
  check.ftso.rewardRate = null;
  check.ftso.availabilityHourly24h = [];
  check.fdc.conditionMet = null;
  check.validator.topDelegations[0].address = "P-offline-public-address";
  check.validator.topDelegations[0].end = null;
  payload.checks.find(c => c.id === "validator-node").uptimePct = null;
  const before = JSON.stringify(payload);
  validate(payload);
  assert.equal(JSON.stringify(payload), before);
  check.ftso = null; check.fdc = null; check.validator = null;
  validate(payload);
});

test("unknown fields are rejected at every object depth without disclosing their names or values", () => {
  const locations = [
    x => x, x => x.monitor, x => x.checks[watchIndex],
    x => x.checks[watchIndex].validator, x => x.checks[watchIndex].ftso,
    x => x.checks[watchIndex].fdc, x => x.checks[watchIndex].validator.topDelegations[0]
  ];
  const fieldNames = ["internalIp", "privateHostname", "adminUrl", "internalPort", "diagnosticTrace", "credentials", "token", "unexpectedMetric"];
  for (const locate of locations) for (const name of fieldNames) {
    const payload = clone(fixture);
    locate(payload)[name] = "synthetic-confidential-canary";
    assert.throws(() => validate(payload), error => {
      assert.match(error.message, /publication blocked: unapproved field/);
      assert.ok(!error.message.includes(name));
      assert.ok(!error.message.includes("synthetic-confidential-canary"));
      return true;
    });
  }
});

test("prototype-like JSON keys cannot bypass the allowlist", () => {
  for (const key of ["__proto__", "constructor", "toString"]) {
    const payload = clone(fixture);
    Object.defineProperty(payload.monitor, key, { value: "synthetic", enumerable: true });
    assert.throws(() => validate(payload), /unapproved field/);
  }
});

test("own and inherited JSON serializers cannot replace an approved tree during publication", () => {
  for (const locate of [x => x.monitor, x => x.checks, x => x.checks[watchIndex].validator.topDelegations]) {
    for (const inherited of [false, true]) {
      const payload = clone(fixture);
      const value = locate(payload);
      let invoked = false;
      const toJSON = () => { invoked = true; return { token: "serializer-canary" }; };
      if (inherited) Object.setPrototypeOf(value, Object.assign(Object.create(Object.getPrototypeOf(value)), { toJSON }));
      else value.toJSON = toJSON;
      assert.throws(() => validate(payload), /custom JSON serialization/);
      assert.equal(invoked, false, "the serializer itself must never execute");
    }
  }
});

test("named properties on arrays are rejected without disclosing their names or values", () => {
  const payload = clone(fixture);
  payload.checks[watchIndex].ftso.availabilityHourly24h.internalIp = "array-field-canary";
  assert.throws(() => validate(payload), error => {
    assert.match(error.message, /unapproved array field/);
    assert.ok(!error.message.includes("internalIp"));
    assert.ok(!error.message.includes("array-field-canary"));
    return true;
  });
});

test("missing and malformed input is rejected; optional historical fields are not required", () => {
  for (const input of [null, undefined, [], {}, "invalid"]) {
    assert.throws(() => validate(input), /publication blocked/);
  }
  for (const mutate of [
    x => { delete x.generatedAt; }, x => { delete x.checks[0].message; },
    x => { x.checks = null; }, x => { x.checks = {}; },
    x => { x.checks[watchIndex].ftso.performance = "0.8"; },
    x => { x.checks[watchIndex].fdc.availability = NaN; },
    x => { x.checks[watchIndex].validator.stake = Infinity; },
    x => { x.checks[watchIndex].ftso.availabilityHourly24h = [{}]; },
    x => { x.checks[watchIndex].validator.topDelegations = [null]; },
    x => { x.checks[0].message = { trace: "synthetic" }; }
  ]) {
    const payload = clone(fixture); mutate(payload);
    assert.throws(() => validate(payload), /publication blocked/);
  }
  const payload = clone(fixture);
  delete payload.monitor.rawUrl;
  payload.monitor.pagesUrl = "https://example.invalid/historical-public-status";
  validate(payload);
});

test("existing error messages remain verbatim; rejecting new fields never echoes error payloads", () => {
  const payload = clone(fixture);
  const message = "P-chain validator check failed: Synthetic request timeout (HTTP 503).";
  payload.checks[0].message = message;
  validate(payload);
  assert.equal(payload.checks[0].message, message);
  payload.checks[0].diagnosticTrace = { token: "synthetic-secret-value" };
  assert.throws(() => validate(payload), error => {
    assert.ok(!error.message.includes("diagnosticTrace"));
    assert.ok(!error.message.includes("synthetic-secret-value"));
    return true;
  });
});

test("offline workflow output, metrics, health decisions and publication target match the pre-change workflow", async () => {
  const stale = watchFixture(); stale.generatedAt = new Date(Date.parse(fixture.generatedAt) - 61 * 60_000).toISOString();
  const partial = watchFixture(); partial.ftso = null; partial.fdc = null;
  const impaired = watchFixture(); impaired.ftso.status = "unknown"; impaired.fdc.status = "warn";
  const invalidTime = watchFixture(); invalidTime.generatedAt = "not-a-date";
  const cases = [
    {}, { connected: false }, { uptime: "79" }, { rpcError: true },
    { externalDown: true }, { website: "Unexpected content" },
    { watch: stale }, { watch: partial }, { watch: impaired }, { watch: invalidTime },
    { watch: {} }, { watch: "invalid JSON" }
  ];
  for (const options of cases) {
    const before = await runOffline(baseline, options);
    const after = await runOffline(workflow, options);
    assert.ok(before.published, "baseline must produce an offline payload");
    assert.equal(after.published, before.published, "public JSON changed for the same input");
    assert.deepEqual(after.exits, before.exits, "health/exit behavior changed");
    // Headers originate in separate VM realms; compare JSON data, not prototypes.
    assert.equal(JSON.stringify(after.apiCalls), JSON.stringify(before.apiCalls),
      "publication destination or request changed");
  }
});

test("new nested sensitive field prevents any GitHub publication request", async () => {
  const watch = watchFixture();
  watch.validator.internalIp = "synthetic-confidential-canary";
  const result = await runOffline(workflow, { watch });
  assert.equal(result.published, null);
  assert.equal(result.apiCalls.length, 0);
  assert.deepEqual(result.exits, [1]);
  assert.equal(result.storedPublic, result.previousPublic);
  assert.equal(JSON.parse(result.storedPublic).overall, "ok", "a rejection does not rewrite the last public result");
  assert.ok(result.logs.some(line => line.includes("publication blocked")));
  assert.ok(result.logs.some(line => line.startsWith("::error title=Infra Health CI::")));
  assert.ok(result.logs.every(line => !line.includes("synthetic-confidential-canary") && !line.includes("internalIp")));
});

test("publication HTTP, JSON and network failures retain the previous file and fail as before", async () => {
  for (const publicationFailure of ["get-http", "get-json", "get-network", "put-http", "put-network"]) {
    const before = await runOffline(baseline, { publicationFailure });
    const after = await runOffline(workflow, { publicationFailure });
    assert.equal(after.published, null);
    assert.equal(after.storedPublic, after.previousPublic);
    assert.deepEqual(after.exits, [1]);
    assert.deepEqual(after.exits, before.exits);
    assert.equal(after.storedPublic, before.storedPublic);
    assert.equal(JSON.stringify(after.apiCalls), JSON.stringify(before.apiCalls));
    assert.ok(after.logs.some(line => line.startsWith("::error title=Infra Health CI::")));
  }
});

test("a response lost after an accepted write can fail the job even though the public file changed", async () => {
  const before = await runOffline(baseline, { publicationFailure: "put-response-lost" });
  const after = await runOffline(workflow, { publicationFailure: "put-response-lost" });
  assert.deepEqual(after.exits, [1]);
  assert.notEqual(after.storedPublic, after.previousPublic);
  assert.equal(after.storedPublic, after.published);
  assert.equal(after.storedPublic, before.storedPublic);
  assert.equal(JSON.stringify(after.apiCalls), JSON.stringify(before.apiCalls));
  assert.ok(after.logs.some(line => line.includes("Synthetic response lost after write")));
});

test("missing publication credentials or context fail instead of silently succeeding", async () => {
  for (const env of [{ GITHUB_TOKEN: undefined }, { GITHUB_REPOSITORY: undefined }]) {
    const before = await runOffline(baseline, { env });
    const after = await runOffline(workflow, { env });
    assert.deepEqual(before.exits, [], "documents the old silent skip");
    assert.deepEqual(after.exits, [1]);
    assert.equal(after.apiCalls.length, 0);
    assert.equal(after.storedPublic, after.previousPublic);
    assert.ok(after.logs.some(line => line.includes("requires a token and repository context")));
    assert.ok(after.logs.every(line => !line.includes("offline-only")));
  }
});

test("validation cannot be skipped when publication environment is absent", async () => {
  const watch = watchFixture(); watch.ftso.newDiagnostic = "confidential-canary";
  const result = await runOffline(workflow, { watch, env: { GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined } });
  assert.deepEqual(result.exits, [1]);
  assert.equal(result.apiCalls.length, 0);
  assert.ok(result.logs.some(line => line.includes("publication blocked")));
  assert.ok(result.logs.every(line => !line.includes("newDiagnostic") && !line.includes("confidential-canary")));
});

test("array-nested rejected keys and values never enter real console-style rejection logs", async () => {
  const watch = watchFixture();
  const key = "confidential-key\n::error::confidential-value";
  watch.validator.topDelegations[0][key] = "confidential-value";
  const result = await runOffline(workflow, { watch });
  assert.deepEqual(result.exits, [1]);
  assert.equal(result.apiCalls.length, 0);
  assert.equal(result.storedPublic, result.previousPublic);
  assert.ok(result.logs.some(line => line.includes("$.checks[2].validator.topDelegations[0]")));
  assert.ok(result.logs.every(line => !line.includes("confidential-key") && !line.includes("confidential-value")));
});

test("the actual Node process exits 1 on validation rejection with no publication or leaked input", () => {
  const watch = watchFixture(); watch.validator.internalIp = "confidential-child-canary";
  const childSource = `
    const vm = require("node:vm");
    const { format } = require("node:util");
    const fixture = ${JSON.stringify(fixture)};
    const watchIndex = ${watchIndex};
    const clone = value => structuredClone(value);
    ${watchFixture.toString()}
    ${createOfflineHarness.toString()}
    const harness = createOfflineHarness(${JSON.stringify({ watch })});
    harness.context.console = console;
    harness.context.process.exit = code => {
      const result = harness.result();
      console.log(JSON.stringify({ publicationRequests: result.apiCalls.length, unchanged: result.storedPublic === result.previousPublic }));
      process.exit(code);
    };
    vm.runInNewContext(${JSON.stringify(script)}, harness.context, { timeout: 3000 })
      .catch(() => { process.exitCode = 2; });
  `;
  const child = spawnSync(process.execPath, ["-e", childSource], { encoding: "utf8", timeout: 5000 });
  assert.ifError(child.error);
  assert.equal(child.status, 1);
  assert.match(child.stdout, /::error title=Infra Health CI::Public status publication blocked/);
  assert.match(child.stdout, /"publicationRequests":0,"unchanged":true/);
  assert.match(child.stderr, /Public status publication blocked/);
  assert.ok(!(child.stdout + child.stderr).includes("internalIp"));
  assert.ok(!(child.stdout + child.stderr).includes("confidential-child-canary"));
});

test("schedule, permissions, endpoints and health logic are untouched; only missing publication context now fails", () => {
  const withoutGuard = workflow.replace(/          \/\/ BEGIN PUBLIC STATUS CONTRACT[\s\S]*?          \/\/ END PUBLIC STATUS CONTRACT\n\n/, "")
    .replace("            assertPublicStatus(payload);\n", "");
  const expected = baseline.replace(
    '              console.log("Skipping publish outside GitHub Actions.");\n              return;',
    '              throw new Error("Status publication requires a token and repository context.");'
  );
  assert.equal(withoutGuard, expected);
});
