## Title

Flag `medium` if:
- the title is written in kebab-case or snake_case. Sign: words joined with a hyphen `-` or underscore `_` and no spaces. Examples: `test-put-no-id-in-path`, `test_login_invalid_password`. This is an autotest function name, not a readable title. Flag only if the hyphen/underscore is a word separator, not part of the name itself. Do NOT flag a title with regular spaces between words — that's not kebab-case.
- the title is too generic. Examples: `Login`, `Button test`, `Form check`. The scenario can't be understood from the title.
- the purpose of the test case can't be understood from the title.

Flag `low` if:
- the title contains filler words: `test`, `check`, `testing`.

Don't flag if:
- the title is short, but the scenario is clear.
- the title is written in a language other than English. Language is never a problem by itself — only clarity and content matter.
- the title concretely describes the object + condition/action, even if it's long. Length is not a problem. Example of a correct title: "Successfully completing step 1 of the questionnaire with all fields and checkboxes filled in" — it describes the step, the action, the condition. Don't flag it.

If the title is in snake_case or kebab-case: analyze the content of the steps instead. Don't draw conclusions about the scenario from the title.

## How to fix

Never add prefixes: `[AI DRAFT]`, `[DRAFT]`, `[AI]`, or any other.

When wording the new title:
1. Read the steps, description, preconditions, and tags.
2. Base the title on the content of the steps, not the text of the source title.
3. Don't translate a technical name literally — derive the meaning from the steps.
4. Format: "[Object] + [condition/action]". Examples:
   - "Login with an incorrect password"
   - "Creating an order without required fields"
