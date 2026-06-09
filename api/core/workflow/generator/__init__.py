"""
Workflow generator package.

Generates a Dify workflow graph (nodes, edges, viewport) from a natural-language
instruction. Intended for the cmd+k `/create` slash command's preview/apply flow.

Pipeline (slim, single-shot variant):

    runner.WorkflowGenerator.generate_workflow_graph(...)
        ├── planner_prompts: short LLM call → high-level node plan
        └── builder_prompts: structured-output LLM call → full graph JSON
            └── postprocess: fill defaults, auto-layout viewport, sanity-check edges

The runner is pure domain logic; ``WorkflowGeneratorService`` (in ``services/``)
owns the model-manager dependency and is what controllers call.
"""

from .runner import WorkflowGenerator

__all__ = ["WorkflowGenerator"]
