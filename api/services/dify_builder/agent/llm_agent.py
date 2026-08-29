"""The real Dify Builder agent shell.

Owns the resolved model. Of the Protocol's 14 methods (Fix 4 + Build 7 + Edit 3),
the 3 Fix methods that reason about a failed run -- ``diagnose``,
``diagnose_checklist``, ``propose_repair`` -- now use real LLM cognition via
``services.dify_builder.agent.fix``, resolving the model through
``_model_or_none`` (which degrades to ``None`` on resolution failure rather than
crashing the advance; ``fix.*`` handles that). ``generate_mock_inputs`` and every
Build/Edit method still delegate to the canned ``PlaceholderAgent`` unchanged.
Later slices replace those remaining method bodies one at a time with real LLM
calls, no structural change.
"""

from typing import Any

from core.dify_builder.placeholder_agent import PlaceholderAgent
from core.model_manager import ModelInstance
from services.dify_builder.agent import fix
from services.dify_builder.agent.model_resolver import resolve_model_instance


class LlmBuilderAgent:
    def __init__(self, tenant_id: str, model_config: dict[str, Any] | None = None) -> None:
        self._tenant_id = tenant_id
        self._model_config = model_config or {}
        self._canned = PlaceholderAgent()
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
        return self._canned.generate_mock_inputs(schema, prior_failed)

    # -- Build cognition (delegated) --
    def analyze_goal(self, goal_text):
        return self._canned.analyze_goal(goal_text)

    def propose_plan_v1(self, requirements):
        return self._canned.propose_plan_v1(requirements)

    def discover_resources(self, plan_items):
        return self._canned.discover_resources(plan_items)

    def bind_resources(self, plan_items, resource_ids, conflict_policy):
        return self._canned.bind_resources(plan_items, resource_ids, conflict_policy)

    def build_nodes(self, plan_items):
        return self._canned.build_nodes(plan_items)

    def propose_build_repair(self, built_node_ids):
        return self._canned.propose_build_repair(built_node_ids)

    def learn_from_build(self, goal_text, requirements, plan_items, built_node_ids):
        return self._canned.learn_from_build(goal_text, requirements, plan_items, built_node_ids)

    # -- Edit cognition (delegated) --
    def analyze_impact(self, goal_text, graph):
        return self._canned.analyze_impact(goal_text, graph)

    def propose_edit_plan(self, edit_rules, graph):
        return self._canned.propose_edit_plan(edit_rules, graph)

    def build_edit_intents(self, edit_rules, graph):
        return self._canned.build_edit_intents(edit_rules, graph)
