"""The real Dify Builder agent shell.

Owns the resolved model. All of the Protocol's methods use real cognition: the
3 Fix methods that reason about a failed run --
``diagnose``, ``diagnose_checklist``, ``propose_repair`` -- via
``services.dify_builder.agent.fix``; the 7 Build methods -- ``analyze_goal``,
``propose_plan_v1``, ``discover_resources``, ``assess_capability_gap``,
``bind_resources``, ``build_nodes``, ``learn_from_build`` -- via
``services.dify_builder.agent.build`` (``bind_resources``
is deterministic, not LLM-driven); and all 3 Edit methods -- ``analyze_impact``,
``propose_edit_plan``, ``build_edit_intents`` -- via ``services.dify_builder.agent.edit``;
``generate_mock_inputs`` via ``services.dify_builder.agent.mock_inputs``, and
multi-turn chat via ``services.dify_builder.agent.chat``. Chat uses native model
streaming; the other cognition methods resolve the model through
``model_or_none`` and degrade when no model is available.
"""

import logging
from collections.abc import Callable
from typing import Any, TypedDict

from core.model_manager import ModelInstance
from services.dify_builder import trace_diagnostics as diagnostics
from services.dify_builder.agent import build, chat, edit, fix, mock_inputs, resources
from services.dify_builder.agent.model_resolver import resolve_model_instance
from services.dify_builder.plan import WorkflowPlan

logger = logging.getLogger(__name__)


class _ToolParameterPromptKwargs(TypedDict, total=False):
    tool_context: str


class LlmBuilderAgent:
    def __init__(
        self,
        tenant_id: str,
        model_config: dict[str, Any] | None = None,
        *,
        account_id: str | None = None,
        app_mode: str = "workflow",
    ) -> None:
        """``account_id`` is the acting member, whose credential visibility
        decides which installed tools are ready; ``None`` means no member is
        known and only team-shared credentials count."""
        self._tenant_id = tenant_id
        self._account_id = account_id
        if app_mode not in {"workflow", "advanced-chat"}:
            raise ValueError(f"Unsupported Builder app mode: {app_mode}")
        self._app_mode = app_mode
        self._model_config = model_config or {}
        self._model_instance: ModelInstance | None = None
        self._resolution_failed = False
        self._diagnostic_callback: diagnostics.DiagnosticCallback | None = None
        self._reasoning_callback: Callable[[str, str], None] | None = None

    def set_diagnostic_callback(self, callback: diagnostics.DiagnosticCallback | None) -> None:
        self._diagnostic_callback = callback

    def set_reasoning_callback(self, callback: Callable[[str, str], None] | None) -> None:
        self._reasoning_callback = callback

    def _reasoning_for(self, span_id: str) -> Callable[[str], None] | None:
        callback = self._reasoning_callback
        if callback is None:
            return None
        return lambda delta: callback(span_id, delta)

    def _model(self) -> ModelInstance:
        """Lazily resolve + memoize the chosen model. Used by cognition (next slice)."""
        if self._model_instance is None:
            self._model_instance = resolve_model_instance(self._tenant_id, self._model_config)
        return self._model_instance

    def model_or_none(self) -> ModelInstance | None:
        """The resolved model, or None if it can't resolve — cognition degrades on
        None rather than crashing the advance. Logs the resolution failure once per
        agent instance (per advance) so a misconfigured llm-mode tenant is visible."""
        try:
            return self._model()
        except Exception as exc:
            diagnostics.report("model_resolution_failed", error=exc, fallback_used=True)
            if not self._resolution_failed:
                self._resolution_failed = True
                logger.warning(
                    "Dify Builder: model resolution failed for tenant %s; degrading to heuristic cognition",
                    self._tenant_id,
                    exc_info=True,
                )
            return None

    # -- Fix cognition (delegated) --
    @diagnostics.cognition
    def diagnose(self, failed_run, graph, node_outputs, *, reply_language: str | None = None):
        return fix.diagnose(
            self.model_or_none(),
            failed_run,
            graph,
            node_outputs,
            self._reasoning_for("diagnose"),
            reply_language=reply_language,
        )

    @diagnostics.cognition
    def diagnose_with_evidence(self, failed_run, graph, node_outputs, evidence, *, reply_language: str | None = None):
        return fix.diagnose(
            self.model_or_none(),
            failed_run,
            graph,
            node_outputs,
            self._reasoning_for("diagnose"),
            evidence=evidence,
            reply_language=reply_language,
        )

    @diagnostics.cognition
    def propose_with_evidence(self, diagnosis, graph, prompt_graph, redact_text, *, reply_language: str | None = None):
        return fix.propose_repair(
            self.model_or_none(),
            diagnosis,
            graph,
            self._reasoning_for("propose-repair"),
            reply_language=reply_language,
            prompt_graph=prompt_graph,
            redact_text=redact_text,
            **self._tool_parameter_prompt_kwargs(prompt_graph),
        )

    @diagnostics.cognition
    def diagnose_checklist(self, errors, graph, *, reply_language: str | None = None):
        return fix.diagnose_checklist(
            self.model_or_none(),
            errors,
            graph,
            self._reasoning_for("diagnose-checklist"),
            reply_language=reply_language,
        )

    def _tool_parameter_prompt_kwargs(self, graph: dict[str, Any]) -> _ToolParameterPromptKwargs:
        context = resources.tool_parameter_context(self._tenant_id, graph)
        return {"tool_context": context} if context else {}

    @diagnostics.cognition
    def propose_repair(self, diagnosis, graph, *, reply_language: str | None = None):
        return fix.propose_repair(
            self.model_or_none(),
            diagnosis,
            graph,
            self._reasoning_for("propose-repair"),
            reply_language=reply_language,
            **self._tool_parameter_prompt_kwargs(graph),
        )

    @diagnostics.cognition
    def generate_mock_inputs(self, schema, prior_failed):
        return mock_inputs.generate(
            self.model_or_none(),
            schema,
            prior_failed,
            self._reasoning_for("generate-mock-inputs"),
        )

    # -- Build cognition (real) --
    @diagnostics.cognition
    def analyze_goal(self, goal_text, *, reply_language: str | None = None):
        return build.analyze_goal(
            self.model_or_none(), goal_text, self._reasoning_for("analyze-goal"), reply_language=reply_language
        )

    @diagnostics.cognition
    def propose_app_name(self, goal_text, requirements):
        return build.propose_app_name(
            self.model_or_none(),
            goal_text,
            requirements,
            self._reasoning_for("propose-app-name"),
        )

    @diagnostics.cognition
    def propose_plan_v1(
        self, requirements: dict[str, Any], *, goal_text: str, reply_language: str | None = None
    ) -> WorkflowPlan | None:
        catalogue = build.planning_catalogue(
            self._tenant_id, account_id=self._account_id, goal_text=goal_text, requirements=requirements
        )
        return build.propose_plan_v1(
            self.model_or_none(),
            requirements,
            self._reasoning_for("propose-build-plan"),
            tools=catalogue.tools,
            agents=catalogue.agents,
            agent_source_error=catalogue.agent_source_error,
            goal_text=goal_text,
            mode=self._app_mode,
            reply_language=reply_language,
        )

    @diagnostics.cognition
    def discover_resources(self, plan_items, *, goal_text: str, requirements: dict[str, Any]):
        return build.discover_resources(
            self.model_or_none(),
            self._tenant_id,
            plan_items,
            self._reasoning_for("discover-resources"),
            goal_text=goal_text,
            requirements=requirements,
            account_id=self._account_id,
        )

    @diagnostics.cognition
    def assess_capability_gap(self, plan_items, options, *, goal_text: str, requirements: dict[str, Any]):
        return build.assess_capability_gap(
            self.model_or_none(),
            plan_items,
            options,
            goal_text=goal_text,
            requirements=requirements,
            mode=self._app_mode,
        )

    @diagnostics.cognition
    def bind_resources(self, plan_items, resource_ids):
        return build.bind_resources(
            self.model_or_none(), self._tenant_id, plan_items, resource_ids, account_id=self._account_id
        )

    @diagnostics.cognition
    def build_nodes(self, plan_items, resource_ids=None, *, trusted_text="", reply_language: str | None = None):
        return build.build_nodes(
            self._tenant_id,
            self._model_config,
            plan_items,
            resource_ids or (),
            trusted_text=trusted_text,
            account_id=self._account_id,
            mode=self._app_mode,
            reply_language=reply_language,
        )

    @diagnostics.cognition
    def learn_from_build(self, goal_text, requirements, plan_items, built_node_ids):
        return build.learn_from_build(
            self.model_or_none(),
            goal_text,
            requirements,
            plan_items,
            built_node_ids,
            self._reasoning_for("learn-from-build"),
        )

    # -- Edit cognition (real) --
    @diagnostics.cognition
    def analyze_impact(self, goal_text, graph, *, reply_language: str | None = None):
        impact = edit.analyze_impact(
            self.model_or_none(),
            goal_text,
            graph,
            self._reasoning_for("analyze-impact"),
            reply_language=reply_language,
        )
        if isinstance(impact, dict) and impact.get("resource_requests"):
            from services.dify_builder.resource_grounding import ground_edit_impact

            catalogue = resources.list_tenant_resources(self._tenant_id, account_id=self._account_id)
            return ground_edit_impact(impact, catalogue)
        return impact

    @diagnostics.cognition
    def resolve_edit_bindings(self, form_fields, rules, _graph):
        from services.dify_builder.resource_grounding import resolve_edit_choices

        if not any(str(field.get("key", "")).startswith("__builder_resource__") for field in form_fields):
            return {"resource_ids": [], "bindings": {}, "fingerprints": {}}
        catalogue = resources.list_tenant_resources(self._tenant_id, account_id=self._account_id)
        return resolve_edit_choices(form_fields, rules, catalogue)

    @diagnostics.cognition
    def refresh_edit_bindings(self, form_fields, rules, _graph, *, node_id, kind):
        from services.dify_builder.resource_grounding import ground_edit_impact

        requests = [
            {"kind": f["resource_kind"], "node_id": f.get("resource_node_id", ""), "query": f.get("resource_query", "")}
            for f in form_fields
            if str(f.get("key", "")).startswith("__builder_resource__") and f.get("resource_kind") in {"model", "tool"}
        ]
        if not requests:
            requests = [{"kind": kind, "node_id": node_id, "query": ""}]
        catalogue = resources.list_tenant_resources(self._tenant_id, account_id=self._account_id)
        return ground_edit_impact({"fields": form_fields, "values": rules, "resource_requests": requests}, catalogue)

    @diagnostics.cognition
    def propose_edit_plan(self, edit_rules, graph, *, reply_language: str | None = None) -> WorkflowPlan | None:
        return edit.propose_edit_plan(
            self.model_or_none(),
            edit_rules,
            graph,
            self._reasoning_for("propose-edit-plan"),
            reply_language=reply_language,
        )

    @diagnostics.cognition
    def build_edit_intents(
        self, edit_rules, graph, *, edit_target_node_ids=(), last_edit_rejection=None, approved_plan=None
    ):
        return edit.build_edit_intents(
            self.model_or_none(),
            edit_rules,
            graph,
            self._reasoning_for("build-edit-intents"),
            edit_target_node_ids=edit_target_node_ids,
            last_edit_rejection=last_edit_rejection,
            approved_plan=approved_plan,
            **self._tool_parameter_prompt_kwargs(graph),
        )

    @diagnostics.cognition
    def continuation_intent(self, context, graph, text):
        return chat.continuation_intent(self.model_or_none(), self._model_config, context, graph, text)

    @diagnostics.cognition
    def respond_to_message(self, state, context, history, graph, text, on_delta=None):
        return chat.respond(
            self.model_or_none(),
            self._model_config,
            state,
            context,
            history,
            graph,
            text,
            on_delta,
            self._reasoning_for("respond-to-message"),
        )
