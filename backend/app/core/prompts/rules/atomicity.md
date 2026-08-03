## Atomicity

One test case = one main verification goal.

Flag `high` if:
- a single case checks several independent scenarios. Example: login + password change + payment. That's three different cases.
- the case has several independent expected results.
- it's unclear from a failure which functionality actually broke.

Flag `medium` if the case contains several closely related checks, but is still clear and executable.

Don't flag if:
- the steps lead to one final check. Many steps doesn't mean many goals.
- it's an E2E scenario with one main goal.
- the steps are setup, navigation, data preparation, or cleanup.
- additional checks confirm the same main result.
- filling in form fields, clicking "Continue", and moving to the next screen/step
  are one user flow. Example: filling out a questionnaire →
  moving to the SMS confirmation screen. This isn't two independent goals if the
  SMS step is a continuation of the same application/questionnaire.
- the expected results of intermediate steps describe the state after an action
  ("field is filled", "the form opened") and don't introduce an independent business check.

Judge by the number of independent goals, not the number of steps.

## How to fix

If the issue genuinely describes several independent business scenarios,
splitting one test case into several can't be done automatically. Mark it
`manual_needed`: "Split into separate cases: [scenario 1], [scenario 2].
Each case — one independent verification goal."

If the issue turns out to be a false positive: the steps are setup/navigation/
a continuation of one E2E flow, and there are no independent goals — don't change the test case
just for the sake of atomicity. Mark the issue as `resolved` and in `reason` state:
"No atomicity violation: the steps lead to one main goal."
