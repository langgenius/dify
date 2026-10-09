"""Regression coverage for ``WorkflowNodeExecutionModel`` account accessors.

Ensures the ``@property``→session-parameter refactor preserves the role-based dispatch:
``created_by_account`` looks up an Account only when role is ACCOUNT; ``created_by_end_user``
looks up an EndUser only when role is END_USER. Also covers the session-carrying response
source used by the console endpoints that validate ``WorkflowRunNodeExecutionResponse``
with ``from_attributes=True``.
"""

import json
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from core.tools.entities.tool_entities import ToolProviderType
from fields.workflow_run_fields import WorkflowRunNodeExecutionResponse, node_execution_response_source
from graphon.enums import BuiltinNodeTypes
from models.account import Account
from models.enums import CreatorUserRole, EndUserType
from models.model import EndUser
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from services.tools.provider_queries import ToolProviderIcons
from services.tools.tool_manager import ToolManager


def _execution(role: CreatorUserRole, created_by: str) -> WorkflowNodeExecutionModel:
    """Construct a WorkflowNodeExecutionModel without touching the database."""
    return WorkflowNodeExecutionModel(
        tenant_id="00000000-0000-0000-0000-000000000001",
        app_id="00000000-0000-0000-0000-000000000002",
        workflow_id=str(uuid4()),
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        workflow_run_id=None,
        index=1,
        predecessor_node_id=None,
        node_execution_id=None,
        node_id="n1",
        node_type="start",
        title="Start",
        inputs=None,
        process_data=None,
        outputs=None,
        status="succeeded",
        error=None,
        elapsed_time=0.0,
        execution_metadata=None,
        created_by_role=role,
        created_by=created_by,
    )


class TestCreatedByAccount:
    def test_returns_account_lookup_when_role_is_account(self, sqlite_session: Session) -> None:
        account = Account(name="Test Account", email="test@example.com")
        sqlite_session.add(account)
        sqlite_session.flush()
        execution = _execution(CreatorUserRole.ACCOUNT, created_by=account.id)

        result = execution.created_by_account(session=sqlite_session)

        assert result is not None
        assert result.id == account.id

    def test_returns_none_when_role_is_end_user(self, sqlite_session: Session) -> None:
        account = Account(name="Test Account", email="test@example.com")
        sqlite_session.add(account)
        sqlite_session.flush()
        execution = _execution(CreatorUserRole.END_USER, created_by=account.id)

        assert execution.created_by_account(session=sqlite_session) is None


class TestCreatedByEndUser:
    def test_returns_end_user_lookup_when_role_is_end_user(self, sqlite_session: Session) -> None:
        end_user = EndUser(
            tenant_id="00000000-0000-0000-0000-000000000001",
            type=EndUserType.BROWSER,
            session_id="session-1",
        )
        sqlite_session.add(end_user)
        sqlite_session.flush()
        execution = _execution(CreatorUserRole.END_USER, created_by=end_user.id)

        result = execution.created_by_end_user(session=sqlite_session)

        assert result is not None
        assert result.id == end_user.id

    def test_returns_none_when_role_is_account(self, sqlite_session: Session) -> None:
        end_user = EndUser(
            tenant_id="00000000-0000-0000-0000-000000000001",
            type=EndUserType.BROWSER,
            session_id="session-1",
        )
        sqlite_session.add(end_user)
        sqlite_session.flush()
        execution = _execution(CreatorUserRole.ACCOUNT, created_by=end_user.id)

        assert execution.created_by_end_user(session=sqlite_session) is None


class TestNodeExecutionResponseSource:
    @pytest.mark.parametrize("node_type", [BuiltinNodeTypes.TOOL, BuiltinNodeTypes.DATASOURCE])
    def test_provider_icons_survive_response_serialization(
        self,
        sqlite_session: Session,
        monkeypatch: pytest.MonkeyPatch,
        node_type: str,
        *,
        tool_providers: ToolProviderIcons,
    ) -> None:
        execution = _execution(CreatorUserRole.ACCOUNT, created_by="account")
        execution.id = "execution"
        execution.node_type = node_type
        execution.execution_metadata = json.dumps(
            {
                "tool_info": {"provider_type": "builtin", "provider_id": "provider"},
                "datasource_info": {"icon": "source-icon"},
            }
        )

        def tool_icon(
            *, tenant_id: str, provider_type: ToolProviderType, provider_id: str, tool_providers: ToolProviderIcons
        ) -> str:
            assert tool_providers is not None
            assert (tenant_id, provider_type, provider_id) == (execution.tenant_id, "builtin", "provider")
            return "tool-icon"

        monkeypatch.setattr(ToolManager, "get_tool_icon", tool_icon)
        response = WorkflowRunNodeExecutionResponse.model_validate(
            node_execution_response_source(execution, session=sqlite_session, tool_providers=tool_providers)
        )
        assert response.extras == {"icon": "tool-icon" if node_type == BuiltinNodeTypes.TOOL else "source-icon"}

    def test_accessors_resolve_via_wrapped_session_and_other_attributes_proxy(
        self, sqlite_session: Session, *, tool_providers: ToolProviderIcons
    ) -> None:
        account = Account(name="Test Account", email="test@example.com")
        sqlite_session.add(account)
        sqlite_session.flush()
        execution = _execution(CreatorUserRole.ACCOUNT, created_by=account.id)

        source = node_execution_response_source(execution, session=sqlite_session, tool_providers=tool_providers)

        resolved = source.created_by_account
        assert resolved is not None
        assert resolved.id == account.id
        assert source.created_by_end_user is None
        assert source.node_id == "n1"
