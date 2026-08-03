## Reproducibility

A test case must be executable by a different tester without verbal explanations from the author.

Flag `high` if:
- it's impossible to tell which screen, state, or object to start from.
- a step requires knowledge that isn't in any field: title, preconditions, steps, test_data.
- the case can't be executed without hidden information from the author.

Flag `medium` if:
- a step references an undefined object. Examples: `select the right object`, `fill in the data`, `go to the right section`. It's unclear WHICH object, data, or section exactly.
- it's not specified which user, role, object, file, or record is used.

Don't flag if:
- the required information is in preconditions, test_data, or previous steps.
- the ambiguity doesn't prevent executing the case.
- the role isn't specified anywhere (preconditions, test_data, steps), but it clearly doesn't affect test execution. Don't flag it.
- the data is missing from test_data. That's a violation of the `test_data` rule, not `reproducibility`.
- a step describes a vague goal without an observable criterion. That's a violation of the `steps` rule, not `reproducibility`.
- the starting state is unclear because preconditions are empty — if the `preconditions` rule already flags this, don't duplicate the issue here. One cause — one issue.

## How to fix

Make vague objects in the steps concrete: instead of "select the right object" →
add a concrete description to the action, or move it into test_data.

If an object, code, record, file, or set of checkboxes is unknowable without
business context → `manual_needed`: "State the concrete object/record/file/
set of checkboxes for step N."

Don't invent a source for the data if the test case has no real `links` —
don't write "see linked documents" or similar when `links` is empty.
In that case, `manual_needed`: "State the source of the SMS code for
step N: test stand, test data, documentation, or a linked requirement."
