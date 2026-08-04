## Priority

Flag `medium` if the priority clearly doesn't match the importance of the scenario.

Guidelines:
- `high`: authentication, payment, security, creation of key objects
- `medium` / `high`: main business flow
- `low` / `medium`: auxiliary functionality, UI details, text content

Flag `medium` if the case is tagged `smoke` and priority is `low`. A smoke case checks the critical path by definition — `low` contradicts that. (Not automatically the other way around: a `regression`-only case can legitimately be `highest` for a critical edge case.)

Flag `medium` for priority inflation, not just under-prioritizing: `highest`/`high` on a case that checks a single UI/wording detail, an edge case already covered by a higher-priority scenario, or a rarely-used auxiliary feature. Defaulting everything to `high` is as wrong as defaulting everything to `low`.

Don't flag if the priority is debatable but not clearly wrong.

## How to fix

Change the value based on the criticality of the scenario: authentication/payment/security → `high`, main flow → `medium`, UI details → `low`. If tagged `smoke` with a below-`high` priority, raise it to `high` — unless the scenario genuinely isn't critical, in which case the `smoke` tag itself is the problem (that's a `tags` issue, not this one — don't fix it here). If priority looks inflated for what the case actually checks, propose a downgrade.
