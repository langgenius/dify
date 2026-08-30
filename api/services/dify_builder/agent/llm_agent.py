"""The real Dify Builder agent shell.

Owns the resolved model. All of the Protocol's 13 methods (Fix 4 + Build 6 + Edit 3)
use real cognition: the 3 Fix methods that reason about a failed run --
``diagnose``, ``diagnose_checklist``, ``propose_repair`` -- via
``services.dify_builder.agent.fix``; the 6 Build methods -- ``analyze_goal``,
``propose_plan_v1``, ``discover_resources``, ``bind_resources``, ``build_nodes``,
``learn_from_build`` -- via ``services.dify_builder.agent.build`` (``bind_resources``
is deterministic, not LLM-driven); and all 3 Edit methods -- ``analyze_impact``,
``propose_edit_plan``, ``build_edit_intents`` -- via ``services.dify_builder.agent.edit``;
and ``generate_mock_inputs`` via ``services.dify_builder.agent.mock_inputs``. Each
resolves the model through ``_model_or_none`` (which degrades to ``None`` on resolution
failure rather than crashing the advance; ``fix.*``/``build.*``/``edit.*``/``mock_inputs.*``
handle that).
"""

from typing import Any

from core.model_manager import ModelInstance
from services.dify_builder.agent import build, edit, fix, mock_inputs
from services.dify_builder.agent.model_resolver import resolve_model_instance


class LlmBuilderAgent:
    def __init__(self, tenant_id: str, model_config: dict[str, Any] | None = None) -> None:
        self._tenant_id = tenant_id
        self._model_config = model_config or {}
        self._model_instance: ModelInstance | None = None

    def _model(self) -> ModelInstance:
        """Lazily resolve + memoize the chosen model. Used by cognition (next slice)."""
        if self._model_instance is None:
            self._model_instance = resolve_model_instance(self._tenant_id, self._model_config)
        return self._model_instance

    def _model_or_none(self) -> ModelInstance | None:
        """The resolved model, or None if it can't resolve — fix.* degrades on None
        rather than crashing the advance."""
        try:
            return self._model()
        except Exception:  # any resolution failure -> degrade path (fix.* handles None)
            return None

    # -- Fix cognition (delegated) --
    def diagnose(self, failed_run, graph, node_outputs):
        return fix.diagnose(self._model_or_none(), failed_run, graph, node_outputs)

    def diagnose_checklist(self, errors, graph):
        return fix.diagnose_checklist(self._model_or_none(), errors, graph)

    def propose_repair(self, diagnosis, graph):
        return fix.propose_repair(self._model_or_none(), diagnosis, graph)

    def generate_mock_inputs(self, schema, prior_failed):
        return mock_inputs.generate(self._model_or_none(), schema, prior_failed)

    # -- Build cognition (real) --
    def analyze_goal(self, goal_text):
        return build.analyze_goal(self._model_or_none(), goal_text)

    def propose_plan_v1(self, requirements):
        return build.propose_plan_v1(self._model_or_none(), requirements)

    def discover_resources(self, plan_items):
        return build.discover_resources(self._model_or_none(), self._tenant_id, plan_items)

    def bind_resources(self, plan_items, resource_ids, conflict_policy):
        return build.bind_resources(self._model_or_none(), self._tenant_id, plan_items, resource_ids, conflict_policy)

    def build_nodes(self, plan_items):
        return build.build_nodes(self._tenant_id, self._model_config, plan_items)

    def learn_from_build(self, goal_text, requirements, plan_items, built_node_ids):
        return build.learn_from_build(self._model_or_none(), goal_text, requirements, plan_items, built_node_ids)

    # -- Edit cognition (real) --
    def analyze_impact(self, goal_text, graph):
        return edit.analyze_impact(self._model_or_none(), goal_text, graph)

    def propose_edit_plan(self, edit_rules, graph):
        return edit.propose_edit_plan(self._model_or_none(), edit_rules, graph)

    def build_edit_intents(self, edit_rules, graph):
        return edit.build_edit_intents(self._model_or_none(), edit_rules, graph)
