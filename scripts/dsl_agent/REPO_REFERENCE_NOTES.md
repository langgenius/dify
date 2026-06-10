# Public Repo Reference Notes

These notes capture what this agent should borrow from the public Dify DSL
generation projects we reviewed. The goal is to reuse patterns and rules, not to
copy product/runtime assumptions.

## 1. LingyiChen-AI/workflow-skill

Best ideas:

- natural-language workflow authoring UX
- node router table
- template matching before custom generation
- separate Dify/Coze/ComfyUI workflow skills

Use in this agent:

- keep a compact node router in prompts/rulebooks
- choose template starting points when the request is simple
- maintain beginner-friendly clarification behavior

Watchouts:

- examples are not automatically import-truth
- validator behavior differs from stricter repos

## 2. A1sh-4/dify-dsl-generator

Best ideas:

- multi-agent role split
- concept/requirements gate
- plugin finder before API researcher
- knowledge architect for RAG
- node planner approval gate
- dedicated DSL generator and DSL validator roles
- setup and import instructions as first-class output

Use in this agent:

- encode role boundaries in `agent.py` stages
- keep plugin resolver separate from YAML authoring
- generate setup/debug notes with each run
- add later support for knowledge/RAG design as a specialized sub-agent

Watchouts:

- Claude Code-specific implementation should not leak into product
- some version guidance conflicts with current local Dify source

## 3. lazeyliu/dify-dsl-generator-skills

Best ideas:

- authoring/review/refactor/governance separation
- forward testing
- issue taxonomy
- route matrix
- subagent review for high-risk workflows

Use in this agent:

- add validation reports with stable issue codes
- add repair mode distinct from generation mode
- add later "review only" and "refactor existing DSL" commands
- keep a forward-testing suite for official demo prompts

Watchouts:

- Codex skill packaging is not the product surface

## 4. GHP1223/dify-dsl-gen

Best ideas:

- compact import-failure rulebook
- linter structure
- sourceHandle/case_id checks
- selector root checks
- loop/iteration container checks
- explicit version/string rule

Use in this agent:

- keep expanding `validator.py` with concrete issue codes
- add branch, selector, container, dependency, and secret-leak checks
- treat linter output as repair-agent input

Watchouts:

- some docs contain conflicting version formatting examples

## 5. 01554/DslGenAgent

Best ideas:

- do not generate the whole workflow in one prompt
- plan edges first
- generate nodes individually from node references
- assemble nodes and edges into final DSL
- use output-check prompts after assembly

Use in this agent:

- keep graph planning as a separate phase
- later split node authoring per node family
- make repair loop patch targeted node/edge sections

Watchouts:

- original implementation is workflow-only
- high API-call count
- author-reported instability
- plugin/tool type assumptions are too narrow

## 6. kevinten-ai/ai-dify-dsl

Best ideas:

- parse -> analyze -> generate loop
- preserve unknown fields
- topology analysis
- variable-flow analysis
- structural diff
- split/rebuild workflow artifacts

Use in this agent:

- add a parser/analyzer layer after YAML generation
- add variable-flow checks to `validator.py`
- add structural diff for repair attempts
- consider split files for prompt/code editing later

Watchouts:

- validator is not full Dify import validation
- tests include local absolute path assumptions

## Combined Agent Pattern

The final product direction should combine:

```text
Codex-like repo reading
+ A1sh-style role split
+ DslGenAgent staged generation
+ GHP-style hard rules
+ lazeyliu-style review/governance
+ ai-dify-dsl-style parser/analyzer
+ local Dify source as source of truth
```

This is the product identity:

```text
Source-grounded Dify DSL Agent
```

It should feel like a first-party Dify capability, not a wrapper around Codex,
Claude Code, or a public repo.
