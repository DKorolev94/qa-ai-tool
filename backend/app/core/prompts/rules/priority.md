## Priority

Flag `medium` if the priority clearly doesn't match the importance of the scenario.

Guidelines:
- `high`: authentication, payment, security, creation of key objects
- `medium` / `high`: main business flow
- `low` / `medium`: auxiliary functionality, UI details, text content

Don't flag if the priority is debatable but not clearly wrong.

## How to fix

Change the value based on the criticality of the scenario: authentication/payment/security → `high`, main flow → `medium`, UI details → `low`.
