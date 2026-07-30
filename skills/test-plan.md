---
name: test-plan
description: >-
  Generate a test plan from a PR's diff and description. Output is
  plain-English, observable, user-facing steps a non-engineer could follow
  against the deployed app.
---

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
  "the language picker" not `LanguagePicker`. "the + button at the
  bottom of the note" not `AddBlockButton`.
- Keep each step under ~15 words when possible.
- Include the deployment URL on the first navigation step if the change
  is web-visible.
- Use "Verify ..." for assertions. Say what the tester should see.
- Cover the golden path first, then 1-2 important edge cases.

**Don't:**
- Include em dashes, anywhere.
- Reference file paths, function names, variable names, env vars,
  feature-flag keys (unless the tester literally has to toggle one —
  then say "Enable the `flag-name` flag" and move on).
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

```
1. <step>
2. <step>
3. <step>
...
```

Do not use checkboxes. Do not include a summary or any other sections.

## Calibration

These are the kinds of test plans this skill should produce.

### Good (language switching mid-recording)

```
1. Start a new consultation.
2. While recording, without pausing, change the language.
3. Verify the action bar shows "Switching language...", the recording auto-pauses, and auto-resumes.
4. Speak in the new language and verify the transcription is correct.
```

### Good (icon picker crash fix)

```
1. Open the deployment, open the workflow builder, open the icon picker.
2. Type `te` in the search field. Verify icons appear and nothing crashes.
3. Try a few other short queries (`cre`, `luc`, `pen`). All should render without errors.
4. Pick a custom icon and verify it saves on the workflow.
```

### Good (sticky tab z-index fix)

```
1. Generate a note.
2. If it doesn't scroll, add text until the page scrolls.
3. Scroll down and verify the note header text does not overlap the top tabs.
```

### Bad (don't do this — too technical)

```
1. Point a v2 template at the OpenAI backend (modelBackend = 'openai').
2. Upload a DOCX, trigger note generation.
3. In the logs, find ai.v2.generate.attachments_forwarded and confirm docxExtractedCount: 1.
```

Why it's bad: the tester would need code access, log access, and
knowledge of internal event names. There's also no clear navigation
instructions for how to "point a v2 template at the OpenAI backend".
Rewrite as: "Upload a Word document to a consultation and verify the
generated note references its contents."

### Bad (don't do this - unclear steps)

```
1. Swipe left on a consultation card — confirm delete and multi-action buttons appear
  - Verify resuming works
  - Verify deletion works
3. Switch language via flag button during idle and recording states
4. Check all locale strings render correctly (switch language)
```

Why it's bad: "Verify resuming/deletion works" - what does "works"
mean? What is the observable behaviour that verifies "works"? For step #3,
there is no clear behaviour to verify. For step #4, "switch language" is
unclear; switch where? During recording, or in settings?

### Bad (don't do this — vague checkboxes)

```
- [ ] NOK org → "kr"
- [ ] EUR org → "€"
```

Why it's bad: no setup, no navigation, no "how do I become an EUR
org". Rewrite as numbered steps that tell the tester where to go and
what to click.
