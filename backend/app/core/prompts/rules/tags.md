## Tags

Service tags — ignore them completely. Don't flag their absence, don't flag their presence, don't suggest removing them, don't include them in the final recommended tag list. Service tags: `ai-generated`, `needs-review`.

Tags cover 5 dimensions. One tag per dimension. Exception: `e2e` is added on top of the technique tag, it doesn't replace it.

| Dimension | Allowed tags | Rule |
|-----------|----------------|---------|
| Technique | `ui`, `api`, `db` | one of the three |
| Scope | `e2e` | only for full user scenarios from start to completion of a business goal; details below |
| Suite | `smoke`, `regression` | one of the two |
| Module | `auth`, `payment`, `profile`, `orders`, ... | one tag per feature |
| Scenario | `positive`, `negative` | one of the two |
| Role | a role tag from the project | add if the role affects the test's behavior or result; use role tags already present in the case |

### When to set `e2e`

`e2e` = a full user scenario that spans several modules or systems and completes a business goal.

Set `e2e` if the scenario passes through several modules **and** completes the user's business goal. Examples:
- Registration → filling out the questionnaire → SMS confirmation → receiving a decision
- Login → selecting a product → payment → order confirmation
- Uploading a document → verification → status change

Don't set `e2e` if:
- the test checks only one screen or one step of a multi-step flow. Example: filling in step 1 of 5 of a questionnaire is not e2e, even if moving to the next screen happened.
- the test is atomic: one module, one feature, one check.
- moving between two screens is an intermediate step within one module, not an end-to-end scenario.

Examples of a correct tag set:
- A regular UI case (one step of a flow): `ui, smoke, onboarding, positive`
- A full end-to-end flow: `ui, e2e, regression, payment, positive`
- An API test: `api, regression, auth, negative`

Based on the title, description, preconditions, steps, and expected results, compose the final tag list:
- keep the current tags if they're useful and fit the case;
- add obviously needed tags;
- remove redundant, incorrect, or duplicate tags.

Before flagging any dimension as missing, write out the case's current `tags` list verbatim in your reasoning, then go dimension by dimension (technique, scope, suite, module, scenario, role) and check whether one of the listed tags already covers it. If a tag for that dimension is already present, it's not missing — even if the tag name is project-specific and unfamiliar to you (e.g. a module name you don't recognize). Only flag a dimension if, after this check, no tag from that dimension is present at all. Never claim a specific tag name (e.g. `ui`) is missing without first confirming it's absent from the list you just wrote out.

Flag `medium` if the following is missing:
- a technique tag: `ui`, `api`, `db`;
- a suite tag: `smoke`, `regression`;
- a module tag. Examples: `auth`, `payment`, `profile`;
- a scenario tag: `positive`, `negative`;
- a role tag — if it clearly follows from the steps or preconditions that the test runs under a specific role, but the tag isn't present.

Flag `medium` if a wrong tag would put the test in the wrong suite.

Flag `low` if:
- both `smoke` and `regression` are set at once — these are different suites, keep only one;
- tags of the same module at different levels of detail are set at once. Example: `auth` + `login` — `login` is part of `auth`, keep only one;
- the `e2e` tag is on a case that checks one screen, one step of a flow, or one feature — remove it. `e2e` is only for full end-to-end scenarios with a completed business goal.

Don't flag if:
- the current tags cover all applicable dimensions.
- the tags differ slightly from the ideal, but filtering still works correctly.
- the project uses its own known tag set.
- the role doesn't affect the scenario — a role tag isn't required.

In the recommendation, always state the full final tag list.
Format: `Replace tags with: ui, smoke, auth, negative, model`

## How to fix

Compose the final list by dimension: technique (`ui`/`api`/`db`), scope (`e2e` — only if it's a full end-to-end scenario with a completed business goal spanning several modules), suite (`smoke`/`regression`), module (`auth`/`payment`/...), scenario (`positive`/`negative`), role (a role tag from the project — if it follows from the steps). One dimension = one tag. Don't set `smoke` and `regression` together. Don't touch the service tags `ai-generated`, `needs-review`. In `improvement_notes` state: "Replace tags with: [final list]".
