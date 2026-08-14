# ZagrosAI
## Zero-to-Hero Product, Harness, Architecture, UX, Security, Cloudflare Strategy, and v0.1.0 → v1.0.0 Roadmap

**Working definition**

> **ZagrosAI is an open-source operating system for persistent AI agents. Use any model. Connect any MCP tool. Bring existing provider-native agent subscriptions where officially supported. Run locally, serverlessly, or across your own machines. Close your laptop and let cloud-capable work continue.**

ZagrosAI should not be an open-source clone of Grok's model.

It should be an **open alternative to the entire Grok Bot runtime**.

The project owns:

- the agent harness;
- execution orchestration;
- memory;
- tasks;
- skills;
- approvals;
- files;
- browser control;
- worker discovery;
- scheduling;
- provider routing;
- model capability negotiation;
- phone/desktop UX;
- security policy;
- audit history.

The model is only one replaceable component.

---

# 1. The North Star

The fundamental invariant should be:

```text
THE AGENT IS NOT THE MODEL.

Model = intelligence provider
MCP = tools
ACP = provider-native coding/agent harnesses
A2A = external agents
ZagrosAI = orchestration + memory + execution + UX + security
```

ZagrosAI should eventually let a user say from their phone:

> Check the five open issues in my repository, reproduce anything that looks like a bug, prepare fixes, ask me before opening PRs, and send me a notification when you're done.

They can then lock their phone.

ZagrosAI decides:

```text
GitHub API work
    ↓
Cloudflare

Reasoning
    ↓
available cloud model

Need browser?
    ↓
Cloud browser

Need shell?
    ↓
available ZagrosAI Runner

Need local laptop file?
    ↓
pause only that step

Everything else
    ↓
continue
```

The task itself remains alive.

---

# 2. What v1.0.0 Should Compete With

As of August 2026, Grok Bot's important capabilities include a persistent managed cloud computer, browser, command line, files, connected tools/MCP, routines that continue when a laptop is closed, approvals, mobile access, and multiple durable Bots. Its cloud computer is shared across a user's Bots rather than being a separate security boundary per Bot.

Grok Bot currently supports desktop macOS/Windows and iOS, while its persistent managed Linux computer continues working independently of the user's local machine.

ZagrosAI's goal should be **measurable parity or superiority**, not marketing claims such as "beats every agent."

By v1.0, target:

| Capability | ZagrosAI target |
|---|---|
| Persistent agents | Yes |
| Laptop-off execution | Yes for cloud-capable tasks |
| Persistent full computer | Through available Runner |
| Browser automation | Cloud + local + remote |
| Terminal/files | Runner based |
| Any LLM | Yes |
| Local LLMs | Yes |
| Provider-native subscriptions | Through officially supported harness bridges |
| MCP | First-class |
| MCP OAuth | First-class |
| Skills | First-class |
| Scheduled routines | Yes |
| Event-triggered routines | Yes |
| Human approvals | Yes |
| Remote takeover | Yes |
| Multiple agents | Yes |
| A2A | Yes |
| ACP | Yes |
| Android | PWA |
| iOS | PWA |
| Desktop | Same web app/PWA |
| Image uploads | Yes |
| Video uploads | Yes |
| Audio uploads | Yes |
| Documents | Yes |
| Phone-only operation | Yes for cloud-capable work |
| Self-hostable | Yes |
| Cloudflare optional | Yes |
| Vendor lock-in | No |
| Per-agent security isolation | Target stronger than shared-computer architecture |
| Reproducible evals | Yes |
| Audit trail | Yes |

---

# 3. Five Non-Negotiable Design Principles

## 3.1 Model neutrality

Never design the runtime around one model's proprietary tool format.

Create a normalized model interface:

```ts
interface ModelDriver {
  id: string;

  capabilities(): Promise<ModelCapabilities>;

  stream(request: ModelRequest): AsyncIterable<ModelEvent>;

  generate(request: ModelRequest): Promise<ModelResponse>;
}
```

Capabilities:

```ts
interface ModelCapabilities {
  textInput: boolean;
  imageInput: boolean;
  audioInput: boolean;
  videoInput: boolean;

  toolCalling: boolean;
  parallelTools: boolean;
  structuredOutput: boolean;

  maxContext?: number;

  reasoningControls?: string[];

  supportsFiles: boolean;
}
```

The harness adapts itself to the model.

The model never defines the harness.

---

## 3.2 Cloudflare is a runtime adapter, not ZagrosAI

Never make:

```text
ZagrosAI == Cloudflare
```

Instead:

```text
ZagrosAI Kernel
      │
      ├── Cloudflare Runtime
      ├── Local Runtime
      └── Self-hosted Runtime
```

Cloudflare should be the recommended **zero-VPS reference deployment**, not an architectural dependency.

---

## 3.3 Every task is durable

A task is not just:

```text
async function runAgent() {}
```

It is a durable state machine.

```text
QUEUED
   ↓
PLANNING
   ↓
RUNNING
   ↓
WAITING_FOR_TOOL
   ↓
WAITING_FOR_APPROVAL
   ↓
WAITING_FOR_WORKER
   ↓
RUNNING
   ↓
VERIFYING
   ↓
COMPLETED
```

Other terminal states:

```text
FAILED
CANCELLED
EXPIRED
BLOCKED
```

If a machine disappears, the **task survives**.

---

## 3.4 Actions have capabilities and risk

Every operation declares:

```yaml
execution:
  edge: true
  browser: false
  sandbox: false

side_effects:
  external_write: true

risk:
  level: high

approval:
  default: required
```

The model cannot bypass that metadata.

---

## 3.5 Everything important is replaceable

ZagrosAI must work without:

```text
OpenAI
Anthropic
Google
xAI
Cloudflare
OpenRouter
Ollama
Docker
Playwright
```

Individual adapters can depend on them.

The kernel cannot.

---

# 4. Top-Level Architecture

```text
┌────────────────────────────────────────────────────────────┐
│                     ZAGROSAI CLIENTS                       │
│                                                            │
│      Desktop Web       PWA        iPhone       Android     │
└────────────────────────────┬───────────────────────────────┘
                             │
                  HTTPS / WebSocket / SSE
                             │
┌────────────────────────────▼───────────────────────────────┐
│                   ZAGROSAI CONTROL PLANE                  │
│                                                            │
│  Auth / Pairing                                             │
│  Agent Registry                                             │
│  Task Registry                                              │
│  RegaHarness                                                │
│  Scheduler                                                  │
│  Approval Engine                                            │
│  Memory                                                     │
│  Files / Artifacts                                          │
│  Notification Service                                      │
│  Audit Log                                                  │
└──────┬─────────────┬──────────────┬──────────────┬─────────┘
       │             │              │              │
       ▼             ▼              ▼              ▼
 Model Fabric    Tool Fabric    Skill Fabric   Execution Fabric
       │             │              │              │
       │             │              │        ┌─────┴──────────┐
       │             │              │        │                │
       ▼             ▼              ▼        ▼                ▼
 GPT/Claude       MCP          Skills     Cloud         ZagrosAI
 Gemini/Grok      native       registry   execution     Runners
 local/etc.       tools                                │
                                                         ├ laptop
                                                         ├ desktop
                                                         ├ NAS
                                                         ├ server
                                                         └ sandbox
```

---

# 5. RegaHarness — The Core Product

The competitive advantage should be the **harness**, not another collection of API wrappers.

Name it:

```text
RegaHarness
```

Its job is to convert:

```text
user intent
```

into:

```text
verified durable outcome
```

## RegaHarness pipeline

```text
1. Input Normalizer
       ↓
2. Intent Classifier
       ↓
3. Context Compiler
       ↓
4. Capability Resolver
       ↓
5. Plan Graph Compiler
       ↓
6. Model Router
       ↓
7. Policy Preflight
       ↓
8. Executor
       ↓
9. Observation Normalizer
       ↓
10. Verifier
       ↓
11. Checkpoint
       ↓
12. Memory Writer
       ↓
13. Continue / Complete
```

---

# 6. Input Normalizer

Everything entering ZagrosAI becomes one normalized message:

```ts
interface RegaMessage {
  text?: string;

  attachments: Attachment[];

  replyTo?: string;

  source:
    | "web"
    | "mobile"
    | "routine"
    | "webhook"
    | "a2a"
    | "api";

  userId: string;
  agentId: string;
}
```

Attachments:

```ts
type Attachment =
  | ImageAttachment
  | VideoAttachment
  | AudioAttachment
  | DocumentAttachment
  | CodeAttachment
  | GenericFileAttachment;
```

This gives the same experience on:

```text
phone
tablet
desktop
API
automation
```

---

# 7. Context Compiler

Do **not** dump everything into the model.

The compiler selects only what matters.

Context layers:

```text
Agent identity
     +
Task
     +
Recent conversation
     +
Relevant long-term memory
     +
Relevant skills
     +
Available tools
     +
Execution capabilities
     +
Attachments
     +
Security constraints
     +
Current task state
```

Tool descriptions should be dynamically retrieved.

Skill contents should be dynamically retrieved.

Memory should be retrieved based on task relevance.

That keeps the harness usable with models from very small local models to frontier models.

---

# 8. Plan Graph Instead of Giant Agent Loops

Represent work as a graph:

```text
Task
 │
 ├── Research
 │       │
 │       ├── Search
 │       └── Read sources
 │
 ├── Analyze
 │
 ├── Modify
 │
 └── Verify
```

Every node has:

```ts
interface TaskStep {
  id: string;

  objective: string;

  dependencies: string[];

  requirements: ExecutionRequirements;

  status: StepStatus;

  attempts: number;

  approval?: ApprovalRequirement;

  result?: ArtifactReference[];
}
```

This enables:

- retries;
- parallel execution;
- moving work between machines;
- resuming after outages;
- human approval;
- deterministic task history.

---

# 9. Executor Selection

Every step receives an execution class.

```text
EDGE
DURABLE
BROWSER
SANDBOX
LOCAL
REMOTE
PROVIDER_HARNESS
HUMAN
```

Example:

```text
"Read GitHub issue"

EDGE
```

```text
"Open website and fill form"

BROWSER
```

```text
"Run npm test"

SANDBOX
```

```text
"Open Photoshop"

LOCAL
```

```text
"Ask user before sending"

HUMAN
```

ZagrosAI chooses the best currently available executor.

---

# 10. The Execution Fabric

This is one of ZagrosAI's most important ideas.

Do not think:

```text
one agent = one computer
```

Think:

```text
one agent = access to a fabric of execution environments
```

Example:

```text
Research Agent
    │
    ├── Cloudflare
    │      APIs / MCP / scheduling
    │
    ├── Browser Run
    │      websites
    │
    ├── Desktop-PC
    │      terminal / local files / GPU
    │
    ├── NAS
    │      24/7 shell
    │
    └── GPU-Server
           local LLM
```

If Desktop-PC disappears:

```text
Desktop-PC     OFFLINE

Cloudflare     ONLINE
Browser        ONLINE
NAS            ONLINE
GPU server     ONLINE
```

The agent does **not** stop.

Only steps requiring Desktop-PC wait.

---

# 11. ZagrosAI Runner

Create:

```text
zagrosai-runner
```

Prefer Rust for the long-term runner.

Responsibilities:

```text
outbound secure connection
worker identity
capability advertisement
filesystem access
shell execution
Docker/Podman execution
Playwright browser
local models
provider CLIs
desktop applications
file transfer
screenshots
logs
approvals
heartbeat
```

The runner connects outward.

Users should never need:

```text
port forwarding
public IP
router configuration
```

Pairing:

```text
zagrosai runner start

Pair this computer:

ABCD-EFGH

or scan QR
```

Phone:

```text
Settings
→ Computers
→ Add computer
→ Scan QR
```

---

# 12. Runner Capability Advertisement

A runner announces:

```json
{
  "os": "linux",
  "arch": "x86_64",

  "capabilities": {
    "shell": true,
    "docker": true,
    "browser": true,
    "gpu": true,
    "filesystem": true
  },

  "models": [
    "ollama:qwen",
    "ollama:llama"
  ],

  "harnesses": [
    "codex",
    "claude-code",
    "gemini-cli"
  ]
}
```

The scheduler now understands what it can delegate.

---

# 13. Cloudflare Reference Architecture

Cloudflare is particularly suitable for the serverless control plane because its current agent platform includes durable identities, state, WebSockets, scheduling, recovery, MCP support and browser/sandbox integrations. Cloudflare explicitly allows developers to swap among model providers.

ZagrosAI should nevertheless wrap Cloudflare behind its own interfaces.

Recommended layout:

```text
Cloudflare

Workers
 └ API / auth / uploads / webhooks

Durable Objects / Agents runtime
 └ live agent sessions
 └ WebSockets
 └ presence
 └ approvals
 └ short-lived state

Workflows
 └ durable background jobs
 └ retries
 └ sleeping
 └ schedules
 └ external waits

D1
 └ agents
 └ tasks
 └ metadata
 └ messages
 └ connector records
 └ audit events

R2
 └ images
 └ videos
 └ files
 └ task artifacts
 └ screenshots

Browser Run
 └ lightweight cloud browser

Workers AI
 └ optional cloud inference fallback
```

---

# 14. Why Workflows Matter

Cloudflare Workflows are currently available on the Workers Free plan and support durable execution, persisted state, retries and sleeping without charging active CPU while a Workflow is merely waiting. Current Free limits include 100,000 shared Workers requests/day and 3,000 Workflow steps/day. These limits can change, so ZagrosAI's README should link to Cloudflare's current documentation rather than promising fixed lifetime quotas.

This gives ZagrosAI:

```text
Laptop OFF

Workflow remains
    ↓
wait 3 hours
    ↓
wake
    ↓
call model
    ↓
call MCP tool
    ↓
store result
    ↓
sleep again
```

---

# 15. Cloudflare's Important Limitation

Do not hide this.

Cloudflare's Free Workers environment is **not a free arbitrary Linux VM**. Its container compute is not available on the Free plan.

Therefore:

```text
Cloudflare alone
≠
Grok Bot's unlimited persistent Linux computer
```

ZagrosAI solves this through the **Execution Fabric**.

Cloud-capable work continues.

Computer-required work moves to a Runner.

---

# 16. Cloud Browser Strategy

Cloudflare Browser Run currently provides browser sessions on both Free and paid Workers accounts; the Free allocation is limited to 10 browser minutes/day and three concurrent browser sessions.

Therefore:

```text
small browser task
   ↓
Cloudflare Browser Run

large browser task
   ↓
ZagrosAI Runner

persistent local-login browser
   ↓
ZagrosAI Runner

custom remote browser
   ↓
BrowserProvider adapter
```

Create:

```ts
interface BrowserProvider {
  createSession(): Promise<BrowserSession>;
  resumeSession(id: string): Promise<BrowserSession>;
}
```

Adapters:

```text
CloudflareBrowser
LocalPlaywright
RemotePlaywright
BrowserUse
CustomCDP
```

Browser Use is already an open-source project designed for model-independent browser automation and supports several major model providers, so it is worth supporting as an optional browser backend rather than rebuilding every browser-agent technique yourself.

---

# 17. Zero-Cost Cloud Model Fallback

Workers AI currently includes a daily free inference allocation on Workers Free accounts.

That creates an excellent ZagrosAI default:

```text
Laptop ON

preferred:
local model / subscription harness

Laptop OFF

fallback:
Workers AI
```

Example:

```yaml
models:

  preferred:
    driver: ollama
    model: qwen

  offline_fallback:
    driver: cloudflare
    model: configurable

offline:
  unavailable_model: fallback
```

Alternative:

```yaml
offline:
  unavailable_model: pause
```

User controls the policy.

---

# 18. Model Fabric

Every provider becomes a driver.

Repository:

```text
packages/models/
├── core
├── openai
├── anthropic
├── google
├── xai
├── openrouter
├── cloudflare
├── ollama
├── vllm
├── lmstudio
└── openai-compatible
```

The generic OpenAI-compatible driver should be a first-class citizen.

That immediately covers many self-hosted inference systems.

---

# 19. Provider Authentication: Four Classes

Do not treat authentication as simply:

```text
API key
```

Define:

```text
API_KEY
OAUTH_API
HARNESS_BRIDGE
LOCAL
```

## API_KEY

Normal developer API credentials.

## OAUTH_API

Provider explicitly allows application OAuth against its API.

## HARNESS_BRIDGE

ZagrosAI talks to the provider's official agent CLI/harness rather than stealing its credentials.

## LOCAL

No external provider authentication.

---

# 20. Subscription-Based Provider Use

This is important.

ZagrosAI should **never** reverse engineer consumer authentication.

Never:

```text
steal browser cookies
extract session tokens
call undocumented endpoints
pretend a consumer subscription is an API subscription
```

Instead use **ACP/provider-harness bridges**.

ACP v2 is a JSON-RPC protocol designed so clients can communicate with external coding agents, including authentication, sessions, streaming updates and permission requests.

OpenHands already demonstrates the architecture: its Agent Canvas can run Claude Code, Codex and Gemini CLI through ACP, with the provider CLI retaining ownership of its own authentication and tool execution.

ZagrosAI should use the same architectural principle.

---

# 21. OpenAI

Official Codex CLI supports signing in with an existing ChatGPT account and using Codex through eligible ChatGPT subscriptions; it also supports separate API-key usage.

Therefore:

```text
ZagrosAI
   ↓ ACP
Codex CLI
   ↓
ChatGPT-authenticated Codex
```

Not:

```text
ZagrosAI
   ↓ stolen Codex token
OpenAI undocumented endpoint
```

Driver modes:

```text
openai-api
codex-acp
```

Critical rule:

> A Codex subscription login stays owned by Codex.

---

# 22. Anthropic

Claude Code is designed to run through terminal/IDE/desktop/browser surfaces and supports Claude subscriptions or Anthropic Console access. Anthropic also provides its Agent SDK for custom workflows.

ZagrosAI should therefore support:

```text
anthropic-api
claude-code-acp
```

The ACP path allows:

```text
ZagrosAI UI
    ↓
ZagrosAI harness delegation
    ↓
Claude Code
    ↓
Claude Code's own authentication
```

Again, never extract its internal login token for unrelated API calls.

---

# 23. Google Gemini

Google's Gemini API officially supports OAuth authentication for applications.

Gemini CLI also supports Google-account OAuth and explicitly supports users with Gemini Code Assist licenses; its current documentation describes Google sign-in and a free personal-account quota.

Therefore ZagrosAI can support both:

```text
gemini-api-oauth
gemini-api-key
gemini-cli-acp
```

This is probably the cleanest first provider for testing the full OAuth architecture.

---

# 24. xAI / Grok

xAI's public API quickstart currently uses separately funded API credentials.

Grok Build also documents OIDC/device authentication for its managed deployment scenarios, but ZagrosAI should not assume that a consumer Grok subscription automatically authorizes arbitrary ZagrosAI API usage.

Support:

```text
xai-api
grok-build-bridge
```

only according to documented provider interfaces.

---

# 25. Provider Matrix

| Provider | Direct API | OAuth API | Subscription/harness bridge |
|---|---:|---:|---:|
| OpenAI | Yes | Provider-specific | Codex ACP |
| Anthropic | Yes | As documented | Claude Code ACP |
| Google | Yes | Yes | Gemini CLI ACP |
| xAI | Yes | Limited/documented contexts | Grok Build adapter where supported |
| OpenRouter | Yes | — | — |
| Cloudflare Workers AI | Binding/API | Cloudflare identity | — |
| Ollama | Local | — | Local |
| vLLM | Local/remote | — | Local |
| LM Studio | Local | — | Local |
| Any OpenAI-compatible | Yes | Adapter-specific | Adapter-specific |

---

# 26. Important Laptop-Off Rule for Subscription Harnesses

Suppose:

```text
Codex CLI login
exists only on laptop
```

Laptop goes off.

Cloudflare cannot magically run that CLI.

Therefore:

```text
Codex ACP
UNAVAILABLE
```

ZagrosAI then follows user policy:

```text
fallback to cloud API/model

or

pause model-required steps

or

move task to another Runner
```

If an always-on ZagrosAI Runner has its own valid Codex/Claude/Gemini login, the harness can continue there.

The README must state this clearly.

---

# 27. MCP — The Tool System

MCP should be ZagrosAI's primary public tool protocol.

The current MCP specification standardizes LLM application access to tools, resources and prompts, and now includes additional capabilities such as asynchronous tasks and Skills over MCP.

ZagrosAI should support:

```text
Remote HTTP MCP
Local stdio MCP
OAuth-protected MCP
Unauthenticated MCP
Runner-hosted MCP
```

MCP HTTP authorization currently uses OAuth 2.1 patterns, Protected Resource Metadata and audience/resource-bound tokens.

Implement the standard.

Do not invent:

```text
ZagrosAI proprietary connector protocol
```

---

# 28. Tool Registry

Normalize every tool:

```ts
interface ToolDefinition {
  id: string;
  source: "mcp" | "native";

  description: string;
  schema: JSONSchema;

  requirements: ExecutionRequirements;

  risk: RiskMetadata;

  idempotency: IdempotencyMetadata;

  secrets: SecretRequirement[];

  outputClassification: OutputClassification;
}
```

The model sees only tools relevant to the task.

Never send 700 full schemas into every prompt.

---

# 29. Native Core Tools

Keep a small native core:

```text
files.read
files.write

http.fetch

browser.*

shell.*

task.*
memory.*

artifact.*

notification.*

approval.*

worker.*

agent.*
```

Everything else should generally be MCP.

---

# 30. Skills

A skill is **procedural knowledge**, not merely another tool.

Recommended package:

```text
skills/
└── fix-github-issue/
    ├── SKILL.md
    ├── skill.yaml
    ├── schemas/
    ├── scripts/
    ├── tests/
    └── assets/
```

`skill.yaml`:

```yaml
name: fix-github-issue
version: 1.0.0

description: >
  Investigate, reproduce, fix and verify a GitHub issue.

requires:
  tools:
    - github
    - shell
    - filesystem

capabilities:
  shell: true

approval:
  git_push: required

verification:
  - tests_pass
  - diff_reviewed
```

---

# 31. Skill Discovery

Do not inject every installed skill.

Flow:

```text
Task
 ↓
skill index search
 ↓
candidate skills
 ↓
trigger evaluation
 ↓
load selected SKILL.md
```

The current MCP specification's Skills-over-MCP direction makes it worthwhile to design ZagrosAI skills so they can eventually be exposed or discovered through standard MCP skill mechanisms rather than becoming an isolated ecosystem.

---

# 32. Community Skill Registry

Eventually:

```bash
zagrosai skill install github:username/repository
```

or:

```bash
zagrosai skill install org/name
```

Registry requirements:

```text
version
author
license
permissions
required tools
required executors
hash
signature
tests
supported ZagrosAI version
```

No arbitrary skill should automatically receive secrets.

---

# 33. ACP — Provider Harness Integration

ACP should serve a very specific role:

```text
ZagrosAI
   ↕ ACP
Provider coding/agent harness
```

Examples:

```text
Codex
Claude Code
Gemini CLI
future coding agents
```

ACP supports session creation/resumption, prompt streaming, permission requests and authentication negotiation.

Do not use ACP as the general tool protocol.

That is MCP's job.

---

# 34. A2A — External Agent Interoperability

A2A 1.0 defines an open standard for agents to discover one another's capabilities, exchange messages/files/structured data and collaborate on stateful tasks without exposing their internal implementation.

Use:

```text
MCP = agent ↔ tools

ACP = ZagrosAI ↔ provider-native agent harness

A2A = ZagrosAI agent ↔ external agent
```

That distinction should appear prominently in developer documentation.

---

# 35. Internal Multi-Agent Architecture

Don't automatically spawn ten agents.

Start with one agent.

Create sub-agents only when:

```text
parallel work provides value
specialized context is useful
different permissions are required
different model is appropriate
```

Internal delegation:

```text
Coordinator
   │
   ├── Research task
   ├── Coding task
   └── Verification task
```

Every subtask has its own:

```text
context
tools
permissions
model
budget
deadline
```

---

# 36. Verifier Layer

One major competitive differentiator should be **outcome verification**.

The executor does not simply say:

```text
"Done."
```

The harness asks:

```text
What evidence proves it is done?
```

Examples:

```text
code task
→ tests passed

browser form
→ confirmation page captured

file operation
→ resulting file hash exists

research
→ claims supported by source references

deployment
→ health check succeeded
```

Task result:

```json
{
  "status": "verified",
  "checks": [
    {
      "name": "tests",
      "status": "passed"
    }
  ]
}
```

---

# 37. Memory System

Separate five concepts.

```text
Conversation memory
Working memory
Episodic memory
Semantic memory
Procedural memory
```

## Conversation

Current chat.

## Working

Current task state.

## Episodic

What happened:

```text
"Deployment failed because NODE_ENV was missing."
```

## Semantic

Stable user/project facts.

## Procedural

Skills and learned workflows.

---

# 38. Memory Rules

Never let the model blindly write permanent memory.

Memory candidate:

```json
{
  "content": "...",
  "scope": "project",
  "confidence": 0.94,
  "source": "...",
  "expiresAt": null
}
```

Then memory policy decides:

```text
store
merge
ignore
expire
ask user
```

Changing facts should remain linked to authoritative sources.

Grok Bot itself warns that memory is not a substitute for authoritative current data; ZagrosAI should adopt an even stronger provenance model.

---

# 39. Files and Artifacts

Distinguish:

```text
attachment
workspace file
artifact
```

Attachment:

```text
user input
```

Workspace:

```text
agent's mutable working file
```

Artifact:

```text
finished output
```

Every artifact gets:

```text
ID
name
MIME type
size
hash
creator
task
timestamp
provenance
```

---

# 40. Image, Video, Audio and File Input

The composer should support:

```text
text
camera
photo
video
audio
PDF
document
spreadsheet
archive
code
arbitrary files
```

Desktop:

```text
drag & drop
paste image
file picker
camera where available
```

Phone:

```text
camera
photo library
video library
record audio
Files app
share sheet
```

Uploads should be resumable.

For large files:

```text
Client
  ↓
signed multipart upload
  ↓
object storage
```

Do not proxy multi-gigabyte videos through the chat Worker.

---

# 41. Media Intelligence Adapter

Different models support different modalities.

Normalize media first.

Video:

```text
video
 ↓
metadata
 ↓
audio track
 ↓
transcript
 ↓
keyframes
 ↓
scene index
```

Then the selected model receives whichever representation it supports.

If a model natively accepts video, use native video input.

Otherwise:

```text
frames + transcript
```

This makes video support model-independent.

---

# 42. Universal UI Instead of Separate Apps First

Do **not** build:

```text
iOS Swift app
Android Kotlin app
Windows app
macOS app
web app
```

at the beginning.

Build one excellent responsive web application.

```text
React
+
TypeScript
+
PWA
```

It should install to:

```text
iPhone home screen
Android home screen
Windows
macOS
Linux
```

Native wrappers can come later if required.

---

# 43. Mobile Navigation

Main bottom navigation:

```text
Chats
Agents
Tasks
Files
More
```

Open a Bot:

```text
┌───────────────────────────┐
│ Researcher          • Live│
├───────────────────────────┤
│                           │
│ chat                      │
│                           │
│ [Task progress card]      │
│                           │
│ [Approval card]           │
│                           │
├───────────────────────────┤
│ +   Ask ZagrosAI...   🎤  │
└───────────────────────────┘
```

`+`:

```text
Photo
Camera
Video
File
Audio
Computer
```

---

# 44. Desktop UX

Desktop can expand the same application:

```text
┌──────────┬────────────────────────┬───────────────┐
│ Agents   │ Conversation           │ Activity      │
│          │                        │               │
│ Piper    │ message                │ plan          │
│ Builder  │                        │ tools         │
│ Scout    │ artifact               │ computer      │
│          │                        │ files         │
└──────────┴────────────────────────┴───────────────┘
```

Never require a separate desktop application for normal cloud usage.

---

# 45. Agent Computer UI

Users need confidence about what the agent is doing.

Provide:

```text
Live
History
Files
Terminal
Browser
Processes
```

Live view:

```text
Agent Computer

[ live browser/computer image ]

Currently:
Clicking "Settings"

Task:
Update deployment settings

[Take Control]
[Pause]
[Stop]
```

Phone must support touch takeover.

---

# 46. Approval UX

Approval card:

```text
ZagrosAI wants to:

Send an email to:
alice@example.com

Subject:
Deployment complete

Reason:
Your requested workflow reached its final step.

[Reject]        [Approve once]
```

Never:

```text
Approve tool call #93284?
```

Humans need semantic explanations.

---

# 47. Approval Policy

Risk classes:

```text
R0
read-only

R1
reversible local modifications

R2
external modifications

R3
high-impact / irreversible / security sensitive
```

Defaults:

```text
R0 auto
R1 configurable
R2 approval
R3 approval + stronger confirmation
```

Grok Bot similarly puts consequential operations such as messaging, purchasing, deletions, permission changes and production changes behind approval boundaries; ZagrosAI should make that enforcement independent of the selected model.

---

# 48. Policy Engine

The model proposes.

The policy engine decides.

```text
Model:
call send_email(...)

        ↓

Policy Engine

        ├── allow
        ├── reject
        └── require approval
```

Policy source:

```text
system defaults
user policy
agent policy
tool policy
task policy
runtime policy
```

Most restrictive applicable policy wins.

---

# 49. Prompt-Injection Defense

The harness should label data boundaries.

```text
TRUSTED INSTRUCTIONS
USER REQUEST
UNTRUSTED WEB CONTENT
TOOL RESULTS
MEMORY
```

Important security rules:

```text
web pages cannot modify policy

tool output cannot request secrets

documents cannot grant themselves permissions

secrets never enter model context unless explicitly required

external instructions cannot override user approval policy
```

---

# 50. Secrets Architecture

Never store plaintext credentials in D1.

User's BYOC deployment receives:

```text
ZAGROSAI_MASTER_KEY
```

as a runtime secret.

OAuth/API credentials stored as:

```text
encrypted ciphertext
+
metadata
```

Database does not contain decryptable credentials by itself.

Local Runner secrets should use:

```text
macOS Keychain
Windows Credential Manager
Linux secret service
```

when available.

---

# 51. OAuth Connector Architecture

Build one centralized OAuth broker interface:

```ts
interface OAuthProvider {
  beginAuthorization(): Promise<AuthURL>;

  exchangeCode(code: string): Promise<TokenSet>;

  refresh(refreshToken: string): Promise<TokenSet>;

  revoke(): Promise<void>;
}
```

Use it for:

```text
Google
GitHub
Microsoft
Slack
Notion
Dropbox
etc.
```

MCP's OAuth flow should remain separate but compatible.

---

# 52. Agent Event Log

Every important event becomes immutable:

```text
task.created
plan.created
step.started
tool.requested
approval.requested
approval.granted
tool.completed
artifact.created
memory.proposed
step.verified
task.completed
```

Do not store hidden model chain-of-thought.

Store:

```text
concise plan
action reason
tool request
tool result
verification evidence
```

---

# 53. Recovery Model

Every side-effecting step needs an idempotency key.

Example:

```text
send_email:
task-41-step-8
```

If execution dies after the email is actually sent but before ZagrosAI records completion, the recovery logic must avoid sending it twice.

This is mandatory for dependable autonomous agents.

---

# 54. Routine System

A routine contains:

```yaml
name: check-new-issues

trigger:
  type: schedule
  cron: "0 * * * *"

agent: maintainer

skill: github-triage

missing_worker:
  behavior: continue_where_possible

model_offline:
  behavior: fallback
```

Triggers:

```text
schedule
webhook
MCP event
A2A message
manual
system event
```

---

# 55. Missed Schedule Policy

Per routine:

```text
skip
run_latest
backfill
```

Example:

```yaml
missed_runs: run_latest
```

If the execution environment was unavailable for three hours, ZagrosAI runs once when execution returns.

---

# 56. Notifications

Push events for:

```text
task complete
task failed
approval required
worker offline
routine paused
file ready
agent question
```

Phone should become the main control surface for long-running work.

The user should not need to watch a terminal.

---

# 57. Phone-Only User Journey

A new user should be able to do this without a computer:

```text
1. Open zagrosai.example

2. Install PWA

3. Sign in / create local identity

4. Connect Cloudflare deployment

5. Select model

6. Connect Google/GitHub/etc.

7. Create Agent

8. Send task

9. Close phone

10. Receive notification

11. Review result

12. Approve next action
```

A local Runner is optional.

---

# 58. Cloud-Only Agent

Phone user:

```text
No laptop
No desktop
No server
```

Can still use:

```text
cloud models
Workers AI
HTTP MCP
REST APIs
OAuth connectors
scheduled tasks
Workflows
D1/R2 files
limited cloud browser
A2A
```

What they cannot get for free from the edge runtime:

```text
unlimited Linux shell
arbitrary desktop apps
large Docker workloads
hours of full browser automation
```

The UI should communicate capability availability rather than failing mysteriously.

---

# 59. Capability UI

Agent profile:

```text
Researcher

Models
✓ Workers AI
✓ Gemini
○ Local Ollama unavailable

Tools
✓ GitHub
✓ Google Drive
✓ Browser

Computers
○ MacBook offline
✓ Home Server

Status
Ready
```

This makes hybrid operation understandable.

---

# 60. Repository Architecture

Recommended monorepo:

```text
zagrosai/
│
├── apps/
│   ├── web/
│   ├── cloudflare/
│   └── docs/
│
├── crates/
│   └── runner/
│
├── packages/
│   ├── kernel/
│   ├── protocol/
│   ├── harness/
│   ├── task-graph/
│   ├── models/
│   ├── tools/
│   ├── mcp/
│   ├── acp/
│   ├── a2a/
│   ├── skills/
│   ├── memory/
│   ├── policy/
│   ├── approvals/
│   ├── files/
│   ├── auth/
│   ├── oauth/
│   ├── execution/
│   ├── notifications/
│   ├── ui/
│   └── testing/
│
├── skills/
├── examples/
├── docs/
├── benchmarks/
├── rfcs/
└── README.md
```

---

# 61. Core Domain Objects

Define these before writing serious UI code:

```text
User
Agent
Conversation
Message
Attachment
Task
TaskStep
Run
Worker
Tool
Skill
ModelProfile
Credential
Approval
Routine
Memory
Artifact
AuditEvent
```

These are the project's real architecture.

---

# 62. Protocol Boundaries

```text
Web/PWA
   ↕ ZagrosAI Client Protocol

Control Plane
   ↕ Runner Protocol
ZagrosAI Runner

ZagrosAI
   ↕ MCP
Tools

ZagrosAI
   ↕ ACP
Provider Harness

ZagrosAI
   ↕ A2A
External Agent
```

Never blur these layers.

---

# 63. Technology Recommendation

## Frontend

```text
React
TypeScript
Vite
PWA
```

## Edge/control plane

```text
TypeScript
Cloudflare Workers
Cloudflare Agents SDK primitives
Durable Objects
Workflows
```

## Storage

```text
D1
R2
Durable Object SQLite
```

## Runner

```text
Rust
```

## Browser

```text
Playwright
CDP
BrowserProvider abstraction
```

## Schemas

```text
JSON Schema
Zod where useful
```

## API

```text
HTTP
WebSocket
SSE
```

---

# 64. Competitive Position Against OpenHands

OpenHands' current Agent Canvas already provides an open browser-first control surface, local/Docker/VM/cloud backends and ACP access to Claude Code, Codex and Gemini CLI.

Therefore ZagrosAI must not merely reproduce:

```text
chat
+
terminal
+
agent
```

Its differentiators should be:

```text
phone-first
edge-first
durable serverless tasks
execution fabric
general-purpose rather than coding-first
stronger multimodal interaction
first-class routines
first-class MCP ecosystem
skills registry
provider-neutral subscriptions through harness bridges
first-class A2A
explicit verification
portable memory
per-action policy engine
multi-worker routing
offline failover
```

---

# 65. Competitive Position Against Browser Agents

Browser-specific systems can outperform general agents at websites.

Don't try to replace them all.

Use:

```text
BrowserProvider
```

and let ZagrosAI orchestrate the best backend.

ZagrosAI wins by coordinating:

```text
browser
+
MCP
+
shell
+
files
+
models
+
memory
+
routines
+
mobile
```

rather than trying to be only a browser agent.

---

# 66. Benchmarks Instead of Claims

Create:

```text
ZagrosAI Bench
```

Categories:

```text
API/MCP
browser
coding
files
durability
recovery
scheduled tasks
multi-worker
approval compliance
prompt injection
multimodal
mobile-only
cross-model portability
```

Metrics:

```text
task success %
verified task success %
human interventions
incorrect side effects
recovery success %
runtime
model calls
tool calls
token use
cost
```

Never put:

> #1 AI Agent

in the README without reproducible data.

---

# 67. Development Roadmap

---

# v0.1.0 — The Kernel

**Goal:** A real working agent, not a mockup.

Deliver:

```text
responsive PWA
chat
streaming responses
agent creation
model abstraction
OpenAI-compatible driver
Ollama driver
Cloudflare Workers AI driver
text/image/file attachments
basic tasks
basic tool interface
basic local Runner
shell
filesystem
WebSocket events
SQLite/local development persistence
```

MCP:

```text
stdio MCP on Runner
remote HTTP MCP basic
```

UX:

```text
Chats
Agents
Tasks
Settings
```

Exit criteria:

```text
create agent
attach image
ask task
agent calls tool
agent executes local command
task survives browser refresh
```

Do not build multi-agent.

Do not build a marketplace.

---

# v0.2.0 — Always-On Cloud

**Goal:** Laptop-off ZagrosAI exists.

Deliver:

```text
Cloudflare deployment adapter
Durable Object agent sessions
Workflows
D1
R2
PWA installability
push-capable notification architecture
phone-responsive setup
task checkpointing
cloud/local executor routing
worker presence
offline handling
```

Demonstration:

```text
start task
turn laptop off
wait
workflow continues
open phone
see completed result
```

Cloudflare Workflows' durable serverless model is what makes this release practical without requiring every user to operate a VPS.

---

# v0.3.0 — MCP + OAuth + Security

**Goal:** Real connected work.

Deliver:

```text
MCP OAuth 2.1
MCP discovery
tool registry
tool capability metadata
Google OAuth
GitHub OAuth
generic OAuth framework
encrypted credentials
approval engine
risk classes
audit event log
scope handling
revoke connector
```

MCP authorization should follow the standard resource-server discovery and OAuth flow rather than defining an ZagrosAI-specific variation.

Exit criteria:

```text
connect remote MCP from phone
complete OAuth
agent uses tool
write action requires approval
user approves on phone
audit trail records everything
```

---

# v0.4.0 — The Computer

**Goal:** Grok-Bot-style computer interaction.

Deliver:

```text
Playwright Runner browser
Cloudflare Browser provider
browser session management
screenshots
browser timeline
terminal viewer
workspace browser
file transfer
live execution page
take-control mode
pause
stop
persistent browser profiles
```

Execution fabric:

```text
EDGE
BROWSER
RUNNER
```

first becomes visible to users here.

---

# v0.5.0 — Memory + Skills

**Goal:** Agents improve without becoming unpredictable.

Deliver:

```text
episodic memory
semantic memory
procedural memory
memory provenance
memory expiry
memory viewer
forget/edit controls
SKILL.md
skill.yaml
skill loader
skill search
skill tests
Git-backed skill install
permissions manifest
```

Add:

```text
/skill-name
```

and intelligent automatic skill activation.

---

# v0.6.0 — Any Model, Any Harness

**Goal:** Model independence becomes real.

Deliver direct drivers:

```text
OpenAI
Anthropic
Gemini
xAI
OpenRouter
Cloudflare
Ollama
vLLM
LM Studio
generic OpenAI-compatible
```

Deliver ACP:

```text
Codex
Claude Code
Gemini CLI
generic ACP
```

Capabilities:

```text
model capability negotiation
model fallback
task-specific model routing
subscription harness detection
harness login state
cloud-vs-runner availability
```

This release must preserve provider authentication boundaries: official Codex supports ChatGPT-plan sign-in, Gemini CLI supports Google OAuth, and Claude Code supports subscription-backed operation, but those logins should stay under their native harnesses.

---

# v0.7.0 — Autonomous Routines

**Goal:** ZagrosAI works when nobody is watching.

Deliver:

```text
scheduled routines
event routines
webhooks
routine test mode
retry policy
backoff
dead-letter state
missed-run policy
task expiry
timeouts
notifications
offline fallback
worker requirements
model requirements
```

UX:

```text
Routine
Next run
Last runs
Failures
Pause
Run now
Edit
```

---

# v0.8.0 — Multi-Agent + A2A

**Goal:** Coordinate specialists.

Deliver:

```text
agent delegation
subtasks
parallel steps
agent groups
agent-to-agent messages
shared artifacts
scoped memory
per-agent permissions
A2A client
A2A server
Agent Cards
external A2A discovery
```

A2A should remain the external interoperability layer while internal lightweight subagents can use ZagrosAI's native task primitives.

---

# v0.9.0 — Hardening

**Goal:** Stop treating it as a demo.

Deliver:

```text
prompt-injection defenses
secret-taint tracking
domain policy
filesystem policy
sandbox policy
per-tool permissions
hash-chained audit option
signed skills
dependency scanning
security documentation
disaster recovery
export/import
database migrations
rate limiting
task quotas
load testing
browser reliability tests
provider conformance tests
accessibility
internationalization foundation
```

Benchmark:

```text
ZagrosAI Bench
```

must run in CI.

---

# v1.0.0 — Open Agent Operating System

v1.0 means:

```text
stable public protocol
stable skill format
stable provider interface
stable Runner protocol
stable task schema
stable storage migrations
stable Cloudflare deployment
stable local deployment
stable PWA
stable MCP
stable ACP
stable A2A
```

Required experience:

```text
phone only
    ↓
create Agent
    ↓
connect model
    ↓
connect tools
    ↓
upload image/video/file
    ↓
start long task
    ↓
close phone
    ↓
task continues
    ↓
approval notification
    ↓
approve
    ↓
task finishes
    ↓
inspect evidence/artifacts
```

And:

```text
laptop disconnects
     ↓
agent stays alive
     ↓
cloud steps continue
     ↓
local steps wait or reroute
     ↓
laptop reconnects
     ↓
remaining work resumes
```

That should be the v1.0 definition.

---

# 68. v1.0 Grok Bot Parity Checklist

Before calling ZagrosAI 1.0:

```text
[ ] persistent agent
[ ] background tasks
[ ] routines
[ ] event triggers
[ ] browser
[ ] computer
[ ] terminal
[ ] files
[ ] approvals
[ ] remote takeover
[ ] mobile
[ ] images
[ ] videos
[ ] documents
[ ] multiple agents
[ ] memory
[ ] skills
[ ] connectors
[ ] OAuth
[ ] MCP
[ ] local computer
```

Then ZagrosAI-specific advantages:

```text
[ ] any model
[ ] local models
[ ] ACP provider harnesses
[ ] A2A
[ ] Android
[ ] PWA
[ ] multiple execution workers
[ ] execution failover
[ ] model failover
[ ] BYOC
[ ] fully local mode
[ ] portable memory
[ ] open skills
[ ] signed skills
[ ] reproducible benchmarks
[ ] outcome verification
[ ] per-agent execution boundaries
```

---

# 69. README Positioning

The README should **not** begin with infrastructure.

Do not start:

> ZagrosAI is built with Cloudflare Workers, D1...

Start with the outcome.

Suggested hero:

---

# ZagrosAI

**The open-source runtime for AI agents that keep working.**

Use your model. Use your tools. Use your computers.

ZagrosAI gives AI agents persistent tasks, memory, files, browser automation, MCP tools, skills, approvals and hybrid local/cloud execution.

Your laptop can disappear without killing the agent. Cloud-capable work continues; machine-specific work resumes or moves to another available Runner.

```text
Any AI
  +
MCP tools
  +
Skills
  +
Your computers
  +
Optional serverless cloud
  =
ZagrosAI
```

---

# 70. README Feature Section

Suggested:

## Why ZagrosAI?

**Model independent**

Use OpenAI, Claude, Gemini, Grok, open-weight models, local Ollama/vLLM models or any compatible provider.

**Persistent**

Agents have durable tasks, state, files and memory.

**Hybrid**

Use serverless cloud execution for always-on work and ZagrosAI Runners for browsers, terminals, local files, GPUs and desktop applications.

**MCP native**

Connect standard MCP servers instead of waiting for ZagrosAI-specific integrations.

**Bring provider-native agents**

ZagrosAI can delegate to compatible provider-native agent harnesses through ACP while leaving their authentication and execution under the provider's own tooling.

**Phone first**

Create agents, upload files/images/video, monitor work, approve actions and review results from a mobile browser or installed PWA.

**Open**

The runtime, protocols, Runner and skill system are open and self-hostable.

---

# 71. How README Should Describe Cloudflare

Use wording close to this:

## Optional always-on execution with Cloudflare

ZagrosAI does not require a central ZagrosAI cloud.

The recommended serverless deployment places the ZagrosAI control plane inside **your own Cloudflare account**.

Cloudflare can provide:

```text
Workers        API and events
Durable state  live agent sessions
Workflows      background and scheduled work
D1             structured state
R2             files and artifacts
Browser Run    cloud browser tasks
Workers AI     optional model inference
```

For light personal workloads, many of these capabilities currently have Free-plan allowances. Cloudflare controls those limits and may change them, so ZagrosAI does not promise unlimited or permanently free cloud compute.

**Cloudflare is a runtime adapter, not a requirement.**

You can run ZagrosAI locally or implement another runtime adapter.

---

# 72. README Must Explain the Hybrid Limitation

Suggested:

## What happens when my computer is off?

ZagrosAI separates the **agent** from the **computer**.

If your laptop goes offline:

```text
✓ conversations remain
✓ memory remains
✓ schedules remain
✓ API/MCP work can continue
✓ cloud models can continue
✓ cloud browser tasks may continue
✓ notifications continue

⏸ local files wait
⏸ local Ollama models wait
⏸ local terminal commands wait
⏸ desktop applications wait
```

When the Runner reconnects, waiting steps can resume automatically.

If another compatible Runner exists, ZagrosAI can route eligible work there instead.

---

# 73. README Provider Authentication Section

Suggested:

## Use models your way

ZagrosAI supports multiple authentication modes:

```text
API key
Official API OAuth
Provider-native agent harness
Local inference
```

For subscription-backed provider agents, ZagrosAI does not scrape session cookies or call undocumented private APIs.

Where supported, ZagrosAI delegates through the provider's official harness or an interoperable protocol such as ACP.

Examples include Codex with ChatGPT sign-in, Gemini CLI with Google sign-in, and compatible Claude Code integrations.

---

# 74. README Protocol Section

Suggested:

## Built on open protocols

```text
MCP
Agent ↔ tools

ACP
ZagrosAI ↔ provider-native coding agents

A2A
Agent ↔ external agent
```

MCP standardizes tool/resource integration, ACP standardizes client-to-coding-agent interaction, and A2A standardizes collaboration among independent agents.

ZagrosAI should extend these protocols rather than replace them.

---

# 75. README Architecture Diagram

Use:

```text
                       ZagrosAI
                          │
               ┌──────────┴──────────┐
               │                     │
             Phone                Desktop
               │                     │
               └──────────┬──────────┘
                          │
                    RegaHarness
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
      Models             MCP              Skills
        │                 │                 │
        ▼                 ▼                 ▼
 OpenAI/Claude       GitHub/Drive      Community
 Gemini/Grok/etc.    Slack/etc.        workflows
        │
        ▼
                 Execution Fabric
                       │
       ┌───────────────┼─────────────────┐
       ▼               ▼                 ▼
 Cloudflare        Local Runner       Remote Runner
 durable work      laptop/GPU         NAS/server
```

---

# 76. README "Not Another Chatbot"

Suggested:

## ZagrosAI is not another chat UI

A chatbot returns an answer.

ZagrosAI owns a task.

```text
Chatbot:
request → answer

ZagrosAI:
request
  → plan
  → execute
  → wait
  → recover
  → ask permission
  → continue
  → verify
  → deliver artifacts
```

---

# 77. README Security Promise

Suggested:

## The model does not control your permissions

ZagrosAI models can propose actions.

The ZagrosAI policy engine decides whether those actions are allowed.

Sensitive operations can require explicit approval regardless of which AI model is running.

Credentials remain outside prompts whenever possible, and external web/tool content is treated as untrusted input.

---

# 78. README Honesty Section

Include:

## What ZagrosAI cannot magically provide

There is no unlimited free cloud computer.

Serverless execution can keep tasks, APIs, schedules and lightweight browser workloads alive with no dedicated VPS, but arbitrary Linux/desktop computation requires an available execution machine.

That machine can be:

```text
your laptop
your desktop
your NAS
a home server
a remote machine
a compatible sandbox
```

ZagrosAI's job is to make those resources behave like one execution fabric.

This honesty will build more trust than claiming impossible infrastructure.

---

# 79. Governance

For the open-source community, establish from the beginning:

```text
public roadmap
RFC directory
issue templates
security policy
contribution guide
code of conduct
architecture decision records
release notes
compatibility policy
```

Major architectural changes should go through:

```text
rfcs/00xx-name.md
```

Core protocols must not change because one commercial provider introduces a new feature.

---

# 80. Project Constitution

Put something like this in `docs/principles.md`:

> ZagrosAI exists to give users portable AI agents rather than lock them into one model, one cloud, one computer or one provider.

> Models are replaceable.

> Tool integrations use open protocols wherever practical.

> A user's memory and artifacts must be exportable.

> Cloud infrastructure must be replaceable.

> ZagrosAI will not depend on reverse-engineered authentication as a core feature.

> Security boundaries are enforced outside the model.

> Autonomous actions must remain inspectable.

> Long-running work must be recoverable.

> An unavailable device must not destroy an agent.

---

# 81. Build Order From Zero

Do **not** start with all of this simultaneously.

The engineering order should be:

```text
Domain schemas
      ↓
Task/event model
      ↓
RegaHarness
      ↓
Model driver
      ↓
Tool interface
      ↓
PWA chat
      ↓
Runner
      ↓
MCP
      ↓
Cloudflare durability
      ↓
Files
      ↓
Approvals
      ↓
OAuth
      ↓
Browser
      ↓
Skills
      ↓
Memory
      ↓
ACP
      ↓
Routines
      ↓
A2A
      ↓
Multi-agent
      ↓
Hardening
```

This prevents ZagrosAI from turning into 40 disconnected integrations without a reliable kernel.

---

# 82. The v1.0 Product Statement

If this roadmap is executed correctly, ZagrosAI 1.0 should be describable in one paragraph:

> **ZagrosAI is an open-source runtime for persistent AI agents. Agents can use cloud or local models, provider-native agent harnesses, MCP tools, reusable skills, browsers, terminals and files across a fabric of local and remote computers. Tasks are durable, resumable and policy-controlled, with human approvals for consequential actions. ZagrosAI can run from a phone or desktop through the same PWA, supports multimodal files including images and video, and can use an optional serverless Cloudflare deployment so cloud-capable work continues while personal computers are offline.**

That is the product.

Not:

```text
an open Grok clone
```

but:

```text
an open operating system
for portable persistent AI agents.
```