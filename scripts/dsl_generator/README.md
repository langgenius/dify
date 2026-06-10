# Dify DSL Generator v1

This is a standalone generator that emits importable Dify app DSL YAML from a simplified spec.

It is based on shapes observed in the Dify repo fixtures and current workflow editor behavior.

## Scope

v1 supports:

- root sequential graphs
- sequential container bodies
- `start`
- `trigger-schedule`
- `trigger-webhook`
- `llm`
- `code`
- `template-transform`
- `answer`
- `end`
- `assigner`
- `http-request`
- `question-classifier`
- `document-extractor`
- `knowledge-retrieval`
- `if-else`
- `list-operator`
- `variable-assigner`
- `iteration`
- `loop`
- `tool`
- `trigger-plugin`
- template-driven plugin/tool nodes
- auto-matched plugin templates for `tool` / `trigger-plugin`
- auto-collected top-level `dependencies`
- auto-inferred model provider dependencies for known `llm` providers
- explicit `workflow.edges` for non-linear graphs
- per-node `position` overrides for branched layouts

v1 does not support:

- arbitrary branching
- arbitrary custom edges
- nested containers inside containers
- full coverage of all Dify node types
- automatic discovery of every plugin schema in a workspace

## Usage

```bash
python3 dify/scripts/dsl_generator/generate_dify_dsl.py \
  dify/scripts/dsl_generator/examples/iteration_workflow_spec.yml \
  -o /tmp/generated_iteration.yml
```

```bash
python3 dify/scripts/dsl_generator/generate_dify_dsl.py \
  dify/scripts/dsl_generator/examples/plugin_tool_spec.yml \
  -o /tmp/generated_plugin_tool.yml
```

```bash
python3 dify/scripts/dsl_generator/generate_dify_dsl.py \
  dify/scripts/dsl_generator/examples/typeform_to_gmail_spec.yml \
  -o /tmp/generated_typeform_to_gmail.yml
```

```bash
python3 dify/scripts/dsl_generator/generate_dify_dsl.py \
  dify/scripts/dsl_generator/examples/typeform_to_gmail_auto_spec.yml \
  -o /tmp/generated_typeform_to_gmail_auto.yml
```

```bash
python3 dify/scripts/dsl_generator/generate_dify_dsl.py \
  dify/scripts/dsl_generator/examples/drive_to_qdrant_auto_spec.yml \
  -o /tmp/generated_drive_to_qdrant_auto.yml
```

```bash
python3 dify/scripts/dsl_generator/generate_dify_dsl.py \
  dify/scripts/dsl_generator/examples/scheduled_iteration_spec.yml \
  -o /tmp/generated_scheduled_iteration.yml
```

```bash
python3 dify/scripts/dsl_generator/generate_dify_dsl.py \
  dify/scripts/dsl_generator/examples/webhook_http_spec.yml \
  -o /tmp/generated_webhook_http.yml
```

```bash
python3 dify/scripts/dsl_generator/generate_dify_dsl.py \
  dify/scripts/dsl_generator/examples/question_classifier_branch_spec.yml \
  -o /tmp/generated_question_classifier_branch.yml
```

```bash
python3 dify/scripts/dsl_generator/generate_dify_dsl.py \
  dify/scripts/dsl_generator/examples/document_extractor_spec.yml \
  -o /tmp/generated_document_extractor.yml
```

```bash
python3 dify/scripts/dsl_generator/generate_dify_dsl.py \
  dify/scripts/dsl_generator/examples/knowledge_retrieval_spec.yml \
  -o /tmp/generated_knowledge_retrieval.yml
```

```bash
python3 dify/scripts/dsl_generator/generate_dify_dsl.py \
  dify/scripts/dsl_generator/examples/if_else_native_spec.yml \
  -o /tmp/generated_if_else_native.yml
```

```bash
python3 dify/scripts/dsl_generator/generate_dify_dsl.py \
  dify/scripts/dsl_generator/examples/list_and_assigner_spec.yml \
  -o /tmp/generated_list_and_assigner.yml
```

## Local Smoke Tests

Before importing into Dify manually, you can run the local smoke suite:

```bash
python3 dify/scripts/dsl_generator/run_generator_smoke_tests.py
```

You can also test a subset of specs:

```bash
python3 dify/scripts/dsl_generator/run_generator_smoke_tests.py \
  dify/scripts/dsl_generator/examples/drive_to_qdrant_auto_spec.yml \
  dify/scripts/dsl_generator/examples/question_classifier_branch_spec.yml
```

The smoke suite checks:

- every example can be compiled
- node ids are unique
- edges only reference existing nodes
- container nodes have valid generated start nodes
- top-level dependencies are deduplicated
- every compiled workflow still has a root start/trigger node
- compiled YAML passes `scripts/dsl_agent/validator.py` error-level checks

This does not replace real import/runtime validation in Dify. It is meant to catch the fast, local failures first.

For stricter node-data schema validation against the local Dify/graphon
pydantic models, run with a Python 3.12 runtime:

```bash
/Users/scarlettmao/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  dify/scripts/dsl_generator/validate_graphon_schema.py \
  --spec dify/scripts/dsl_generator/examples/*.yml
```

This catches failures that shallow graph smoke tests miss, such as invalid start
variable types or unsupported condition operators.

```bash
python3 dify/scripts/dsl_generator/generate_dify_dsl.py \
  dify/scripts/dsl_generator/examples/llm_openai_spec.yml \
  -o /tmp/generated_llm_openai.yml
```

```bash
python3 dify/scripts/dsl_generator/generate_dify_dsl.py \
  dify/scripts/dsl_generator/examples/typeform_gmail_branch_spec.yml \
  -o /tmp/generated_typeform_branch.yml
```

```bash
python3 dify/scripts/dsl_generator/generate_dify_dsl.py \
  dify/scripts/dsl_generator/examples/review_branch_workflow_spec.yml \
  -o /tmp/generated_review_branch.yml
```

```bash
python3 dify/scripts/dsl_generator/generate_dify_dsl.py \
  dify/scripts/dsl_generator/examples/agent_review_workflow_spec.yml \
  -o /tmp/generated_agent_review.yml
```

## Simplified Spec Shape

```yaml
app:
  name: my_app
  mode: workflow
workflow:
  sequence:
    - id: start
      type: start
    - id: code_1
      type: code
      code: |
        def main() -> dict:
            return {"result": [1, 2, 3]}
      outputs:
        result:
          type: array[number]
          children: null
    - id: iter_1
      type: iteration
      iterator_selector: [code_1, result]
      output_selector: [fmt_1, output]
      output_type: array[string]
      sequence:
        - id: fmt_1
          type: template-transform
          template: "output: {{ arg1 }}"
          variables:
            - variable: arg1
              value_selector: [iter_1, item]
              value_type: string
    - id: end
      type: end
      outputs:
        - variable: output
          value_selector: [iter_1, output]
          value_type: array[string]
```

## Notes

- `advanced-chat` mode should use `answer`, not `end`.
- `workflow` mode should use `end`, not `answer`.
- Container nodes auto-generate `iteration-start` / `loop-start`.
- Container child positions are relative to the parent container.
- Start variable type aliases `json` and `object` are normalized to Dify's
  current `json_object`.
- Condition operator aliases `==`, `!=`, `>=`, and `<=` are normalized to Dify's
  accepted operators `=`, `≠`, `≥`, and `≤`.
- Edge data includes explicit `isInIteration` and `isInLoop` booleans; container
  edges also include the matching `iteration_id` or `loop_id`.
- Tool/plugin nodes can be built in two ways:
- Tool/plugin/trigger nodes can be built in two ways:
  - direct fields in the spec (`provider_id`, `tool_name`, `tool_parameters`, ...)
  - `template`, which loads a reusable node skeleton from `templates/`
- For `tool` and `trigger-plugin`, if you omit `template` but provide a stable identity such as `provider_id + tool_name` or `provider_id + event_name`, the generator will try to auto-match a template from `templates/`, preferring `templates/extracted/` when duplicates exist.
- Template files can carry `dependency` / `dependencies`, and the generator will lift them to the DSL top-level `dependencies`.
- Template-based nodes are not limited to `tool`. They can also be `trigger-plugin` or any node type whose stable shape comes from a real exported workflow.
- `llm` nodes can auto-pick top-level dependencies from `templates/models/registry.yml` based on `model.provider`.
- If a provider is not in the registry yet, you can still set `model_dependency` or `model_dependencies` directly in the spec.
- For linear graphs, `workflow.sequence` still works and edges are auto-generated.
- For branching graphs, use `workflow.nodes` plus `workflow.edges`.
- Each edge can specify `source`, `target`, and optional `source_handle`, `target_handle`, `id`, `type`, `zIndex`, and extra `data`.
- Each node can override auto-layout with `position: {x: ..., y: ...}`.

## Template Strategy

You do not need hundreds of templates to get started.

The practical path is:

- start with a small set of high-value templates for the plugins your team really uses
- keep one template per stable plugin-tool shape
- treat exported Dify DSL as the source of truth for each template

In practice, 5-10 representative templates are usually enough to prove the pattern:

- one builtin tool
- one marketplace search tool
- one HTTP/API style tool
- one auth-heavy SaaS tool
- one container workflow that uses a tool inside `iteration` or `loop`

## Recommended Test Layers

To avoid manual-upload-only testing, use three layers:

1. Local smoke tests
   Run `run_generator_smoke_tests.py` on every change.
2. Import smoke tests
   Keep a small curated set of representative DSLs and import only those into Dify.
3. Runtime smoke tests
   For plugin-heavy flows, run only a few verified workflows end-to-end because import success does not guarantee credentials, authorization, or plugin runtime health.
