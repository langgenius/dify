"""Use cases execute without Flask or a database session."""

from contextlib import nullcontext
from dataclasses import replace
from datetime import datetime
from typing import cast
from unittest.mock import Mock, create_autospec

import pytest

from enums.agent import WorkflowAgentBindingType
from machinery.context import RequestContext
from repositories.workflow.definition_repository import workflow_snapshot
from services.agent.workflow_contracts import WorkflowAgentBindingStore
from services.agent.workflow_publish_service import WorkflowAgentPublishService
from services.errors.base import NoPermissionError
from services.errors.llm import InvokeRateLimitError
from services.workflow import console_service as module
from services.workflow.console_service import (
    ConsoleWorkflowService,
    WorkflowAccess,
    WorkflowAppLookup,
    WorkflowConversion,
    WorkflowDefinitionLifecycle,
    WorkflowDefinitions,
    WorkflowPresence,
    WorkflowPublicationTransaction,
    WorkflowRuntime,
)
from services.workflow.contracts import (
    DeletedWorkflowBinding,
    DraftWorkflowMissingError,
    ValidatedWorkflowPublication,
    WorkflowOwner,
    WorkflowPublication,
    WorkflowTriggerError,
    WorkflowTriggerEvent,
)
from services.workflow.draft_service import WorkflowDraftService
from tests.unit_tests.model_factories import make_workflow

SNAPSHOT = workflow_snapshot(make_workflow())

CONTEXT = RequestContext("request", None, "account", "tenant")


@pytest.fixture
def dependencies() -> tuple[ConsoleWorkflowService[WorkflowAgentBindingStore], Mock, Mock, Mock, Mock, Mock]:
    definitions = create_autospec(WorkflowDefinitions, instance=True, spec_set=True)
    runtime = create_autospec(WorkflowRuntime, instance=True, spec_set=True)
    apps = create_autospec(WorkflowAppLookup, instance=True, spec_set=True)
    presence = create_autospec(WorkflowPresence, instance=True, spec_set=True)
    access = create_autospec(WorkflowAccess, instance=True, spec_set=True)
    lifecycle = create_autospec(WorkflowDefinitionLifecycle, instance=True, spec_set=True)
    publication = create_autospec(WorkflowPublicationTransaction, instance=True, spec_set=True)
    definitions.publication.return_value = nullcontext(publication)
    lifecycle.validate_publish.return_value = ValidatedWorkflowPublication(SNAPSHOT, ())
    service = ConsoleWorkflowService(
        conversion=create_autospec(WorkflowConversion, instance=True, spec_set=True),
        agent_services=WorkflowAgentPublishService,
        definitions=definitions,
        drafts=create_autospec(WorkflowDraftService, instance=True, spec_set=True),
        lifecycle=lifecycle,
        runtime=runtime,
        apps=apps,
        presence=presence,
        access=access,
    )
    return service, definitions, runtime, apps, presence, access


@pytest.mark.parametrize("graph", ["", "[]", "invalid", '{"nodes": [], "edges": []}'])
def test_publish_advisory_accepts_empty_or_uncheckable_graph(
    dependencies: tuple[ConsoleWorkflowService[WorkflowAgentBindingStore], Mock, Mock, Mock, Mock, Mock], graph: str
) -> None:
    service, definitions, *_ = dependencies
    publication = WorkflowPublication(datetime(2024, 1, 1), graph)
    cast(Mock, service._definitions).publication.return_value.enter_result.create_version.return_value = replace(
        SNAPSHOT, created_at=publication.created_at, graph=publication.graph
    )
    assert service.publish(CONTEXT, "app", marked_name="Release", marked_comment="") == (publication, None)


@pytest.mark.parametrize("failing", ["validate_variable_references", "format_variable_reference_errors"])
def test_publish_checker_failure_does_not_fail_committed_publish(
    dependencies: tuple[ConsoleWorkflowService[WorkflowAgentBindingStore], Mock, Mock, Mock, Mock, Mock],
    monkeypatch: pytest.MonkeyPatch,
    failing: str,
) -> None:
    service, definitions, *_ = dependencies
    publication = WorkflowPublication(datetime(2024, 1, 1), '{"nodes": []}')
    cast(Mock, service._definitions).publication.return_value.enter_result.create_version.return_value = replace(
        SNAPSHOT, created_at=publication.created_at, graph=publication.graph
    )
    monkeypatch.setattr(module, "validate_variable_references", lambda _graph: ["issue"])

    def fail(*_args: object) -> None:
        cast(Mock, service._definitions).publication.return_value.enter_result.create_version.assert_called_once()
        raise RuntimeError("checker unavailable")

    monkeypatch.setattr(module, failing, fail)
    assert service.publish(CONTEXT, "app", marked_name="", marked_comment="") == (publication, None)


def test_publish_warning_is_advisory(
    dependencies: tuple[ConsoleWorkflowService[WorkflowAgentBindingStore], Mock, Mock, Mock, Mock, Mock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, definitions, *_ = dependencies
    cast(Mock, service._definitions).publication.return_value.enter_result.create_version.return_value = replace(
        SNAPSHOT, graph='{"nodes": []}'
    )
    monkeypatch.setattr(module, "validate_variable_references", lambda _graph: ["issue"])
    monkeypatch.setattr(module, "format_variable_reference_errors", lambda _issues: "Warning")
    assert service.publish(CONTEXT, "app", marked_name="", marked_comment="")[1] == "Warning"


def test_missing_draft_and_foreign_author(
    dependencies: tuple[ConsoleWorkflowService[WorkflowAgentBindingStore], Mock, Mock, Mock, Mock, Mock],
) -> None:
    service, definitions, *_ = dependencies
    cast(Mock, service._definitions).draft.return_value = nullcontext(None)
    with pytest.raises(DraftWorkflowMissingError):
        service.draft(CONTEXT, "app")
    with pytest.raises(NoPermissionError):
        service.versions(CONTEXT, "app", page=1, limit=20, user_id="other", named_only=False)
    definitions.versions.assert_not_called()


@pytest.mark.parametrize("failed", [False, True])
def test_delete_retires_only_after_successful_commit(
    dependencies: tuple[ConsoleWorkflowService[WorkflowAgentBindingStore], Mock, Mock, Mock, Mock, Mock], failed: bool
) -> None:
    service, definitions, runtime, *_ = dependencies
    steps = []

    def delete(context: RequestContext, owner: WorkflowOwner, version: str) -> list[DeletedWorkflowBinding]:
        assert (context, owner, version) == (CONTEXT, WorkflowOwner("app"), "version")
        steps.append("commit")
        if failed:
            raise RuntimeError("commit failed")
        return [DeletedWorkflowBinding(WorkflowAgentBindingType.INLINE_AGENT, "agent")]

    def retire(context: RequestContext, agents: list[str]) -> None:
        assert context is CONTEXT
        assert agents == ["agent"]
        steps.append("retire")

    definitions.delete.side_effect = delete
    runtime.retire_agents.side_effect = retire
    if failed:
        with pytest.raises(RuntimeError, match="commit failed"):
            service.delete(CONTEXT, WorkflowOwner("app"), "version")
        assert steps == ["commit"]
    else:
        service.delete(CONTEXT, WorkflowOwner("app"), "version")
        assert steps == ["commit", "retire"]


def test_trigger_waits_without_execution(
    dependencies: tuple[ConsoleWorkflowService[WorkflowAgentBindingStore], Mock, Mock, Mock, Mock, Mock],
) -> None:
    service, _, runtime, *_ = dependencies
    runtime.poll_trigger.return_value = None
    assert service.trigger(CONTEXT, "app", ["node"], single_node=False, select_all=True) is None
    runtime.generate.assert_not_called()
    runtime.run_node.assert_not_called()


@pytest.mark.parametrize("single_node", [False, True])
def test_trigger_executes_selected_event(
    dependencies: tuple[ConsoleWorkflowService[WorkflowAgentBindingStore], Mock, Mock, Mock, Mock, Mock],
    single_node: bool,
) -> None:
    service, _, runtime, *_ = dependencies
    args = {"inputs": {"query": "event"}}
    runtime.poll_trigger.return_value = WorkflowTriggerEvent("selected", args, SNAPSHOT)
    runtime.run_node.return_value = {"inputs": "{}"}
    result = service.trigger(CONTEXT, "app", ["a", "selected"], single_node=single_node, select_all=not single_node)
    if single_node:
        assert result == {"inputs": "{}"}
        runtime.run_node.assert_called_once_with(
            CONTEXT, "app", "selected", args, include_details=False, workflow=SNAPSHOT
        )
        runtime.generate.assert_not_called()
    else:
        assert result is runtime.generate.return_value
        runtime.generate.assert_called_once_with(CONTEXT, "app", args, root_node_id="selected", workflow=SNAPSHOT)


@pytest.mark.parametrize(
    ("single_node", "select_all", "expected"),
    [(True, False, WorkflowTriggerError), (False, True, WorkflowTriggerError), (False, False, RuntimeError)],
)
def test_trigger_execution_failure_policy(
    dependencies: tuple[ConsoleWorkflowService[WorkflowAgentBindingStore], Mock, Mock, Mock, Mock, Mock],
    single_node: bool,
    select_all: bool,
    expected: type[Exception],
) -> None:
    service, _, runtime, *_ = dependencies
    runtime.poll_trigger.return_value = WorkflowTriggerEvent("node", {}, SNAPSHOT)
    runtime.run_node.side_effect = runtime.generate.side_effect = RuntimeError("internal detail")
    with pytest.raises(expected) as error:
        service.trigger(CONTEXT, "app", ["node"], single_node=single_node, select_all=select_all)
    if isinstance(error.value, WorkflowTriggerError):
        assert "internal detail" not in str(error.value)


def test_trigger_rate_limit_remains_distinct(
    dependencies: tuple[ConsoleWorkflowService[WorkflowAgentBindingStore], Mock, Mock, Mock, Mock, Mock],
) -> None:
    service, _, runtime, *_ = dependencies
    runtime.poll_trigger.return_value = WorkflowTriggerEvent("node", {}, SNAPSHOT)
    runtime.generate.side_effect = InvokeRateLimitError("rate limit")
    with pytest.raises(InvokeRateLimitError):
        service.trigger(CONTEXT, "app", ["node"], single_node=False, select_all=True)


def test_online_users_authorizes_before_reading_presence_and_signing(
    dependencies: tuple[ConsoleWorkflowService[WorkflowAgentBindingStore], Mock, Mock, Mock, Mock, Mock],
) -> None:
    service, _, _, apps, presence, access = dependencies
    apps.maintainers.return_value = {"a": "owner", "b": None}
    access.accessible_app_ids.return_value = {"a"}
    presence.online_users.return_value = {
        "a": [
            {"user_id": "u", "username": "User", "avatar": "file-id"},
            {"user_id": "u2", "username": "Second", "avatar": 3},
            {"user_id": 3, "username": "invalid"},
            {"user_id": "u3", "username": "Third", "avatar": "https://example.com/avatar"},
        ]
    }
    access.avatar_url.return_value = "signed"
    assert service.online_users(CONTEXT, ["b", "a", "foreign"]) == [
        {
            "app_id": "a",
            "users": [
                {"user_id": "u", "username": "User", "avatar": "signed"},
                {"user_id": "u2", "username": "Second", "avatar": None},
                {"user_id": "u3", "username": "Third", "avatar": "https://example.com/avatar"},
            ],
        }
    ]
    presence.online_users.assert_called_once_with(["a"])
    access.avatar_url.assert_called_once_with("file-id")


def test_online_users_signing_failure_preserves_original(
    dependencies: tuple[ConsoleWorkflowService[WorkflowAgentBindingStore], Mock, Mock, Mock, Mock, Mock],
) -> None:
    service, _, _, apps, presence, access = dependencies
    maintainers: dict[str, str | None] = {"a": None}
    apps.maintainers.return_value = maintainers
    access.accessible_app_ids.return_value = {"a"}
    presence.online_users.return_value = {"a": [{"user_id": "u", "username": "User", "avatar": "file-id"}]}
    access.avatar_url.side_effect = RuntimeError("unavailable")
    assert service.online_users(CONTEXT, ["a"])[0]["users"][0]["avatar"] == "file-id"


def test_online_users_rejects_large_input_before_io(
    dependencies: tuple[ConsoleWorkflowService[WorkflowAgentBindingStore], Mock, Mock, Mock, Mock, Mock],
) -> None:
    service, _, _, apps, presence, _ = dependencies
    assert service.online_users(CONTEXT, []) == []
    with pytest.raises(ValueError, match="Maximum 1000"):
        service.online_users(CONTEXT, [str(index) for index in range(1001)])
    apps.maintainers.assert_not_called()
    presence.online_users.assert_not_called()


def test_conversion_resolves_permissions_for_new_app(
    dependencies: tuple[ConsoleWorkflowService[WorkflowAgentBindingStore], Mock, Mock, Mock, Mock, Mock],
) -> None:
    service, _, runtime, _, _, access = dependencies
    cast(Mock, service._conversion).convert.return_value = "new-app"
    access.permission_keys.return_value = ["edit"]
    assert service.convert(CONTEXT, "source", {}) == {"new_app_id": "new-app", "permission_keys": ["edit"]}
    access.permission_keys.assert_called_once_with(CONTEXT, "new-app")
    cast(Mock, service._conversion).convert.assert_called_once_with(CONTEXT, "source", {})
