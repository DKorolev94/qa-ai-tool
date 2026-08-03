## Postconditions

Postcondition = the system's final state after the test.

Flag `medium` if:
- the test creates, modifies, or deletes data, but postconditions aren't described. The leftover state gets in the way of re-running the test and other cases.

Flag `low` if:
- the `action` field mixes system state and observed result in one line. Bad example: `Order canceled, status changed to Canceled`. Correct: action = `Order canceled`, expected = `The UI shows status "Canceled"`.
- the postcondition duplicates the expected result of the last step. A postcondition should describe the durable system state after the test, not repeat what's already captured in the final step's expected result.

Don't flag if postconditions are missing and the test doesn't change system state (a read-only scenario).

Don't flag if postconditions are described correctly: `action` = the system's final state, `expected` = the observable confirmation.

## How to fix

The `action` field = the system's final state (a fact). Examples: "Record is deleted", "Order is canceled", "Data is unchanged".
The `expected` field = the observable confirmation. Examples: "GET /items/{id} returns 404", "The UI shows status \"Canceled\"".

If `action` mixes state and observable result, split them. The `expected` field is required — don't leave it empty.

If postconditions are missing and the test is read-only — don't add anything.

If postconditions are missing and the test changes data → `manual_needed`: "Describe the system's final state after the test runs." Don't invent an API endpoint, SQL query, or cleanup action — they aren't in the test case.

If a postcondition duplicates the expected result of the last step: reword it as the durable system state that persists after the test. `action` = the fact that the state changed ("Application created", "User authenticated"), `expected` = the observable confirmation of that state. If the durable state can't be determined from context → remove the postcondition and mark it `manual_needed`.
