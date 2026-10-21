"""Confirmed config reads keep the claimed operation and published asset scope."""

from collections.abc import Generator
from dataclasses import replace
from typing import Literal
from unittest.mock import patch

import pytest
from dify_agent.adapters.native_testing.client import AgentPhysicalDispatchPayload
from typing_extensions import TypedDict

from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from services.dify_builder.native_testing.agent_config_access import validate_config_read
from services.dify_builder.native_testing.agent_lineage import NativeAgentEndpointContext
from services.dify_builder.native_testing.agent_operations import AgentOperationService
from tests.unit_tests.installed_spies import installed_mock
from tests.unit_tests.services.dify_builder import native_owner_fixtures
from tests.unit_tests.services.dify_builder.test_agent_asset_operations import endpoint_context, protected_config
from tests.unit_tests.services.dify_builder.test_agent_operation_owner import envelope as dispatch_envelope

operations_service = native_owner_fixtures.operations_service


class ConfigReadQuery(TypedDict, closed=True):
    tenant_id: str
    user_id: str
    agent_id: str
    config_version_id: str
    config_version_kind: str


type ConfigReadCase = tuple[
    NativeAgentEndpointContext, AgentPhysicalDispatchPayload, AgentOperationService, ConfigReadQuery
]


@pytest.fixture
def config_read(operations_service: AgentOperationService) -> Generator[ConfigReadCase]:
    context = endpoint_context(
        protected_config(
            {
                "composition": {
                    "layers": [
                        {"name": "execution_context", "config": {"tenant_id": "t", "user_id": "u"}},
                        {
                            "name": "config",
                            "config": {
                                "agent_id": "a",
                                "config_version": {"id": "snapshot", "kind": "snapshot"},
                                "skills": [{"name": "check"}],
                                "files": [{"name": "input.txt"}],
                                "mentioned_skill_names": ["check"],
                                "mentioned_file_names": ["input.txt"],
                            },
                        },
                    ]
                }
            }
        )
    )
    wire = dispatch_envelope()
    envelope = wire.model_copy(
        update={
            "ref": context.ref,
            "intent": wire.intent.model_copy(update={"kind": "shell", "target": {"kind": "file"}}),
        }
    )
    service = operations_service
    query: ConfigReadQuery = {
        "tenant_id": "t",
        "user_id": "u",
        "agent_id": "a",
        "config_version_id": "snapshot",
        "config_version_kind": "snapshot",
    }
    with patch.object(service, "validate_claimed_shell", return_value=context):
        yield context, envelope, service, query


def test_selected_asset_requires_current_claimed_operation(config_read: ConfigReadCase) -> None:
    context, envelope, service, query = config_read
    validate_config_read(
        context=context, envelope=envelope, operations=service, source={"kind": "file", "name": "input.txt"}, **query
    )
    installed_mock(service.validate_claimed_shell).assert_called_once_with(envelope=envelope)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("tenant_id", "other"),
        ("user_id", "other"),
        ("agent_id", "other"),
        ("config_version_id", "other"),
        ("config_version_kind", "draft"),
    ],
)
def test_owner_or_snapshot_substitution_stops_before_config_service(
    field: Literal["tenant_id", "user_id", "agent_id", "config_version_id", "config_version_kind"],
    value: str,
    config_read: ConfigReadCase,
) -> None:
    context, envelope, service, query = config_read
    query[field] = value
    with pytest.raises(BuilderExecutionPolicyError):
        validate_config_read(context=context, envelope=envelope, operations=service, **query)


def test_other_declared_kind_or_unknown_asset_is_not_a_file_pull(config_read: ConfigReadCase) -> None:
    context, envelope, service, query = config_read
    for source in ({"kind": "file", "name": "secret.txt"}, {"kind": "skill", "name": "check"}):
        with pytest.raises(BuilderExecutionPolicyError):
            validate_config_read(context=context, envelope=envelope, operations=service, source=source, **query)


def test_revoked_or_completed_claim_never_falls_back_to_ordinary_access(config_read: ConfigReadCase) -> None:
    context, envelope, service, query = config_read
    spy = installed_mock(service.validate_claimed_shell)
    spy.side_effect = BuilderExecutionPolicyError("native_effect_owner_mismatch")
    with pytest.raises(BuilderExecutionPolicyError):
        validate_config_read(context=context, envelope=envelope, operations=service, **query)


def test_changed_protected_context_rejected_after_claim_validation(config_read: ConfigReadCase) -> None:
    context, envelope, service, query = config_read
    spy = installed_mock(service.validate_claimed_shell)
    spy.return_value = replace(
        context, config=context.config.model_copy(update={"config_ref": "changed-protected-config"})
    )
    with pytest.raises(BuilderExecutionPolicyError):
        validate_config_read(context=context, envelope=envelope, operations=service, **query)
