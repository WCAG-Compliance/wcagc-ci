// src/index.ts
import { appendFile } from "node:fs/promises";

// src/core.ts
var coverage = "Automated checks cover only part of WCAG and EN 301 549. Manual review and fixes in code remain essential.";
function endpoint(base, path) {
  return base.replace(/\/$/, "") + "/api/v1" + path;
}
async function json(response) {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`wcagc API ${response.status}: ${body.slice(0, 500)}`);
  }
  return response.json();
}
function headers(key) {
  return { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" };
}
async function runCheck(options, deps) {
  const created = await json(await deps.fetch(endpoint(options.apiBaseUrl, "/ci/checks"), { method: "POST", headers: headers(options.apiKey), body: JSON.stringify({ urls: options.urls, failOn: options.failOn, setBaseline: options.setBaseline, context: options.context ?? { provider: "github" } }) }));
  const started = deps.now();
  let delay = 1e3;
  let check;
  for (; ; ) {
    check = await json(await deps.fetch(endpoint(options.apiBaseUrl, `/ci/checks/${created.id}`), { headers: headers(options.apiKey) }));
    if (check.status === "COMPLETED" || check.status === "FAILED") break;
    if (deps.now() - started >= options.timeoutMs) throw new Error(`Timed out waiting for wcagc check ${created.id}.`);
    await deps.sleep(delay);
    delay = Math.min(5e3, Math.ceil(delay * 1.6));
  }
  const findings = await json(await deps.fetch(endpoint(options.apiBaseUrl, `/ci/checks/${created.id}/violations`), { headers: headers(options.apiKey) }));
  return { check, findings, summary: renderSummary(check), annotations: renderAnnotations(findings) };
}
function renderSummary(c) {
  const n = c.newCounts ?? { critical: 0, serious: 0, moderate: 0, minor: 0 };
  return `# wcagc CI check

**Verdict: ${c.verdict ?? "FAIL"}**${c.baselineMissing ? " \u2014 no baseline; NEW_CRITICAL fell back to ANY_CRITICAL." : ""}

| Severity | Findings | New |
|---|---:|---:|
| Critical | ${c.counts.critical} | ${n.critical} |
| Serious | ${c.counts.serious} | ${n.serious} |
| Moderate | ${c.counts.moderate} | ${n.moderate} |
| Minor | ${c.counts.minor} | ${n.minor} |

[Open the wcagc report](${c.appUrl})

> ${coverage}
`;
}
function renderAnnotations(findings) {
  return findings.map((f) => {
    const level = f.impact === "critical" || f.impact === "serious" ? "error" : f.impact === "moderate" ? "warning" : "notice";
    const fresh = f.isNew ? "New " : "";
    return `::${level} title=${escape(`${fresh}${f.impact}: ${f.ruleId}`)}::${escape(`${f.url} \u2014 ${f.failureSummary ?? f.target ?? "Automated finding"}`)}`;
  });
}
function escape(value) {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(/:/g, "%3A").replace(/,/g, "%2C");
}

// src/index.ts
var input = (name, fallback = "") => process.env[`INPUT_${name.toUpperCase()}`] ?? fallback;
var bool = (name, fallback) => ["1", "true", "yes"].includes(input(name, String(fallback)).toLowerCase());
var failOn = (value) => ({ "new-critical": "NEW_CRITICAL", "any-critical": "ANY_CRITICAL", "serious-or-worse": "SERIOUS_OR_WORSE", none: "NONE" })[value] ?? (() => {
  throw new Error(`Unsupported fail-on value: ${value}`);
})();
async function output(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) await appendFile(file, `${name}=${value}
`);
  else console.log(`${name}=${value}`);
}
try {
  const apiKey = input("API-KEY");
  if (!apiKey) throw new Error("api-key is required.");
  console.log(`::add-mask::${apiKey}`);
  const urls = input("URLS").split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
  if (!urls.length) throw new Error("urls must contain at least one URL.");
  const result = await runCheck({ apiKey, urls, failOn: failOn(input("FAIL-ON", "new-critical")), setBaseline: bool("SET-BASELINE", false), timeoutMs: Number(input("WAIT-TIMEOUT-SECONDS", "600")) * 1e3, apiBaseUrl: input("API-BASE-URL", "https://api.wcagc.com"), context: { provider: "github", repo: process.env.GITHUB_REPOSITORY, ref: process.env.GITHUB_REF, sha: process.env.GITHUB_SHA, runUrl: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : void 0 } }, { fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: Date.now });
  if (bool("ANNOTATIONS", true)) for (const line of result.annotations) console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, result.summary);
  const c = result.check.counts, n = result.check.newCounts;
  await output("verdict", result.check.verdict ?? "FAIL");
  await output("check-id", result.check.id);
  await output("critical-count", c.critical);
  await output("serious-count", c.serious);
  await output("moderate-count", c.moderate);
  await output("minor-count", c.minor);
  await output("new-critical-count", n?.critical ?? 0);
  await output("report-url", result.check.appUrl);
  if (result.check.verdict !== "PASS") throw new Error(result.check.failureReason ?? `wcagc check ${result.check.id} returned FAIL.`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error title=wcagc CI check::${message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`);
  process.exitCode = 1;
}
