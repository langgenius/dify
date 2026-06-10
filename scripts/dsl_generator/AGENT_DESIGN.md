# Dify DSL Agent Design Draft

This draft describes a first-party Dify DSL generation agent that combines ideas
from public GitHub projects with our local Dify DSL work.

The goal is not to ask users to use Codex or Claude Code. The goal is to build a
Dify-owned agent that can generate importable Dify DSL from user intent.

## Product Goal

Users should be able to describe an app or workflow in natural language and get:

- a Dify Workflow or Chatflow plan
- a valid Dify DSL YAML draft
- dependency and setup notes
- validation feedback
- repair attempts when generation fails
- optional Console API automation for import, draft debug, update, publish, API key creation, and export backup

The user should not need to understand YAML, Codex, Claude Code, or Dify internals.

## Customer Automation Context

Samhammer's request is the concrete product pressure behind this work:

```text
DSL generation
-> Console API import
-> draft debug / node debug
-> DSL repair or update
-> publish
-> enable Service API + create app API key
-> Service API regression
-> export backup + observability
```

Important distinction:

- Service API uses an app API key and targets published apps under `/v1/...`.
- Console API uses a logged-in console session or bearer access token and targets tenant/workspace management under `/console/api/...`.

For official demo design, the first reliable milestone is still high-quality DSL
generation and validation. The second milestone is an automated Console API
lifecycle runner. The agent should not hide import/debug/publish failures; it
should capture concrete API errors and feed them back into repair.

## Core Direction

Use a rule-grounded, staged agent instead of a single prompt that writes a full
YAML file in one shot.

Recommended flow:

```text
User request
-> Requirement Analyzer
-> Graph Planner
-> Plugin Resolver
-> Node Authoring Agents
-> DSL Assembler
-> Rule Validator
-> Repair Agent
-> Final YAML + setup notes
-> optional Console Lifecycle Runner
```

This borrows the best idea from `01554/DslGenAgent`: split generation into plan,
node generation, assembly, and validation.

It also borrows the best idea from `A1sh-4/dify-dsl-generator`: use specialized
agents for requirement analysis, plugin discovery, node planning, prompt writing,
error strategy, and validation.

The strongest internal reference is how Codex already creates Dify DSL:

```text
Read the user's request
-> inspect local Dify source for current DSL/import rules
-> inspect relevant node entity/schema files
-> inspect plugin repos and plugin docs when tools/triggers are needed
-> prefer official plugins
-> draft complete YAML grounded in source/exported shapes
-> validate YAML structure and Dify import constraints
-> repair YAML from concrete errors
```

The product should not expose Codex to users, but it should encode this workflow
as a first-party Dify agent.

## What To Reuse From Public Repos

### 1. LingyiChen-AI/workflow-skill

Useful parts:

- simple natural-language workflow generation UX
- node router table
- Dify node reference docs
- template matching idea

Do not copy directly:

- generated YAML examples as ground truth
- loose validation assumptions

Best use:

- reference library for node descriptions and beginner-friendly generation flow

### 2. A1sh-4/dify-dsl-generator

Useful parts:

- multi-agent pipeline structure
- requirement analysis gate
- plugin finder before raw API design
- knowledge architect role for RAG
- node plan approval gate
- dedicated DSL validator
- output folder and setup-doc mindset

Do not copy directly:

- Claude Code-specific runtime assumptions
- rigid "always run every subagent" behavior
- internal version rules without checking current Dify source

Best use:

- source of role definitions and orchestration ideas

### 3. lazeyliu/dify-dsl-generator-skills

Useful parts:

- governance/review/refactor skill split
- forward-testing mindset
- review report structure
- quality gates
- route matrix

Do not copy directly:

- Codex skill packaging as the product surface

Best use:

- validation and review methodology

### 4. GHP1223/dify-dsl-gen

Useful parts:

- compact import-failure rules
- linter ideas
- loop/iteration/edge/container constraints
- selector validation

Do not copy directly:

- conflicting version formatting guidance

Best use:

- rulebook and validator test cases

### 5. 01554/DslGenAgent

Useful parts:

- plan edges first
- generate nodes from references
- assemble final DSL from node and edge pieces
- multiple output checks

Do not copy directly:

- current implementation
- workflow-only scope
- one-API-call-per-node cost profile
- unstable success rate

Best use:

- core architectural pattern

### 6. kevinten-ai/ai-dify-dsl

Useful parts:

- parser/generator/analyzer approach
- round-trip preservation
- topology analysis
- variable-flow analysis
- structural diff

Do not copy directly:

- incomplete Dify import validator
- local-path test assumptions

Best use:

- inspiration for internal parse/analyze/repair tooling

## Local Assets We Already Have

Local path:

```text
dify/scripts/dsl_generator/
```

Useful assets:

- `generate_dify_dsl.py`
- `run_generator_smoke_tests.py`
- `extract_templates_from_workflows.py`
- `templates/`
- `templates/extracted/`
- `examples/`

These should not necessarily be the final generation engine. They are useful as:

- rule references
- plugin template extraction tools
- smoke-test examples
- intermediate spec experiments
- negative/positive validation cases

The current deterministic generator can remain an internal tool, but the agent
should not be limited by it.

## Dify Source Of Truth

Always prefer local Dify source over public repo assumptions.

Important source areas:

- `api/services/app_dsl_service.py`
- `api/services/rag_pipeline/rag_pipeline_dsl_service.py`
- `api/core/workflow/node_factory.py`
- `api/core/workflow/nodes/**/entities.py`
- `api/core/workflow/nodes/agent/entities.py`
- `api/core/workflow/nodes/trigger_*/entities.py`
- `api/core/workflow/nodes/knowledge_retrieval/entities.py`

Confirmed local rule:

- app DSL current version is `"0.6.0"`
- import expects the parsed `version` value to be a string
- app DSL supports `workflow` and `advanced-chat`
- RAG pipeline DSL has its own DSL service and current version
- `start` and trigger nodes are root-entry concepts and should not be mixed casually
- dependencies matter for model/tool/plugin import checks

## Agent Roles

### 1. Requirement Analyzer

Input:

- raw user request
- optional user files or API descriptions

Output:

- app mode: `workflow` or `advanced-chat`
- target user goal
- required inputs
- expected outputs
- integrations
- whether RAG is needed
- whether human review is needed
- whether triggers are needed
- unresolved questions

Rules:

- ask only blocking questions
- do not ask about YAML details
- do not generate DSL

### 2. Graph Planner

Input:

- confirmed requirements
- rulebook

Output:

- node list
- edge list
- branch handles
- container boundaries
- data-flow selectors

Rules:

- no full YAML yet
- every edge must reference a planned node
- branch handles must match `if-else` cases or classifier classes
- mode must determine terminal node: `end` for workflow, `answer` for advanced-chat

### 3. Plugin Resolver

Input:

- planned tool, trigger, agent, model, and integration needs

Output:

- selected plugin/tool templates
- dependency entries
- missing plugin warnings
- environment variable requirements
- plugin repo evidence used to build node schemas

Rules:

- prefer official Dify plugins over third-party plugins
- use third-party plugins only when no official plugin covers the need
- use raw HTTP only when no suitable plugin exists or when the user explicitly asks for HTTP
- never embed secrets
- reuse exported plugin node shapes when available
- read plugin repo docs before authoring plugin nodes
- derive `provider_id`, `plugin_id`, `tool_name`, `event_name`, parameters, and dependency entries from plugin manifests and tool/provider YAML where possible

Candidate sources:

```text
dify-official-plugins/
dify/scripts/dsl_generator/templates/extracted/
public GitHub plugin repositories
Dify marketplace metadata, when available
```

Plugin resolver should produce a compact evidence bundle:

```yaml
plugin_plan:
  selected:
    - purpose: send_email
      source: official
      repo: langgenius/dify-official-plugins
      plugin_id: langgenius/dify-gmail
      provider_id: langgenius/dify-gmail/dify-gmail
      tool_name: send_message
      dependency:
        type: marketplace
        value:
          marketplace_plugin_unique_identifier: ...
      parameters:
        to: mixed
        subject: mixed
        body: mixed
  rejected:
    - repo: third-party/example-gmail
      reason: official Gmail plugin exists
  unresolved: []
```

This makes plugin choice reviewable and prevents the YAML agent from inventing
plugin nodes.

### 4. Node Authoring Agents

One authoring pass per node or per node family.

Output:

- complete node envelope
- complete `data` block
- node dimensions
- node-specific dependencies

Rules:

- generate from node-specific schema/rules
- preserve Dify naming conventions
- include required selectors and output fields
- keep node IDs stable within a generation attempt
- plugin-backed nodes must use the Plugin Resolver evidence bundle
- do not invent plugin parameter schemas

### 5. DSL Assembler

Input:

- app metadata
- dependencies
- node envelopes
- edges
- features
- variables

Output:

- complete YAML document

Rules:

- top-level keys: `version`, `kind`, `app`, `dependencies`, `workflow`
- include graph viewport
- include full workflow feature block where required
- dedupe dependencies

### 6. Rule Validator

Input:

- generated YAML

Output:

- errors
- warnings
- import risk level

Validation classes:

- top-level app DSL shape
- version type and compatibility
- app mode and terminal node
- start/trigger entry constraints
- node ID uniqueness
- edge source/target existence
- selector root existence
- branch handle correctness
- loop/iteration container correctness
- plugin dependency presence
- secret leakage

### 7. Repair Agent

Input:

- YAML
- validator errors
- original plan

Output:

- minimally repaired YAML

Rules:

- patch only what failed
- do not redesign the workflow unless the plan is invalid
- preserve node IDs unless a collision is the problem
- stop after bounded attempts and report remaining blockers

## MVP Architecture

First implementation can be an internal CLI or local service. CLI is not the
final product; it is only the fastest way to test the agent loop without UI
overhead.

MVP command example:

```bash
python3 dify_dsl_agent.py "Create a Typeform-triggered workflow that uses an agent to review the submission and sends a Gmail follow-up."
```

MVP output:

```text
output/
  run-id/
    requirements.yml
    graph_plan.yml
    generated.yml
    validation_report.json
    setup.md
```

## Why Start With CLI Internally

The final user experience should be inside Dify.

The internal first version can be CLI because it lets us verify:

- prompt design
- role boundaries
- YAML quality
- validation coverage
- repair loop behavior
- import success rate

Once the loop works, wrap it in:

- Dify UI
- API endpoint
- hosted demo
- workflow advisor experience

## MVP Scope

Support these first:

- simple chatflow: Start -> LLM -> Answer
- basic workflow: Start -> LLM/Code -> End
- trigger workflow: Trigger -> Agent/LLM -> Tool -> End
- plugin tool workflow: Trigger/Start -> Tool -> End
- if-else branch workflow
- iteration workflow
- human-review workflow

Avoid at first:

- arbitrary nested containers
- full RAG pipeline DSL
- every plugin schema
- every graph edge case
- generating custom plugin packages

## Recommended Official Demo Scenario

Use a scenario that demonstrates the need for an agent without requiring too
many unstable integrations:

```text
Typeform submission
-> Agent reviews partner/application data
-> Parameter extractor extracts recommended action
-> If/else routes action
-> Gmail send or Gmail draft
-> Optional human review before send
-> End
```

This uses:

- trigger-plugin
- agent
- parameter-extractor
- if-else
- tool
- human-input
- end
- dependencies
- branch handles

It is a strong official demo because it proves more than simple YAML generation.

## Open Engineering Questions

- Should the agent generate complete YAML directly, or generate node fragments
  first and assemble deterministically?
- Should validation use Dify Python entity models directly where possible?
- Should import testing call a local Dify API in CI or only in manual smoke tests?
- How many repair attempts should be allowed?
- How should plugin templates be refreshed from new exported workflows?
- Which nodes should be considered first-class for v1?

## Proposed Next Step

Build an internal prototype with this narrow loop:

```text
Requirement Analyzer
-> Graph Planner
-> Node Authoring
-> DSL Assembler
-> Rule Validator
-> Repair Agent
```

Use local Dify source and current `scripts/dsl_generator/templates/` as the
first rule/template library.

The prototype should not depend on Codex Agent or Claude Code as the product
runtime.
