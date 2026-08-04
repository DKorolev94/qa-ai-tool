## Preconditions

Precondition = a setup step: an action that must be performed before the test starts. This can be navigation, login, data preparation. In TestIT, preconditions are separate steps with an `action` field (and optionally `expected`, `test_data`), executed before the main steps.

Flag `high` if:
- preconditions are empty, but the test requires a specific starting state (authentication, the right page, test data) — without it the first step can't be executed.
- preconditions duplicate the main steps. Example: preconditions say "Open the browser, go to the URL, log in", and steps 1–4 do the same thing. The tester (and Stagehand) will perform the setup twice.

Flag `medium` if:
- preconditions only say "Browser is open" — this carries no information, better to remove it or replace it with a real setup step that has a URL.
- preconditions describe a state without an action: "User is authenticated" instead of "Log in with account X" — it's unclear how to reach that state.
- the title, steps, or expected results reference a specific browser, OS, device, or screen size (mobile layout, a responsive breakpoint, a cross-browser CSS check, an app-specific gesture), but preconditions don't state which environment to run in. Don't flag this for ordinary functional/business-logic checks that don't depend on the environment — only when the case is plausibly about the environment itself.

Don't flag if:
- preconditions describe concrete setup actions: "Go to https://...", "Log in with the credentials in test_data", "Go to section Z". This is the correct format.
- preconditions describe external system conditions that aren't achieved by user actions in the browser: "A test user account has been created", "Test loan #123 exists in the DB". This is acceptable.
- preconditions describe a browser/environment reset done before the test starts: "Cookies are cleared", "Cache and local storage are cleared", "No active session/logged out". These are standard environment setup, not an ambiguous state — treat them like the DB/external-system conditions above, not like "User is authenticated".
- preconditions reference another test case. That's a violation of the `independence` rule, not `preconditions`.
- in an API case, preconditions describe request headers. Example: `Request headers: Content-Type: application/json`. Don't flag it.
- a precondition step is missing test data (email, password, an ID, etc.). That's a violation of the `test_data` rule, not `preconditions`. Don't create a `preconditions` issue for it, even if `test_data` is also enabled.

## How to fix

If preconditions contain a description of state instead of an action: replace it with a concrete setup step. Never write a literal email/password/token here unless that exact value is already in the source — follow the `test_data` rule instead: put the credential in `test_data` only if the source has a concrete value; otherwise leave `test_data` empty and mark `manual_needed` — don't invent a value or a placeholder. Word `action` as a plain instruction either way.
- "User is authenticated" → action: "Log in", test_data: the credentials from the source if there are any, otherwise empty + `manual_needed`
- "The Loans page is open" → "Go to the Loans section"

If preconditions are empty and the test steps start with a setup flow (open a URL, log in, navigate to the right section), followed by the actual test:
1. Move the setup steps (opening the URL, login, navigation) into preconditions.
2. Remove them from the main steps.
3. Leave only the actual test itself in the main steps (entering data, the action, verifying the result).

Example of a correct structure:
- Preconditions: action "Go to https://...", action "Log in", action "Go to Loans → Search loans tab"
- Steps: "Enter \"Smith\" in the Last name field", "Click the Search button", "Verify: the table shows at least one row with the last name \"Smith\""

If the setup steps are hard to separate from the test, or the boundary is unclear → `manual_needed`: "Specify where setup ends and the actual test begins — which steps to move into preconditions."

If a precondition references another test case → `manual_needed`: "Replace the reference to the test case with concrete setup steps."

If the environment (browser/OS/device/screen size) is missing but the case plausibly depends on it → `manual_needed`: "State the required browser/device/screen size for this test." Don't guess a specific browser or device — that's a business decision, not something derivable from the test case text.
