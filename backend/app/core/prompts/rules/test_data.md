## Test Data

The `test_data` field must contain everything the tester enters, selects, or passes in a request: email, password, ID, amount, phone, role, date, file name, payload, query params.

`test_data` must also contain page URLs and API endpoints, if they're concrete. A URL depends on the environment (dev/staging/prod) and must not be embedded in the action text.

Goal: a tester unfamiliar with the project must understand WHAT to enter. Without this, they waste time tracking down someone who can explain.

Before flagging `high` for an empty `test_data`, check: is the data physically present somewhere else (in the `action` text, in `comments`, in `preconditions`)? If so, the data isn't missing — it's just in the wrong field. That's not "can't be executed", it's "data isn't where it belongs" — flag `medium` per the rule below, not `high`. `high` for an empty `test_data` applies only when the data isn't anywhere in the test case at all.

Flag `high` if:
- the data is required to execute the step, `test_data` is empty, and there's no data in `action`, `comments`, or `preconditions` either. The tester has nowhere to get the data from.
- `test_data` contains a stand-in for a real value instead of one — a bare data-type label, a "TODO"-style note, a question mark. Examples: "email?", "TODO: password", "заполнить самому". The tester still doesn't know what to enter. This is equivalent to missing data.

Whether embedding data in the action text is worth flagging — and at what severity — depends on WHY it should move, not just on whether it's a literal value. Check these, in order:

Flag `medium` if:
- the data is stated vaguely. Examples: `a valid email`, `an existing user`, `a test file`. It's unclear which concrete value to use.
- a URL, hostname, or API endpoint is embedded in the action text. Always flag this regardless of test_data being empty or not — a URL depends on the environment (dev/staging/prod), and keeping it in `action` forces editing every step's text to switch environments. Bad: action = `Open https://dev.example.com/login`. Correct: test_data = `https://dev.example.com/login`, action = `Open the login page`.
- the same concrete value or example is repeated across the action text of two or more steps instead of being defined once in test_data. Duplication across steps is what test_data exists to avoid — if the value changes, every occurrence in every action would need editing.
- the data in action, test_data, preconditions, and the expected result contradict each other.
- an inline example (`example: X`) is left in the action text while test_data already has a value. That's a contradiction: it's unclear which one to use.

Flag `low` if:
- a concrete value or example (not a URL) appears in the action text of exactly one step, isn't reused anywhere else in the case, and test_data for that step is empty. Example: action = `Enter the last name, e.g.: Smith`. This is a consistency/style nit, not something that blocks execution — the tester can still read and run the step. Don't flag it `medium`; a one-off value with no reuse and no environment dependency doesn't justify more than `low`.

Don't flag if:
- the data is concrete: `test@example.com`, `+1 (202) 555-0123`, `user_id: 12345`.
- `test_data` names a real, retrievable source, in whatever wording the test case's author used — "test accounts", "see the password manager", "issued via API in preconditions". A human-authored pointer to a real source is fine; this rule only requires *some* usable answer to "what do I enter", not necessarily a literal value.
- the data is described in preconditions. No need to duplicate it in test_data.
- the value is the name of a UI element, button text, or an expected message. That's not test data.
- the URL is already moved into test_data, and the action contains only a description with no URL.
- the step describes a UI interaction with no data entry: click a button, click an element, select a menu item, navigate. For such steps, an empty `test_data` is normal. Examples: `Click the Log in button`, `Click the profile icon`, `Open the menu`. Don't flag the absence of test_data for click/tap steps.
- the `test_data` field (not action) contains an `example:` marker with a concrete value or format: `example: test@mail.com`, `example: +12025550123`, `example: Smith`. This is a valid format for the agent to generate a value — don't flag it. If the same marker is in the action text while test_data is empty — flag it per the severity rules above (medium if it's a URL or reused across steps, low otherwise).

In the `recommendation` field, don't propose concrete data values (email, password, ID, token). State only the type and, if you can infer one from context, a source: "State an email and password from test accounts in the test_data field of step N."

## How to fix

Before adding anything to `test_data`, check what the step's `action` actually does. If it's a pure UI interaction with no user-entered value — click a button, click an element, select a menu item, navigate — the step doesn't need test data at all, regardless of what the issue says. Mark the resolution `resolved` with `reason`: "Step is a UI interaction with no data entry — no test data needed", and leave `test_data` untouched.

**FORBIDDEN**: writing in any concrete data values — `test@mail.com`, `Password123`, `12345`, a real ID, a real token. Don't invent data, even if it looks obvious.

**Never write a placeholder or stand-in value either** — not `[email — test accounts]`, not `<email>`, not "TODO", not any other bracketed or quoted stand-in syntax. If the real value isn't in the source and you can't generate one per the rules below, the field stays exactly as it was (empty stays empty) and the issue is `manual_needed`. A placeholder gives the false impression the field is filled in; an empty field with a clear note does not.

**Data from the `comments` field:** If the step's `comments` field contains a concrete value with no example markers ("example", "e.g.", etc.) — it's an exact test value stated by the step's author. Move it into `test_data` as-is, without adding an `example:` marker. A vague wording in `action` ("a test value", "valid data", etc.) doesn't turn a concrete value from `comments` into an example. After moving it, update `action` so it describes the action without referencing concrete data (the data now lives in `test_data`).

If the action text has data, move it into `test_data` per these rules:

- **A concrete value** (with no marker like "example", "e.g."): move it as-is. Applies to any data type — name, email, phone, password, ID, amount, etc. Example: action = `Enter the email test@mail.com` → test_data = `test@mail.com`.
- **An example** (with a marker `example:`, `format:`, `e.g.`, `eg.`, or any equivalent, or a description of the type, "a valid X", "any X", "a correct X"): move it into test_data with the marker matching the source language, keyword only — normalize to this format regardless of the source wording. Use the word for "example" in the test case's own language, followed by a colon: `например:` for a Russian test case, `example:` for an English test case. Applies to any data type. Examples: action = `Enter an email, e.g.: test@mail.com` → test_data = `example: test@mail.com`; action = `Enter a phone number (format: +1XXXXXXXXXX)` → test_data = `example: +12025550123`; action = `Ввести фамилию, например: Иванов` → test_data = `например: Иванов`.

If the action describes the data as "valid", "any", "correct", "random" — with no concrete value and no explicit format in context (action, comments, preconditions, links) — split by data type:

- **Universal format** (email, date, time, plain number, plain text) — a widely accepted standard that can't be mistaken for anything else: generate a concrete example. Example: `enter a valid email` → test_data = `example: user@example.com`; `enter a valid date` → test_data = `example: 2000-01-01`.
- **Format depends on the business rules of a specific system** (phone number: country code, digit count, +/leading-zero presence; ID, token, article number: length, alphabet, prefix; any format that differs between systems) and it's nowhere explicitly stated in the test case — don't invent the format, and don't write a placeholder for it. This is missing information: mark it `manual_needed`: "Clarify the format of <data type> for step N — country code/length/allowed characters." Make an exception ONLY if the format is stated in text directly in the test case: the action states a concrete format (`format: +1XXXXXXXXXX`), or the same data type is already used in another step/precondition/comments with an explicit example value. The site's domain, interface language, company name, or other indirect signals of country/system are NOT an explicit format statement — don't guess a country code or number length from them.

**Important**: the `example:` marker (in the case-appropriate language) in test_data is a signal to an automated agent that it needs to generate its own value of the right format, not enter the text literally. Always use exactly that marker word, not other wordings. It's the one case where you write something other than a literal value — everywhere else, either write the real value or leave the field alone.

In both cases, remove the data from the action text — leave only the description of the action, with no values and no markers. Never leave both an inline example in action and a value in test_data at the same time. Move a URL from action into test_data unchanged; reword the action without the URL (e.g.: `Open the landing page`).

**Important about URLs**: a concrete URL from the source (a real address, not a description) is an exact value, not an example. Move it into test_data WITHOUT the `example:` marker, even if the action didn't say "concrete" or a similar qualifier. The `example:` marker for a URL is appropriate only if the address itself isn't explicitly stated in the source (e.g., `go to any catalog page`). Wrong: test_data = `example: https://krediska.ru/` — the URL is concrete, the marker isn't needed and misleads the agent (it will try to generate a different address). Correct: test_data = `https://krediska.ru/`.

If there's no data at all in the source and no way to generate a safe example (not a universal format, no explicit format given) → `manual_needed`: "State the test data for step N: <type>." Don't soften this into a placeholder — an empty field plus a clear manual_needed note is more honest than a stand-in value that looks filled in but isn't.
