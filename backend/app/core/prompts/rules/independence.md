## Independence

A test case must run in any order. It must not depend on other test cases.

Flag `high` if:
- preconditions require another test case to have been run. Example: `REG-001 must have passed`.
- the steps continue a scenario from another case without explicit data preparation.
- the case requires a state that's only created by another test.
- the result depends on the order in which the test suite runs.

Flag `medium` if it's unclear how to prepare the user, data, or environment without running another case.

Don't flag if:
- the required state is explicitly described in preconditions.
- the data can be prepared via UI, API, DB, a fixture, or a test account.
- the case uses shared test data that doesn't depend on the result of another case.

## How to fix

Replace the reference to another test case with a description of a concrete system state. Move the required state into preconditions or test_data. If the state can't be determined without knowledge of other test cases → `manual_needed`: "Describe what state the system must be in before this test, without referencing another test case."
