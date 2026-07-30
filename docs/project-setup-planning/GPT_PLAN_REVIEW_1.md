This is a review of the PLAN.md by GPT-5.

---

Overall, I think this is an unusually solid design. It reads like something a staff engineer would write rather than an early design doc.

The biggest thing that stood out to me is that **you've optimized for "simple operations" instead of "minimum number of components."** Those are different goals, and I think you picked the right one.

That said, I do think there are a few places where I'd simplify it.

---

# 1. Is there a simpler way?

**Not dramatically.**

For your workload, you basically have three kinds of execution:

* long-lived web app
* long-lived browser automation
* persistent state

Those naturally become:

* web container
* worker
* postgres

That's already about as small as you can make it.

The only architectures I'd seriously consider are:

| Architecture                               | Simpler? | Better?                        |
| ------------------------------------------ | -------- | ------------------------------ |
| Everything inside one always-on VM         | Yes      | No (unless always active)      |
| Single container doing both UI and workers | Slightly | Probably worse                 |
| Current design                             | ✓        | I think this is the sweet spot |

---

## I would merge the worker API

Right now:

```
UI
 ↓
Jobs API
 ↓
Worker
 ↓
Control Plane API
 ↓
Database
```

Instead I'd let the worker talk directly to Postgres and S3.

```
UI
 ↓
Jobs API
 ↓
Worker
 ↙      ↘
DB      S3
```

The control plane becomes almost stateless.

Benefits:

* one less API
* no auth between worker/control plane
* no event ingestion endpoint
* less code
* less latency
* easier local development

The worker already has DB credentials.

I don't think the HTTP hop buys much.

---

## I'd replace event posting

Instead of

```
POST /events
```

I'd literally expose

```
db.events.insert(...)
```

through Drizzle.

The worker owns writing events.

The UI owns reading them.

Very clean.

---

## Your event sourcing is excellent

This part I wouldn't change.

```
runs

events

artifacts
```

is exactly how I'd model it.

You're effectively using an append-only log.

That's easy to debug.

Easy to replay.

Easy to export.

---

# 2. Is there a cheaper way?

Honestly...

probably not.

You're already using nearly every "scale to zero" service Scaleway offers.

Your idle cost should genuinely be very close to zero because:

* Serverless Containers scale to zero.
* Serverless SQL can idle with 0 vCPU, though storage is still billed and waking the database adds a short delay. ([Scaleway][1])
* Jobs only bill while running.
* Object Storage is pennies.

The free tiers are also extremely generous for personal use. ([Scaleway][2])

---

The only cheaper architecture would be

```
Hetzner VPS
everything
```

For something like a $5/month VPS you'd run:

* Postgres
* Next.js
* Playwright
* workers

on one machine.

That's cheaper if you're active every day.

It is *not* simpler operationally.

---

# 3. Architecture feedback

This is where I have more opinions.

---

## Biggest smell: Provider registry

I like

```ts
ProviderAdapter
```

I do **not** like

```ts
models: string[]
```

Models change constantly.

I'd instead expose

```ts
listModels(): Promise<Model[]>
```

with caching.

Otherwise every provider update requires a deployment.

---

## Credential abstraction

This is excellent.

I'd keep

```ts
Credential.getToken()
```

exactly.

That's a nice boundary.

---

## Don't make adapters own OAuth

I'd separate

```
AnthropicAdapter
```

from

```
AnthropicOAuth
```

Today they're linked.

Tomorrow maybe Anthropic changes auth.

Now you've coupled transport with authentication.

I'd instead think in layers:

```
Credential
↓

Transport

↓

Provider Adapter
```

---

## Tool abstraction

Current:

```
browser_click

browser_type

browser_nav
```

I think that's right.

Don't invent generic agents.

---

## The browser assumptions

This sentence is probably my favorite in the doc:

> Don't generalize the browser agent early.

Exactly.

Senior engineers usually do this.

Junior engineers build

```
Universal Browser Automation Framework
```

Senior engineers build

```
CroftBrowser
```

and rename it in six months if necessary.

---

## Event schema

I'd make every event immutable.

Instead of

```
status = running
```

emit

```
run_started

step_started

tool_called

tool_finished

report_generated

run_finished
```

Never mutate.

Append only.

Makes debugging amazing.

---

## Run lifecycle

This is the only thing I'd simplify.

Instead of

```
Worker
↓

POST event

↓

Control Plane

↓

DB
```

just

```
Worker

↓

DB
```

---

## Preview URL discovery

I would move this back into the control plane.

Not because of timers.

Because discovery isn't agent work.

It's orchestration.

I'd do

```
Run requested

↓

control plane

↓

wait for preview

↓

launch worker
```

If your container platform can't comfortably wait, then your current worker-based polling is a pragmatic workaround. I just conceptually view "find the preview deployment" as orchestration rather than part of the browser agent.

---

## Review mode

I wouldn't use

```
bash
```

at first.

I'd expose

```
read_file

grep

glob

diff
```

Only.

The fewer arbitrary tools available, the more deterministic reviews become.

---

## Storage

Perfect.

No notes.

---

## Export

Perfect.

Streaming zip.

No buffering.

Exactly what I'd do.

---

## Build order

Excellent.

Especially this:

> Prove this before anything else.

That is exactly right.

Too many AI projects spend weeks on architecture before proving the core agent can actually solve the task.

---

# One thing I would add

I'd introduce a small service layer.

Instead of

```
github.ts

db.ts

worker.ts
```

I'd have:

```
RunService
ArtifactService
CredentialService
GitHubService
ProviderService
```

Then your HTTP routes become almost trivial:

```
POST /run

↓

RunService.start(...)
```

Likewise, the worker uses the same `RunService` methods for recording state. It keeps business logic out of route handlers and job entrypoints.

---

# Overall assessment

If I were reviewing this as a design document from a senior engineer, I'd probably score it like this:

| Area                   | Rating                    |
| ---------------------- | ------------------------- |
| Overall architecture   | 9.5/10                    |
| Operational simplicity | 10/10                     |
| Cost efficiency        | 10/10                     |
| Pragmatism             | 10/10                     |
| Overengineering        | 2/10 (low, which is good) |
| Extensibility          | 9/10                      |

The only meaningful simplification I'd push for is **letting the worker own persistence directly** instead of routing event writes through the control plane. That removes an entire internal API surface, reduces coupling, and makes local development easier without sacrificing much.

One final observation: the document consistently avoids premature abstractions ("don't generalize the browser agent", provider adapters rather than a universal AI framework, proving the Playwright loop first). That's a pattern I'd expect from someone who's already been burned by over-engineering before, and it's one of the strongest aspects of the design.

[1]: https://www.scaleway.com/en/docs/serverless-sql-databases/reference-content/serverless-sql-databases-overview/?utm_source=chatgpt.com "Serverless SQL Databases overview | Scaleway Documentation"
[2]: https://www.scaleway.com/en/pricing/serverless/?utm_source=chatgpt.com "Serverless Pricing | Scaleway"

