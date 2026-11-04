"""Legacy queue payloads retain the historical pipeline runner role."""

import pytest
from pydantic import ValidationError

from core.app.entities.app_invoke_entities import InvokeFrom, RagPipelineGenerateEntity, UserFrom
from core.app.entities.rag_pipeline_invoke_entities import RagPipelineInvokeEntity
from tests.unit_tests.core.app.apps.pipeline.test_pipeline_runner import _build_app_generate_entity


def _load_queued_entity(payload: dict[str, object]) -> RagPipelineGenerateEntity:
    envelope = RagPipelineInvokeEntity.model_validate(
        {
            "pipeline_id": "pipeline",
            "application_generate_entity": payload,
            "user_id": payload["user_id"],
            "tenant_id": "tenant",
            "workflow_id": "workflow",
            "streaming": False,
        }
    )
    # Both normal and priority queue consumers validate the nested entity here.
    return RagPipelineGenerateEntity.model_validate(envelope.application_generate_entity)


@pytest.mark.parametrize("invoke_from", list(InvokeFrom))
def test_legacy_queue_payload_uses_previous_runner_role(invoke_from: InvokeFrom) -> None:
    payload = _build_app_generate_entity().model_dump(mode="json")
    payload.pop("user_from")
    payload["invoke_from"] = invoke_from.value

    restored = _load_queued_entity(payload)

    expected = UserFrom.ACCOUNT if invoke_from in (InvokeFrom.DEBUGGER, InvokeFrom.EXPLORE) else UserFrom.END_USER
    assert restored.user_from == expected
    assert "user_from" not in payload


@pytest.mark.parametrize("user_from", [UserFrom.ACCOUNT, UserFrom.END_USER])
def test_queue_preserves_explicit_identity(user_from: UserFrom) -> None:
    payload = _build_app_generate_entity().model_dump(mode="json")
    payload.update(invoke_from=InvokeFrom.SERVICE_API.value, user_from=user_from.value)

    assert _load_queued_entity(payload).user_from == user_from


@pytest.mark.parametrize("field", ["single_iteration_run", "single_loop_run"])
def test_legacy_debugging_queue_payload_preserves_debugger_role(field: str) -> None:
    payload = _build_app_generate_entity().model_dump(mode="json")
    payload.pop("user_from")
    payload[field] = {"node_id": "node", "inputs": {}}

    assert _load_queued_entity(payload).user_from == UserFrom.ACCOUNT


@pytest.mark.parametrize("user_from", [None, "invalid"])
def test_queue_does_not_repair_invalid_explicit_identity(user_from: str | None) -> None:
    payload = _build_app_generate_entity().model_dump(mode="json")
    payload["user_from"] = user_from

    with pytest.raises(ValidationError, match="user_from"):
        _load_queued_entity(payload)


class TestRagPipelineInvokeEntity:
    def test_defaults_and_fields(self) -> None:
        entity = RagPipelineInvokeEntity(
            pipeline_id="pipe-1",
            application_generate_entity={"foo": "bar"},
            user_id="user-1",
            tenant_id="tenant-1",
            workflow_id="workflow-1",
            streaming=True,
        )

        assert entity.workflow_execution_id is None
        assert entity.workflow_thread_pool_id is None
        assert entity.streaming is True
