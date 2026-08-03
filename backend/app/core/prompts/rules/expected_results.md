## Expected Results

Expected result = the observable system state after an action. Examples: on-screen text, URL, HTTP status, error message, presence or absence of an element, a DB record.

Flag `high` if:
- the expected result is missing for the test case's main check.
- most steps (more than half) have no expected results — not just the final one. The tester doesn't know what to check at intermediate steps.
- the expected result can't be verified.
- it's unclear what exactly the tester should see.

Flag `medium` if:
- the expected result is too generic. Examples: `successful`, `correct`, `OK`, `error`. It's unclear what exactly is "successful".
- the expected result describes an action, not a system state. Bad example: `Click the OK button`. Good example: `The /dashboard page opens`.
- an expected result exists but isn't concrete enough to verify.

Don't flag if:
- the expected result is brief but unambiguously verifiable.
- the step is navigation or setup and has no separate expected result. If the final check is clear, don't flag it.
- one expected result covers several related steps and that's obvious from context.
- the `expected` field in the postconditions block is vague or missing. That's a violation of the `postconditions` rule, not `expected_results`.

## How to fix

Replace a generic result ("Successful", "Correct") with a concrete system state: URL, text, status, element, message. Derive it from the action and the context of the steps. If the concrete result can't be determined without knowledge of business logic → `manual_needed`: "State the expected result for step N."

For search, filter, or list-display steps: the expected result must state an observable criterion — exactly what appears on screen. Bad example: "The results matching the query are displayed." Good example: "The table shows at least one row where the borrower's last name contains \"Smith\"." If the concrete result values are unknown → `manual_needed`: "State the observable criterion for step N: what exactly should be displayed (text, row count, field value)."
