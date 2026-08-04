## Steps

Flag `high` if:
- the step's `action` field is empty or only whitespace, AND the step's `expected` does NOT simply describe a state the system has already reached (a form appeared, a page loaded, a field is filled). A step with no action can't be executed.
- If `action` is empty, but `expected` describes exactly a reached state with no user action — that's not an "empty action", it's a step duplicating the expected result. Flag `low` per the rule below, not `high`.
- a step uses an object or state that's only created in a later step. Example: step 2 deletes a record that step 5 creates.
- the order of steps is logically impossible.
- the expected result doesn't match the action.

Flag `medium` if:
- one step contains several independent actions joined by commas. Example: `enter email, enter password, click the button`. That's three different steps.
- a step describes a vague goal with no concrete criterion. Examples: `verify that the system works`, `check correctness`. It's unclear what exactly to check.
- an important transition or action is missing. Without it, the next step is impossible.

Flag `low` if:
- there are extra technical steps unrelated to the test. Examples: `open the browser`, `enter the site address` (with no concrete URL — just an instruction to open the browser and type an address).
- a step describes a state the system has reached, not a user action. Example: `The code entry form is displayed`, `The page refreshed` — that's the expected result of the previous step, not a standalone step. Such a step duplicates the expected result.
- the first step is navigation to a URL, and preconditions already describe the state "Page X is open" or "User is on page X". The navigation step duplicates the precondition.
- steps 1–N are a login flow (entering a username, entering a password, clicking the login button), and preconditions already describe the state "User is authenticated" or "Valid credentials are entered / User is successfully authenticated". The login steps duplicate the precondition. Flag only if the precondition explicitly describes a state AFTER login — don't flag if the precondition only describes "The login page is open".
- the action contains automation-technical terms: `by locator`, `selector`, `xpath`, `css selector`, `element id`. Such terms aren't allowed in a manual test case.
- the case has an unusually large number of steps (rough guideline: more than ~20) and a chunk of them is generic setup/navigation (login, getting to a section, filling an unrelated form) rather than the scenario itself. That setup is a candidate for a shared step, reused across cases — flag it as a maintainability observation, not a correctness problem with this specific case.

Don't flag if:
- the actions are physically inseparable. Example: `press and hold`. That's one atomic operation.
- the step contains a concrete observable criterion. Examples: `Verify the URL contains /auth/login`, `Verify the response status is 200`. That's a concrete check, not a vague goal.
- the required state isn't described in preconditions. That's a violation of the `preconditions` rule, not `steps`.
- a step "open the page" or "go to the address" contains a concrete URL in the action text. That's a violation of the `test_data` rule (the URL should be in the test_data field, not in the action text), not an extra step. Don't flag it as low under steps.
- a URL or data is embedded in the action. That's a violation of the `test_data` rule, not `steps`. Don't create a `steps` issue if the violation is already described under the `test_data` rule. One cause — one issue. Wrong: a `steps` issue with text like "Step N contains a URL, which violates the test_data rule" — since the violation is already about `test_data`, a `steps` issue must not be created at all, even if it mentions test_data.
- a step is missing test data entirely (no `test_data`, no data embedded in `action`). That's a violation of the `test_data` rule, not `steps`. Don't create a `steps` issue for it, even if `test_data` is also enabled.
- a step waiting for the result of an asynchronous operation (email, SMS, queue, cron) is missing. Don't flag it as an extra step — waiting for an asynchronous result is part of the scenario.

If you flag "several actions in one step": in `recommendation` write: `Split step N into X steps: [step 1], [step 2]...`. Move the data from the action into test_data.

If you flag "vague goal": in `recommendation` propose a concrete rewording with an observable criterion: element, text, status, URL. Don't propose another "verify that..." form.

## How to fix

If the issue is about several actions in one step: split them into separate steps. Move data out of the action text into test_data. For every new intermediate step, add an obvious expected result derived from the action's context:
- "enter email" → "Email field is filled without errors"
- "enter password" → "Password field is filled without errors"
- "click the button" → taken from the original expected result of the source step

If the issue is about a vague goal: reword it into a concrete action with an observable criterion (element, text, URL, status). Don't propose another "verify that…" form. If the criterion can't be determined from context → `manual_needed`: "State the observable criterion for step N."

If the issue is about an empty `action`: first check whether the step's `expected` describes a state the system has already reached with no user action (a form appeared, a page loaded, etc.). If so — it's a step duplicating the expected result: remove the step as described below, don't invent an action for it. If `expected` requires a real user action, but which one exactly isn't clear from context → `manual_needed`: "State the action for step N." Don't make up an action by rewording expected in different words — that's not an action, it's the same fact restated.

If the issue is about a broken step order or a missing transition → `manual_needed`.

If the issue is about automation-technical terms: remove the technical term, keep a human-readable description of the action. Example: `Click the button by locator "X"` → `Click the "X" button`. If the element's name is unknown from context → `manual_needed`.

If the issue is about a step duplicating the expected result: remove the step. Its content is already in the expected result of the previous step.

If the issue is about a navigation step duplicating a precondition: remove the navigation step. The precondition already describes the needed state.

If the issue is about a large step count with extractable setup → `manual_needed`: "Steps N-M are generic setup — consider extracting them into a shared step reused across cases." Don't restructure it yourself; creating a shared step is a TestIT-level action outside what this improve pass can do.
