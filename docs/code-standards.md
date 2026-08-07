# Code Standards

**Obey these conventions aggressively.**

## General

- React components use TypeScript with strict mode.
- Use Tailwind CSS for styling with utility classes and custom tokens.
- Follow the existing code style and patterns in the project you're working on.
- Never commit without running tests first unless you're told otherwise.
- .vscode/ is gitignored (for worktree-specific themes).
- Never use `import * as` pattern — use named imports instead.
- Keep diffs reasonably minimal.
- Reuse whenever possible: before adding new code or logics, check if you can
  reasonably reuse anything.
- Avoid single-letter variable names.
- Absolutely no nested ternaries.
- Absolutely no inline typing.
- Avoid adding multiple components per file (unless a component is small and/or
  genuinely only used in the one file)
- Try to keep files less than 200-300 lines, if reasonably possible
- Readability is important
- Don't create or grow a `.tsx` file past ~500 lines. For all other file types,
  keep them under 300 lines. Extract focused, reusable, testable units where you
  can.
- Avoid hand-rolling logic or functionality that could be used from an existing,
  trusted package (i.e. from npm or pypi, Clerk, Posthog, Sentry or any other
  packages/SDKs)

## Comments

- Keep comments concise; avoid comments more than 3 lines. Comments should only
  be included if they don't restate what is stated already by code. A comment
  defending complex code means refactor first. Comments record external
  constraints (API quirks, browser rules), never justifications. Comment only
  what the code does, never what it doesn't do, and never why a choice is
  defensible. A line or two, accurate, with a link when citing external
  behavior; no task refs or restated code.

## Size

- **Fewest lines**: Solve the problem in as few implementation lines as
  possible; best PR is net negative. Usual offenders: factories, injected
  callbacks, compat paths, single-use abstractions, speculative variants.
- **PR size**: A good PR almost never exceeds a few hundred lines.
- **Dead code**: Delete obsolete code, config, imports, props, docs, and
  translation keys in the same change that obsoletes them; never leave expired
  paths behind.

## Structure and naming

- **Inline components**: Never define inner render functions/components inside a
  parent component; extract a real component file.
- **Domain naming**: Name procedures, files, hooks, fields, and types for their
  current domain responsibility; include units in measurement names.
- **Named types**: Reusable object and prop types are named declarations outside
  implementations; use a `.types.ts` module when they cross files.
- **State ownership**: Provider or domain store over prop drilling, and no
  JavaScript state for CSS-only layout.
- **Function passing**: Functions taking functions as parameters (callbacks,
  injected strategies, render props) are a complexity antipattern most of the
  time; prefer direct calls, composition, or data. Reach for higher-order shapes
  only when the variation genuinely exists today.
- **DRY, second copy**: Literal duplication within the same PR gets extracted to
  a shared helper; first copy stays inline. Before writing anything
  shared-looking, search for the existing repo/SDK/design-system definition and
  use it.


## Types and validation

- **No type erasure**: Never erase type uncertainty with casts, non-null
  assertions, or `any`; narrow, infer, or model the contract.
- **Boundary validation**: Validate stored, provider, and external boundary data
  with typed schemas (Zod), not assertions.
- **Error shape guards**: Use documented SDK type guards or explicit error
  fields; never crawl unknown error object graphs with casts or invented depth
  limits.


## Errors, async, and resilience

- **Silent fallbacks**: Never silence a missing value with `?? 'unknown'` or `||
  default`; fix why the value is missing or handle absence explicitly. Loading
  is not absence: never render pending query state as an empty or alternate
  domain state. Real domain defaults (locale `'en'`) are fine.
- **User-facing errors**: User-triggered failures show a visible, actionable
  error with recovery; never raw backend text, never dead controls. Model
  failures as one closed set of explicit error states.
- **Async recovery**: Async transitions recover from failure, disconnect, and
  unmount without data loss or permanent pending state; guard stale completions
  and duplicate submissions; roll back optimistic state visibly on error.
- **Effect cleanup**: Cancel timers, retries, watchdogs, and debounces when
  replacing work, navigating, closing, or unmounting.
- **Hot paths**: Hot paths select, memoize, and query only the smallest data
  needed; no unbounded queued work, no sequential awaits on independent calls.

## Testing

- **Tests with the logic** (Journalia): New logic in
  `packages/core/src/modules/**` gets a sibling `*.test.ts` in the same commit;
  follow-up tests never happen. Cover regressions, failure paths, boundaries,
  and hidden branches, not just the happy path.
- **Mock testing itself**: A test that mocks the unit under test and asserts on
  the mock proves nothing; delete it. Same for shallow renders, prop-forwarding
  checks, and tests of framework behavior.
- **Narrowest seam**: Prove behavior at the narrowest seam that owns it; a
  higher-layer test must assert a distinct contract, not re-prove the same
  thing.
- **Refactor-prood:** A test that breaks when the tested unit is refactored is a
  poor test. Test outcomes, not implementations.
- **E2E waits**: Playwright waits on specific UI assertions, never
  `networkidle`. PostHog feature-flag keys use dashes, not dots.

## Telemetry and logging

- **Telemetry survives refactors**: When deleting/renaming code that
  emitted telemetry (`capture`, `wideEvent`), port the events to the
  replacement; don't silently drop signals.
- **Failure telemetry**: Consequential failure paths and user
  actions emit structured telemetry (`wideEvent`) on every supported
  implementation path.
- **Provider payload logging**: Never log raw provider response bodies, prompts,
  or completions; log allowlisted scalar metadata (status, model, request id)
  only. Telemetry fields are allowlisted; never capture clinician identity,
  names, or free text.

## Security and data protection

- **tRPC authz** (Journalia): Every new tRPC procedure taking a foreign-key ID
  (organizationId, userId, cohortId) must verify caller access; prefer existing
  middleware (`adminProcedure`, `memberOfOrgProcedure`) over inline checks.
  Isolate privileged queries; `adminProcedure` is Journalia staff only, never
  org-admin gating.
- **PHI encryption** (Journalia): Every stored field that may contain
  transcripts, provider output, or other PHI is encrypted at rest.
- **PHI in URLs** (Journalia): Never put PHI in URL query parameters; sensitive
  data goes in the request body.
- **Audit append-only** (Journalia): Audit tables are append-only (guarded
  against UPDATE/DELETE/TRUNCATE) and every audited mutation writes a row.
- **DB integrity**: Integrity constraints live in the database; concurrent
  limits, dependent deletes, and state-plus-audit writes are atomic
  transactions.

## UI

- **Forms** (Journalia): Any new form or controlled-input cluster uses
  react-hook-form + Zod; copy an existing repo example. Exception: single
  unvalidated search/filter input.
- **Tailwind tokens** (Journalia): No Tailwind arbitrary values (`[12px]`,
  `[#a1b2c3]`); use design tokens. Missing token = design conversation, not a
  one-off.
- **A11y semantics**: Use native semantic controls with valid nesting,
  accessible names, keyboard behavior, and adequate touch targets; no
  div-buttons.
- **i18n completeness** (Journalia): A new or changed user-facing string updates
  every locale file in `apps/web/messages/` together, uses ICU pluralization,
  and removes superseded keys. Adminalia changes don't require new message
  strings.

## Config

- **process.env** (Journalia): `process.env` only in `apps/web/env.ts`;
  everywhere else imports from there.
</critical_code_standards>
