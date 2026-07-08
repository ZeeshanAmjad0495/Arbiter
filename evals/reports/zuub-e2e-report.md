# Zuub E2E — real-LLM run

- Provider: **kimi** · model(s) actually used: **kimi-k2.7-code**
- Cases: **468** (39 flows × 12 tickets)
- Succeeded: **466** · Errored: **2**
- Sanitizer hard-blocked (credential ticket): **39** · Grounding violations: **79**
- Gate decisions: approved=59 · pending=289 · rejected=39 · needs_changes=79
- Avg latency/run: **58734ms** · Wall time: **844.1s**

## Per-flow

| Flow | ok/total | errors |
| --- | --- | --- |
| requirement-analyzer | 12/12 | 0 |
| test-case | 12/12 | 0 |
| edge-case-challenger | 12/12 | 0 |
| bug-report | 12/12 | 0 |
| release-readiness | 12/12 | 0 |
| nfr-analyzer | 12/12 | 0 |
| operational-readiness-gate | 12/12 | 0 |
| test-strategy | 12/12 | 0 |
| test-plan | 12/12 | 0 |
| traceability-matrix | 12/12 | 0 |
| compliance-mapping | 12/12 | 0 |
| ci-failure-triage | 12/12 | 0 |
| flaky-test-advisor | 12/12 | 0 |
| incident-postmortem | 12/12 | 0 |
| api-test-generator | 12/12 | 0 |
| contract-drift | 12/12 | 0 |
| security-abuse-cases | 12/12 | 0 |
| exploratory-charter | 12/12 | 0 |
| uat-script | 12/12 | 0 |
| cross-req-inconsistency | 10/12 | 2 |
| spec-change-impact | 12/12 | 0 |
| smoke-suite | 12/12 | 0 |
| regression-impact | 12/12 | 0 |
| data-quality-assertions | 12/12 | 0 |
| migration-test-plan | 12/12 | 0 |
| exec-quality-report | 12/12 | 0 |
| synthetic-test-data | 12/12 | 0 |
| accessibility-ac | 12/12 | 0 |
| performance-test-plan | 12/12 | 0 |
| nfr-result-triage | 12/12 | 0 |
| persona-scenarios | 12/12 | 0 |
| mobile-test-cases | 12/12 | 0 |
| mutation-survivors | 12/12 | 0 |
| feature-flag-matrix | 12/12 | 0 |
| chaos-gameday | 12/12 | 0 |
| dr-drill | 12/12 | 0 |
| sre-runbook | 12/12 | 0 |
| ops-config | 12/12 | 0 |
| test-estimation | 12/12 | 0 |

## Errors (2)

- cross-req-inconsistency × IV-4188: timeout after 240000ms: cross-req-inconsistency×IV-4188
- cross-req-inconsistency × CS-1502: timeout after 240000ms: cross-req-inconsistency×CS-1502