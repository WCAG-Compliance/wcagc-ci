#!/usr/bin/env node

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

// src/cli-core.ts
var CliConfigError = class extends Error {
};
var failOnValues = {
  "new-critical": "NEW_CRITICAL",
  "any-critical": "ANY_CRITICAL",
  "serious-or-worse": "SERIOUS_OR_WORSE",
  none: "NONE"
};
function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new CliConfigError(`${name} is required.`);
  return value;
}
function booleanValue(value, name) {
  if (value === void 0 || value.trim() === "") return false;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  throw new CliConfigError(`${name} must be true or false.`);
}
function positiveSeconds(value) {
  if (!value?.trim()) return 6e5;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new CliConfigError("WCAGC_WAIT_TIMEOUT must be a positive number of seconds.");
  return Math.round(seconds * 1e3);
}
function httpsUrl(value, name) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") throw new Error();
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new CliConfigError(`${name} must be an absolute HTTPS URL.`);
  }
}
function parseCliEnvironment(env) {
  const apiKey = required(env, "WCAGC_API_KEY");
  const urls = required(env, "WCAGC_URLS").split(/[\n,]/).map((value) => value.trim()).filter(Boolean);
  if (urls.length > 20) throw new CliConfigError("WCAGC_URLS accepts at most 20 URLs.");
  for (const url of urls) httpsUrl(url, "WCAGC_URLS");
  const requestedFailOn = (env.WCAGC_FAIL_ON ?? "new-critical").trim().toLowerCase();
  const failOn = failOnValues[requestedFailOn];
  if (!failOn) throw new CliConfigError("WCAGC_FAIL_ON must be new-critical, any-critical, serious-or-worse, or none.");
  return {
    apiKey,
    urls,
    failOn,
    setBaseline: booleanValue(env.WCAGC_SET_BASELINE, "WCAGC_SET_BASELINE"),
    timeoutMs: positiveSeconds(env.WCAGC_WAIT_TIMEOUT ?? env.WCAGC_WAIT_TIMEOUT_SECONDS),
    apiBaseUrl: httpsUrl(env.WCAGC_API_BASE_URL?.trim() || "https://api.wcagc.com", "WCAGC_API_BASE_URL"),
    context: {
      provider: "gitlab",
      repository: env.CI_PROJECT_PATH,
      ref: env.CI_COMMIT_REF_NAME,
      sha: env.CI_COMMIT_SHA,
      workflowRunUrl: env.CI_PIPELINE_URL
    }
  };
}
function renderCliTable(config, result) {
  const { check } = result;
  const fresh = check.newCounts ?? { critical: 0, serious: 0, moderate: 0, minor: 0 };
  return [
    "wcagc CI check",
    `Verdict: ${check.verdict ?? "FAIL"}`,
    check.baselineMissing ? "Baseline: missing; NEW_CRITICAL fell back to ANY_CRITICAL." : "",
    "",
    "Severity  Findings  New",
    `Critical  ${check.counts.critical}         ${fresh.critical}`,
    `Serious   ${check.counts.serious}         ${fresh.serious}`,
    `Moderate  ${check.counts.moderate}         ${fresh.moderate}`,
    `Minor     ${check.counts.minor}         ${fresh.minor}`,
    "",
    `Report: ${check.appUrl}`,
    `URLs: ${config.urls.length}`,
    "",
    coverage
  ].filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n");
}
async function executeCli(env, deps, write, writeError) {
  try {
    const config = parseCliEnvironment(env);
    const result = await runCheck(config, deps);
    write(renderCliTable(config, result));
    return result.check.verdict === "PASS" ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown wcagc CI error.";
    const safeMessage = env.WCAGC_API_KEY ? message.replaceAll(env.WCAGC_API_KEY, "[REDACTED]") : message;
    writeError(`wcagc CI: ${safeMessage}`);
    return error instanceof CliConfigError ? 2 : 1;
  }
}

// src/cli.ts
var exitCode = await executeCli(
  process.env,
  { fetch, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now: Date.now },
  (value) => process.stdout.write(`${value}
`),
  (value) => process.stderr.write(`${value}
`)
);
process.exitCode = exitCode;
