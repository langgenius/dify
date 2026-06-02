"""Contract tests for FastAPI/API v2 workflow draft endpoints."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from api_fastapi.errors import ErrorResponse
from api_fastapi.routers.workflows import SyncDraftWorkflowResponse, WorkflowDraftResponse
from core.helper import encrypter
from libs.rsa import generate_key_pair
from models import Account
from models.account import Tenant, TenantAccountJoin, TenantAccountRole
from models.model import App, AppMode, DifySetup, IconType
from models.workflow import Workflow, WorkflowType
from tests_fastapi.container_setup import FastAPIContainerApp, sync_session_savepoint_override
from tests_fastapi.helpers import console_auth_headers


@dataclass(frozen=True)
class WorkflowDraftSeed:
    account_id: str
    tenant_id: str
    app_id: str
    workflow_id: str | None
    workflow_hash: str | None


def test_get_workflow_draft_returns_canvas_contract(
    fastapi_app_with_containers: FastAPIContainerApp,
) -> None:
    graph = _workflow_graph("start-node")
    features = _workflow_features()

    with sync_session_savepoint_override(fastapi_app_with_containers) as savepoint_override:
        with savepoint_override.session_maker.begin() as session:
            seed = _seed_workflow_app(session, graph=graph, features=features, with_draft=True)

        with TestClient(savepoint_override.app) as client:
            response = client.get(
                f"/api/v2/apps/{seed.app_id}/workflows/draft",
                headers=console_auth_headers(seed.account_id),
            )

        assert response.status_code == 200
        draft = WorkflowDraftResponse.model_validate(response.json())
        assert draft.id == seed.workflow_id
        assert draft.graph == graph
        assert draft.features == features
        assert draft.hash == seed.workflow_hash
        assert draft.version == Workflow.VERSION_DRAFT
        assert draft.created_by is not None
        assert draft.created_by.email.startswith("fastapi-workflow-")
        assert draft.environment_variables == []
        assert draft.conversation_variables == []
        assert draft.rag_pipeline_variables == []


def test_sync_workflow_draft_creates_draft_and_persists_canvas_state(
    fastapi_app_with_containers: FastAPIContainerApp,
) -> None:
    graph = _workflow_graph("created-start-node")
    features = _workflow_features()

    with sync_session_savepoint_override(fastapi_app_with_containers) as savepoint_override:
        with savepoint_override.session_maker.begin() as session:
            seed = _seed_workflow_app(session, graph=graph, features=features, with_draft=False)

        headers = console_auth_headers(seed.account_id, csrf=True)
        with TestClient(savepoint_override.app) as client:
            client.cookies.set("csrf_token", headers["X-CSRF-Token"])
            response = client.post(
                f"/api/v2/apps/{seed.app_id}/workflows/draft",
                headers=headers,
                json={
                    "graph": graph,
                    "features": features,
                    "hash": None,
                    "environment_variables": [],
                    "conversation_variables": [],
                },
            )

        assert response.status_code == 200
        sync_response = SyncDraftWorkflowResponse.model_validate(response.json())
        assert sync_response.id
        assert sync_response.hash
        assert sync_response.updated_at > 0

        with savepoint_override.session_maker() as session:
            workflow = _get_draft_workflow(session, seed.app_id)
            assert workflow is not None
            assert workflow.created_by == seed.account_id
            assert workflow.graph_dict == graph
            assert workflow.features_dict == features
            assert workflow.id == sync_response.id
            assert workflow.unique_hash == sync_response.hash


def test_sync_workflow_draft_persists_variable_contract(
    fastapi_app_with_containers: FastAPIContainerApp,
) -> None:
    graph = _workflow_graph("variable-start-node")
    features = _workflow_features()
    environment_variables = [
        {
            "id": "env-token",
            "name": "API_TOKEN",
            "value": "token-value",
            "value_type": "secret",
            "description": "Token used by tool nodes",
        }
    ]
    conversation_variables = [
        {
            "id": "conversation-topic",
            "name": "topic",
            "value": "migration",
            "value_type": "string",
            "description": "Conversation topic",
        }
    ]

    with sync_session_savepoint_override(fastapi_app_with_containers) as savepoint_override:
        with savepoint_override.session_maker.begin() as session:
            seed = _seed_workflow_app(session, graph=graph, features=features, with_draft=False, with_encrypt_key=True)

        headers = console_auth_headers(seed.account_id, csrf=True)
        with TestClient(savepoint_override.app) as client:
            client.cookies.set("csrf_token", headers["X-CSRF-Token"])
            sync_response = client.post(
                f"/api/v2/apps/{seed.app_id}/workflows/draft",
                headers=headers,
                json={
                    "graph": graph,
                    "features": features,
                    "hash": None,
                    "environment_variables": environment_variables,
                    "conversation_variables": conversation_variables,
                },
            )
            get_response = client.get(
                f"/api/v2/apps/{seed.app_id}/workflows/draft",
                headers=console_auth_headers(seed.account_id),
            )

        assert sync_response.status_code == 200
        assert get_response.status_code == 200
        draft = WorkflowDraftResponse.model_validate(get_response.json())
        assert draft.environment_variables[0].model_dump() == {
            **environment_variables[0],
            "value": encrypter.full_mask_token(),
        }
        assert draft.conversation_variables[0].model_dump() == conversation_variables[0]

        with savepoint_override.session_maker() as session:
            workflow = _get_draft_workflow(session, seed.app_id)
            assert workflow is not None
            persisted_environment_variables = list(workflow.environment_variables)
            persisted_conversation_variables = list(workflow.conversation_variables)
            assert persisted_environment_variables[0].name == "API_TOKEN"
            assert persisted_environment_variables[0].value == "token-value"
            assert persisted_conversation_variables[0].name == "topic"
            assert persisted_conversation_variables[0].value == "migration"


def test_sync_workflow_draft_rejects_stale_hash(
    fastapi_app_with_containers: FastAPIContainerApp,
) -> None:
    graph = _workflow_graph("stale-start-node")
    features = _workflow_features()

    with sync_session_savepoint_override(fastapi_app_with_containers) as savepoint_override:
        with savepoint_override.session_maker.begin() as session:
            seed = _seed_workflow_app(session, graph=graph, features=features, with_draft=True)

        headers = console_auth_headers(seed.account_id, csrf=True)
        with TestClient(savepoint_override.app) as client:
            client.cookies.set("csrf_token", headers["X-CSRF-Token"])
            response = client.post(
                f"/api/v2/apps/{seed.app_id}/workflows/draft",
                headers=headers,
                json={
                    "graph": _workflow_graph("client-start-node"),
                    "features": features,
                    "hash": "not-the-current-hash",
                    "environment_variables": [],
                    "conversation_variables": [],
                },
            )

        assert response.status_code == 409
        error = ErrorResponse.model_validate(response.json())
        assert error.code == "draft_workflow_not_sync"
        assert error.status == 409


def test_sync_workflow_draft_rejects_unknown_variable_fields(
    fastapi_app_with_containers: FastAPIContainerApp,
) -> None:
    graph = _workflow_graph("invalid-variable-start-node")
    features = _workflow_features()

    with sync_session_savepoint_override(fastapi_app_with_containers) as savepoint_override:
        with savepoint_override.session_maker.begin() as session:
            seed = _seed_workflow_app(session, graph=graph, features=features, with_draft=False)

        headers = console_auth_headers(seed.account_id, csrf=True)
        with TestClient(savepoint_override.app) as client:
            client.cookies.set("csrf_token", headers["X-CSRF-Token"])
            response = client.post(
                f"/api/v2/apps/{seed.app_id}/workflows/draft",
                headers=headers,
                json={
                    "graph": graph,
                    "features": features,
                    "hash": None,
                    "environment_variables": [
                        {
                            "id": "env-with-extra",
                            "name": "API_TOKEN",
                            "value": "token-value",
                            "value_type": "secret",
                            "description": "Token used by tool nodes",
                            "unexpected": "field",
                        }
                    ],
                    "conversation_variables": [],
                },
            )

        assert response.status_code == 400
        error = ErrorResponse.model_validate(response.json())
        assert error.code == "invalid_param"
        assert error.status == 400


def test_sync_workflow_draft_requires_csrf_pair(
    fastapi_app_with_containers: FastAPIContainerApp,
) -> None:
    graph = _workflow_graph("csrf-start-node")
    features = _workflow_features()

    with sync_session_savepoint_override(fastapi_app_with_containers) as savepoint_override:
        with savepoint_override.session_maker.begin() as session:
            seed = _seed_workflow_app(session, graph=graph, features=features, with_draft=True)

        with TestClient(savepoint_override.app) as client:
            response = client.post(
                f"/api/v2/apps/{seed.app_id}/workflows/draft",
                headers=console_auth_headers(seed.account_id),
                json={
                    "graph": graph,
                    "features": features,
                    "hash": seed.workflow_hash,
                    "environment_variables": [],
                    "conversation_variables": [],
                },
            )

        assert response.status_code == 401
        error = ErrorResponse.model_validate(response.json())
        assert error.code == "csrf_token_invalid"
        assert error.status == 401


def test_get_workflow_draft_requires_editor_role(
    fastapi_app_with_containers: FastAPIContainerApp,
) -> None:
    graph = _workflow_graph("viewer-start-node")
    features = _workflow_features()

    with sync_session_savepoint_override(fastapi_app_with_containers) as savepoint_override:
        with savepoint_override.session_maker.begin() as session:
            seed = _seed_workflow_app(
                session,
                graph=graph,
                features=features,
                with_draft=True,
                role=TenantAccountRole.NORMAL,
            )

        with TestClient(savepoint_override.app) as client:
            response = client.get(
                f"/api/v2/apps/{seed.app_id}/workflows/draft",
                headers=console_auth_headers(seed.account_id),
            )

        assert response.status_code == 403
        error = ErrorResponse.model_validate(response.json())
        assert error.code == "forbidden"
        assert error.status == 403


def test_get_workflow_draft_rejects_unsupported_app_mode(
    fastapi_app_with_containers: FastAPIContainerApp,
) -> None:
    graph = _workflow_graph("unsupported-mode-start-node")
    features = _workflow_features()

    with sync_session_savepoint_override(fastapi_app_with_containers) as savepoint_override:
        with savepoint_override.session_maker.begin() as session:
            seed = _seed_workflow_app(
                session,
                graph=graph,
                features=features,
                with_draft=True,
                mode=AppMode.CHAT,
            )

        with TestClient(savepoint_override.app) as client:
            response = client.get(
                f"/api/v2/apps/{seed.app_id}/workflows/draft",
                headers=console_auth_headers(seed.account_id),
            )

        assert response.status_code == 404
        error = ErrorResponse.model_validate(response.json())
        assert error.code == "app_not_found"
        assert error.message.startswith("App mode is not in the supported list: ")
        assert "advanced-chat" in error.message
        assert "workflow" in error.message
        assert error.status == 404


def test_workflow_draft_routes_scope_to_current_tenant(
    fastapi_app_with_containers: FastAPIContainerApp,
) -> None:
    graph = _workflow_graph("current-tenant-start-node")
    features = _workflow_features()

    with sync_session_savepoint_override(fastapi_app_with_containers) as savepoint_override:
        with savepoint_override.session_maker.begin() as session:
            seed = _seed_workflow_app(session, graph=graph, features=features, with_draft=True)
            other_tenant = Tenant(name=f"FastAPI Workflow Workspace {uuid4()}")
            session.add(other_tenant)
            session.flush()
            original_join = session.scalar(
                select(TenantAccountJoin).where(
                    TenantAccountJoin.tenant_id == seed.tenant_id,
                    TenantAccountJoin.account_id == seed.account_id,
                )
            )
            assert original_join is not None
            original_join.current = False
            session.add(
                TenantAccountJoin(
                    tenant_id=other_tenant.id,
                    account_id=seed.account_id,
                    current=True,
                    role=TenantAccountRole.EDITOR,
                )
            )

        with TestClient(savepoint_override.app) as client:
            response = client.get(
                f"/api/v2/apps/{seed.app_id}/workflows/draft",
                headers=console_auth_headers(seed.account_id),
            )

        assert response.status_code == 404
        error = ErrorResponse.model_validate(response.json())
        assert error.code == "app_not_found"
        assert error.status == 404


def test_workflow_draft_routes_hide_other_tenant_apps(
    fastapi_app_with_containers: FastAPIContainerApp,
) -> None:
    graph = _workflow_graph("tenant-start-node")
    features = _workflow_features()

    with sync_session_savepoint_override(fastapi_app_with_containers) as savepoint_override:
        with savepoint_override.session_maker.begin() as session:
            seed = _seed_workflow_app(session, graph=graph, features=features, with_draft=True)
            other_account_id, _ = _seed_account_and_tenant(session, role=TenantAccountRole.EDITOR)

        headers = console_auth_headers(other_account_id, csrf=True)
        with TestClient(savepoint_override.app) as client:
            get_response = client.get(
                f"/api/v2/apps/{seed.app_id}/workflows/draft",
                headers=console_auth_headers(other_account_id),
            )

            client.cookies.set("csrf_token", headers["X-CSRF-Token"])
            post_response = client.post(
                f"/api/v2/apps/{seed.app_id}/workflows/draft",
                headers=headers,
                json={
                    "graph": _workflow_graph("other-tenant-start-node"),
                    "features": features,
                    "hash": seed.workflow_hash,
                    "environment_variables": [],
                    "conversation_variables": [],
                },
            )

        assert get_response.status_code == 404
        get_error = ErrorResponse.model_validate(get_response.json())
        assert get_error.code == "app_not_found"
        assert get_error.status == 404

        assert post_response.status_code == 404
        post_error = ErrorResponse.model_validate(post_response.json())
        assert post_error.code == "app_not_found"
        assert post_error.status == 404

        with savepoint_override.session_maker() as session:
            workflow = _get_draft_workflow(session, seed.app_id)
            assert workflow is not None
            assert workflow.graph_dict == graph


def _seed_workflow_app(
    session: Session,
    *,
    graph: dict[str, Any],
    features: dict[str, Any],
    with_draft: bool,
    role: TenantAccountRole = TenantAccountRole.EDITOR,
    with_encrypt_key: bool = False,
    mode: AppMode = AppMode.WORKFLOW,
) -> WorkflowDraftSeed:
    setup = DifySetup(version=f"fastapi-workflow-{uuid4()}")
    session.add(setup)
    account_id, tenant_id = _seed_account_and_tenant(session, role=role, with_encrypt_key=with_encrypt_key)

    app = App(
        tenant_id=tenant_id,
        name=f"FastAPI Workflow App {uuid4()}",
        description="Workflow draft API v2 contract fixture",
        mode=mode,
        icon_type=IconType.EMOJI,
        icon="x",
        icon_background="#FFFFFF",
        enable_site=True,
        enable_api=True,
    )
    session.add(app)
    session.flush()

    workflow: Workflow | None = None
    if with_draft:
        workflow = Workflow(
            tenant_id=tenant_id,
            app_id=app.id,
            type=WorkflowType.WORKFLOW.value,
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(graph),
            features=json.dumps(features),
            created_by=account_id,
            environment_variables=[],
            conversation_variables=[],
        )
        session.add(workflow)
        session.flush()

    return WorkflowDraftSeed(
        account_id=account_id,
        tenant_id=tenant_id,
        app_id=app.id,
        workflow_id=workflow.id if workflow else None,
        workflow_hash=workflow.unique_hash if workflow else None,
    )


def _seed_account_and_tenant(
    session: Session,
    *,
    role: TenantAccountRole,
    with_encrypt_key: bool = False,
) -> tuple[str, str]:
    account = Account(
        name="FastAPI Workflow User",
        email=f"fastapi-workflow-{uuid4()}@example.com",
        interface_language="en-US",
        interface_theme="light",
        timezone="UTC",
    )
    tenant = Tenant(name=f"FastAPI Workflow Workspace {uuid4()}")
    session.add_all([account, tenant])
    session.flush()
    if with_encrypt_key:
        tenant.encrypt_public_key = generate_key_pair(tenant.id)

    session.add(
        TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            current=True,
            role=role,
        )
    )
    return account.id, tenant.id


def _get_draft_workflow(session: Session, app_id: str) -> Workflow | None:
    return session.scalar(
        select(Workflow).where(
            Workflow.app_id == app_id,
            Workflow.version == Workflow.VERSION_DRAFT,
        )
    )


def _workflow_graph(node_id: str) -> dict[str, Any]:
    return {
        "nodes": [
            {
                "id": node_id,
                "type": "custom",
                "data": {
                    "type": "start",
                    "title": "Start",
                    "variables": [],
                },
                "position": {"x": 0, "y": 0},
            }
        ],
        "edges": [],
    }


def _workflow_features() -> dict[str, Any]:
    return {
        "file_upload": {"enabled": False},
        "sensitive_word_avoidance": {"enabled": False},
        "text_to_speech": {"enabled": False, "language": "", "voice": ""},
    }
