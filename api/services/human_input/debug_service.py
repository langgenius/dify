"""Preview, submit and deliver draft human-input forms through explicit ports."""

from collections.abc import Mapping, Sequence
from typing import Any, Protocol

from core.workflow.environment_variables import load_environment_variables
from core.workflow.human_input_adapter import adapt_human_input_node_data_for_graph, parse_human_input_delivery_methods
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from core.workflow.system_variables import build_bootstrap_variables, default_system_variables
from core.workflow.variable_pool_initializer import add_variables_to_pool
from enums.human_input import HumanInputFormKind
from graphon.nodes import BuiltinNodeTypes
from graphon.runtime import VariablePool
from graphon.variable_loader import VariableLoader, load_into_variable_pool
from graphon.variables import VariableBase
from machinery.context import RequestContext
from models.human_input_contracts import FormCreateParams, HumanInputFormEntity
from models.human_input_delivery import DeliveryChannelConfig
from models.human_input_entities import HumanInputNodeData
from services.human_input.contracts import (
    DeliveryTestContext,
    DeliveryTestEmailRecipient,
    DeliveryTestError,
    DeliveryTestResult,
    DeliveryTestUnsupportedError,
)
from services.workflow.contracts import WorkflowDebugNode
from services.workflow.execution.adapters.human_input import (
    DifyHITLCallback,
    render_form_content_before_submission,
    resolve_default_values,
)
from services.workflow.execution.adapters.node_runtime import apply_dify_debug_email_recipient


class DebugDefinitions(Protocol):
    def debug_node(self, context: RequestContext, app_id: str, node_id: str) -> WorkflowDebugNode: ...


class DebugVariables(Protocol):
    def loader(
        self,
        context: RequestContext,
        app_id: str,
        conversation_variables: Sequence[VariableBase],
    ) -> VariableLoader: ...
    def save(
        self,
        context: RequestContext,
        app_id: str,
        node_id: str,
        enclosing_node_id: str | None,
        outputs: Mapping[str, Any],
    ) -> None: ...


class DebugFileInputs(Protocol):
    def map_inputs(
        self,
        *,
        tenant_id: str,
        variable_mapping: Mapping[str, Sequence[str]],
        user_inputs: dict[str, Any],
        variable_pool: VariablePool,
    ) -> None: ...


class FormSubmission(Protocol):
    def validate_and_normalize_submission(
        self,
        *,
        tenant_id: str,
        form_definition: HumanInputNodeData,
        selected_action_id: str,
        form_data: Mapping[str, Any],
    ) -> Mapping[str, Any]: ...


class DebugForms(Protocol):
    def create_form(self, params: FormCreateParams) -> HumanInputFormEntity: ...
    def email_recipients(self, form_id: str) -> list[tuple[str, str]]: ...


class DebugFormFactory(Protocol):
    def __call__(self, *, tenant_id: str, app_id: str) -> DebugForms: ...


class DebugDelivery(Protocol):
    def send_test(self, *, context: DeliveryTestContext, method: DeliveryChannelConfig) -> DeliveryTestResult: ...


class HumanInputDebugService:
    def __init__(
        self,
        *,
        definitions: DebugDefinitions,
        variables: DebugVariables,
        files: DebugFileInputs,
        submissions: FormSubmission,
        forms: DebugFormFactory,
        delivery: DebugDelivery,
    ) -> None:
        self._definitions = definitions
        self._variables = variables
        self._files = files
        self._submissions = submissions
        self._forms = forms
        self._delivery = delivery

    def _prepare(
        self, context: RequestContext, app_id: str, node_id: str, inputs: Mapping[str, Any]
    ) -> tuple[WorkflowDebugNode, HumanInputNodeData, VariablePool]:
        draft = self._definitions.debug_node(context, app_id, node_id)
        if draft.config["data"].get("type") != BuiltinNodeTypes.HUMAN_INPUT:
            raise ValueError("Node type must be human-input.")
        data = HumanInputNodeData.model_validate(adapt_human_input_node_data_for_graph(draft.config["data"]))
        mapping = data.extract_variable_selector_to_variable_mapping(node_id)
        manual_inputs = dict(inputs)
        # The existing loader handles nesting and manual overrides consistently
        # with node execution. Repository reads finish before rendering or delivery.
        loader = self._variables.loader(context, app_id, draft.conversation_variables)
        environment_variables = load_environment_variables(
            tenant_id=context.active_workspace_id, serialized_variables=draft.environment_variables
        )
        pool = VariablePool()
        add_variables_to_pool(
            pool,
            build_bootstrap_variables(
                system_variables=default_system_variables(), environment_variables=environment_variables
            ),
        )
        load_into_variable_pool(
            variable_loader=loader,
            variable_pool=pool,
            variable_mapping=mapping,
            user_inputs=manual_inputs,
        )
        self._files.map_inputs(
            tenant_id=context.active_workspace_id,
            variable_mapping=mapping,
            user_inputs=manual_inputs,
            variable_pool=pool,
        )
        return draft, data, pool

    def preview_form(
        self, context: RequestContext, app_id: str, node_id: str, inputs: dict[str, Any]
    ) -> Mapping[str, Any]:
        _, data, pool = self._prepare(context, app_id, node_id, inputs)
        return HumanInputRequired(
            form_id=node_id,
            form_content=render_form_content_before_submission(data, variable_pool=pool),
            inputs=data.inputs,
            actions=data.user_actions,
            node_id=node_id,
            node_title=data.title,
            resolved_default_values=resolve_default_values(data, variable_pool=pool),
        ).model_dump(mode="json")

    def submit_form(
        self,
        context: RequestContext,
        app_id: str,
        node_id: str,
        *,
        inputs: dict[str, Any],
        form_inputs: dict[str, Any],
        action: str,
    ) -> Mapping[str, Any]:
        draft, data, pool = self._prepare(context, app_id, node_id, inputs)
        normalized = self._submissions.validate_and_normalize_submission(
            tenant_id=context.active_workspace_id,
            form_definition=data,
            selected_action_id=action,
            form_data=form_inputs,
        )
        selected = next((item for item in data.user_actions if item.id == action), None)
        outputs: dict[str, Any] = dict(normalized)
        outputs["__action_id"] = action
        outputs["__action_value"] = selected.title if selected else ""
        outputs["__rendered_content"] = DifyHITLCallback.render_form_content_with_outputs(
            form_content=render_form_content_before_submission(data, variable_pool=pool),
            outputs=outputs,
            field_names=data.outputs_field_names(),
            form_inputs=data.inputs,
        )
        self._variables.save(context, app_id, node_id, draft.enclosing_node_id, outputs)
        return outputs

    def test_delivery(
        self, context: RequestContext, app_id: str, node_id: str, *, inputs: dict[str, Any], delivery_method_id: str
    ) -> None:
        _, data, pool = self._prepare(context, app_id, node_id, inputs)
        method = next(
            (item for item in parse_human_input_delivery_methods(data) if str(item.id) == delivery_method_id), None
        )
        if method is None:
            raise ValueError("Delivery method not found.")
        method = apply_dify_debug_email_recipient(method, enabled=True, actor_id=context.account_id)
        rendered = render_form_content_before_submission(data, variable_pool=pool)
        forms = self._forms(tenant_id=context.active_workspace_id, app_id=app_id)
        form = forms.create_form(
            FormCreateParams(
                workflow_execution_id=None,
                node_id=node_id,
                form_config=data,
                rendered_content=rendered,
                delivery_methods=[method],
                display_in_ui=False,
                resolved_default_values=resolve_default_values(data, variable_pool=pool),
                form_kind=HumanInputFormKind.DELIVERY_TEST,
            )
        )
        recipients = [
            DeliveryTestEmailRecipient(email=email, form_token=token)
            for email, token in forms.email_recipients(form.id)
        ]
        delivery_context = DeliveryTestContext(
            tenant_id=context.active_workspace_id,
            app_id=app_id,
            node_id=node_id,
            node_title=data.title,
            rendered_content=rendered,
            template_vars={"form_id": form.id},
            recipients=recipients,
            variable_pool=pool,
        )
        try:
            self._delivery.send_test(context=delivery_context, method=method)
        except DeliveryTestUnsupportedError as exc:
            raise ValueError("Delivery method does not support test send.") from exc
        except DeliveryTestError as exc:
            raise ValueError(str(exc)) from exc
