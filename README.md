# wcagc CI

Run wcagc automated accessibility checks from GitHub Actions or GitLab CI, compare URL-level findings with a saved baseline, and route the result into the review workflow.

Automated checks cover only part of WCAG and EN 301 549. A passing job is not proof of compliance: manual review and fixes in code remain essential. This action detects and reports findings; it does not modify a site.

## Quickstart

First register the target domain in wcagc and create an organization API key with `scans:read` and `scans:write` scopes. Store it as the repository secret `WCAGC_API_KEY`. Every URL in one invocation must belong to the same registered domain; a check accepts at most 20 URLs.

```yaml
name: Accessibility
on: [pull_request]
jobs:
  wcagc:
    runs-on: ubuntu-latest
    steps:
      - uses: WCAG-Compliance/wcagc-ci@v1
        with:
          api-key: ${{ secrets.WCAGC_API_KEY }}
          urls: |
            https://example.com
            https://example.com/pricing
          fail-on: new-critical
```

Create or refresh the comparison baseline only from the default branch:

```yaml
on:
  push:
    branches: [main]
jobs:
  baseline:
    runs-on: ubuntu-latest
    steps:
      - uses: WCAG-Compliance/wcagc-ci@v1
        with:
          api-key: ${{ secrets.WCAGC_API_KEY }}
          urls: https://example.com
          set-baseline: "true"
          fail-on: none
```

`fail-on` accepts `new-critical` (default), `any-critical`, `serious-or-worse`, and `none`. When `new-critical` has no prior baseline, it deliberately falls back to `any-critical` and says so in the step summary.

The action emits URL-level workflow annotations, a Markdown step summary with the coverage limitation, and outputs for verdict, check ID, severity counts, new critical count, and report URL. It exits with code 1 on a FAIL verdict, API error, or wait timeout. The API key is masked and never logged.

## GitLab CI

Copy [`templates/gitlab-ci.yml`](templates/gitlab-ci.yml) into your pipeline and define these CI/CD variables:

- `WCAGC_API_KEY` — required masked variable. Protect it only if merge-request pipelines are configured to access protected variables safely; never expose it to untrusted fork pipelines.
- `WCAGC_URLS` — required newline- or comma-separated list of up to 20 registered URLs.
- `WCAGC_FAIL_ON` — optional; defaults to `new-critical`.
- `WCAGC_SET_BASELINE` — optional boolean; the template enables it only on the default branch.
- `WCAGC_API_BASE_URL` — optional; defaults to `https://api.wcagc.com`.
- `WCAGC_WAIT_TIMEOUT` — optional positive number of seconds; defaults to 600. The legacy `WCAGC_WAIT_TIMEOUT_SECONDS` alias is also accepted.

The template uses the pinned major tag `github:WCAG-Compliance/wcagc-ci#v1`, runs merge-request checks without changing the baseline, and refreshes the baseline only on the default branch. Review GitLab's protected-variable and fork-pipeline settings before enabling pipelines for external contributions.

The CLI prints a plain-text severity table, report URL, and the same automation-coverage limitation as the GitHub summary. Exit codes are `0` for PASS, `1` for a FAIL verdict or runtime/API error, and `2` for invalid configuration. It never prints the API key.

## Development

The shipped action has zero runtime dependencies and uses Node 24's built-in `fetch`. Development uses TypeScript and esbuild only.

```bash
npm ci
npm test
npm run typecheck
npm run build
```

Both bundles in `dist/` are committed because GitHub and GitLab execute them directly. This repository is the public release mirror for the package maintained in the wcagc platform repository. Exact release tags such as `v1.0.0` are immutable; the major `v1` tag advances only to a verified backward-compatible release.
