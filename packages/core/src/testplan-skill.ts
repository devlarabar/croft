// Vendored from skills/test-plan.md, genericized to take the diff/description
// as input. Embedded verbatim in the generation prompt.
export const TEST_PLAN_SKILL = `
# Test Plan Writer

Generate a test plan for a pull request. Input: the PR's diff and
description, and the URL of the deployment to test against.

The audience is a non-engineer tester (PM, designer, QA, support). They
will run these steps against the deployment without reading the code. If
a step requires opening a file, reading a log, running curl, or knowing
an internal variable name, the plan has failed.

## Steps

1. Read the diff. For large diffs, orient yourself with the file list
   before reading specifics.

2. Identify what is actually testable. Skip everything that is not.

   **Testable** (include):
   - New UI affordances (buttons, modals, pages, flows)
   - Changed UI behaviour (a thing that used to do X now does Y)
   - New user-facing features behind a flag
   - Security or permission changes a user can observe
   - Bug fixes where the user-visible symptom is now gone
   - Migrations or data changes a user can notice in the app
   - API/SDK contract changes that an integrator would hit

   **Not testable, skip silently** (do NOT add filler steps for these):
   - Refactors, renames, internal type cleanup
   - Test-only changes
   - Logging, telemetry, or metric additions with no UI surface
   - Dependency bumps with no behaviour change
   - Comment/doc changes
   - Build/CI tweaks

   If nothing in the diff is testable, say so instead of inventing a
   test plan.

3. For each testable change, write steps as a numbered list.

## Voice rules

Every step is a user story fragment. Read it back as if you were a
support agent reading a script.

**Do:**
- Lead with the verb the user performs: "Open", "Click", "Record",
  "Upload", "Switch", "Verify".
- Name UI elements by what the user sees, not by component name.
  "the language picker" not \`LanguagePicker\`. "the + button at the
  bottom of the note" not \`AddBlockButton\`.
- Keep each step under ~15 words when possible.
- Include the deployment URL on the first navigation step if the change
  is web-visible.
- Use "Verify ..." for assertions. Say what the tester should see.
- Cover the golden path first, then 1-2 important edge cases.

**Don't:**
- Include em dashes, anywhere.
- Reference file paths, function names, variable names, env vars,
  feature-flag keys (unless the tester literally has to toggle one —
  then say "Enable the \`flag-name\` flag" and move on).
- Tell the tester to read logs, inspect the network tab, run curl,
  query the database, or open devtools — unless the change is
  literally a backend contract with no UI, in which case say so up
  front and keep the technical bit to one line.
- Use jargon from the diff: "debounce", "race condition", "stacking
  context", "z-index", "schema", "factory function". The tester does
  not care why it broke, only what they should see now.
- Write vague one-liners with no setup ("EUR org → €"). Each step
  must be runnable cold.
- Pad with steps for things that aren't testable from the UI.

## Output

Print only the test plan as numbered steps:

\`\`\`
1. <step>
2. <step>
3. <step>
...
\`\`\`

Do not use checkboxes. Do not include a summary or any other sections.

If nothing in the diff is testable, print exactly:
NOTHING_TESTABLE
`;
