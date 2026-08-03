## Description

Flag `medium` if the description contradicts the title, steps, or expected result.

Flag `low` if:
- the description is missing. Add 1–2 sentences: what is being checked, under what conditions, what's the expected outcome. A missing description is always `low`, never `medium` or `high`.
- the description is a verbatim repeat of the title.

Don't flag if the description already exists and reflects the essence of the case.

## How to fix

Write 1–2 sentences: what is being checked + under what conditions + the expected outcome. Examples:
- "Verifies login with valid credentials. Expects successful authentication and redirect to the home page."
- "Verifies the error message shown when an incorrect password is entered. The form stays open."

Don't copy the title. Derive only what follows from the steps.
