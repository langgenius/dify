from dataclasses import asdict
from datetime import datetime

import pytest
from pydantic import ValidationError
from sqlalchemy import event
from sqlalchemy.orm import Session

from core.workflow.llm_environment_variable import LLMEnvironmentVariable
from extensions.application_services.snippets import build_snippet_service
from fields import workflow_fields
from graphon.variables import SecretVariable, StringVariable
from graphon.variables.variables import RAGPipelineVariable
from models.dataset import Pipeline
from models.snippet import CustomizedSnippet
from models.tools import WorkflowToolProvider
from models.workflow import WorkflowKind
from repositories.workflow.definition_repository import workflow_record
from services.rag_pipeline.rag_pipeline import RagPipelineService
from services.workflow_ref_service import WorkflowRef
from tests.unit_tests.model_factories import make_account, make_workflow


@pytest.mark.parametrize("snippet", [False, True])
def test_version_lists_share_publication_order_and_owner_scope(sqlite_session: Session, snippet: bool) -> None:
    kind = WorkflowKind.SNIPPET if snippet else WorkflowKind.STANDARD
    older = make_workflow(workflow_id="older", app_id="owner", version="z-old", kind=kind)
    newer = make_workflow(workflow_id="newer", app_id="owner", version="a-new", kind=kind, marked_name="Release")
    draft = make_workflow(workflow_id="draft", app_id="owner", kind=kind)
    foreign_tenant = make_workflow(
        workflow_id="foreign", app_id="owner", tenant_id="other", version="foreign", kind=kind
    )
    foreign_owner = make_workflow(workflow_id="other-owner", app_id="other-owner", version="other", kind=kind)
    for year, workflow in [(2020, draft), (2021, older), (2022, newer), (2023, foreign_tenant), (2024, foreign_owner)]:
        workflow.created_at = datetime(year, 1, 1)
        sqlite_session.add(workflow)
    if snippet:
        sqlite_session.add(make_workflow(workflow_id="wrong-kind", app_id="owner", version="wrong-kind"))
    sqlite_session.commit()

    if snippet:
        owner = CustomizedSnippet(id="owner", tenant_id="tenant-1", workflow_id=newer.id)
        service = build_snippet_service(session=sqlite_session)
        page, has_more = service.get_all_published_workflows(session=sqlite_session, snippet=owner, page=1, limit=1)
        assert [item.id for item in page] == ["newer"]
        assert has_more
        page, has_more = service.get_all_published_workflows(session=sqlite_session, snippet=owner, page=2, limit=1)
        assert [item.id for item in page] == ["older"]
    else:
        pipeline = Pipeline(tenant_id="tenant-1", name="Pipeline", workflow_id=newer.id)
        pipeline.id = "owner"
        pipelines = RagPipelineService(sqlite_session)
        page, has_more = pipelines.get_all_published_workflow(
            session=sqlite_session, pipeline=pipeline, page=1, limit=2, user_id=None
        )
        assert [item.id for item in page] == ["draft", "newer"]
        assert has_more
        page, has_more = pipelines.get_all_published_workflow(
            session=sqlite_session, pipeline=pipeline, page=2, limit=2, user_id=None
        )
        assert [item.id for item in page] == ["older"]
        named, more = pipelines.get_all_published_workflow(
            session=sqlite_session, pipeline=pipeline, page=1, limit=2, user_id="account-1", named_only=True
        )
        assert [item.id for item in named] == ["newer"]
        assert not more
    assert not has_more


@pytest.fixture(autouse=True)
def _identity_workflow_encryption(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep variable serialization focused on ORM behavior, not the external key provider."""

    monkeypatch.setattr(workflow_fields.encrypter, "encrypt_token", lambda *, token, **_kwargs: token)
    monkeypatch.setattr(workflow_fields.encrypter, "decrypt_token", lambda *, token, **_kwargs: token)


def test_pipeline_variable_response_accepts_legacy_file_field_names() -> None:
    response = workflow_fields.PipelineVariableResponse.model_validate(
        {
            "label": "Query",
            "variable": "query",
            "type": "single-file",
            "belong_to_node_id": "shared",
            "max_length": 0,
            "required": False,
            "unit": "",
            "default_value": "",
            "options": [],
            "placeholder": "",
            "tooltips": "",
            "allowed_file_types": [],
            "allow_file_extension": [".txt"],
            "allow_file_upload_methods": ["remote_url"],
        }
    ).model_dump(mode="json")

    assert response["allowed_file_extensions"] == [".txt"]
    assert response["allowed_file_upload_methods"] == ["remote_url"]


def test_pipeline_variable_response_accepts_explicit_null_optional_fields() -> None:
    pipeline_variable = RAGPipelineVariable.model_validate(
        {
            "label": "Query",
            "variable": "query",
            "type": "text-input",
            "belong_to_node_id": "shared",
            "max_length": None,
            "unit": None,
            "default_value": None,
            "options": None,
            "placeholder": None,
            "tooltips": None,
            "allowed_file_types": None,
            "allowed_file_extensions": None,
            "allowed_file_upload_methods": None,
        }
    ).model_dump(mode="json")

    response = workflow_fields.PipelineVariableResponse.model_validate(pipeline_variable).model_dump(mode="json")

    assert response["max_length"] is None
    assert response["allowed_file_types"] is None
    assert response["allowed_file_extensions"] is None
    assert response["allowed_file_upload_methods"] is None


def test_workflow_response_masks_secret_environment_variables(sqlite_session: Session) -> None:
    workflow = make_workflow(
        environment_variables=[
            SecretVariable(id="env-secret", name="API_KEY", value="plain-token", selector=["env", "API_KEY"]),
            StringVariable(id="env-string", name="REGION", value="us-east-1", selector=["env", "REGION"]),
        ]
    )
    sqlite_session.add_all([make_account(), workflow])
    sqlite_session.commit()

    record = workflow_record(workflow, sqlite_session)
    sqlite_session.close()
    response = workflow_fields.WorkflowResponse.model_validate(
        record,
        from_attributes=True,
    ).model_dump(mode="json")

    assert response["environment_variables"] == [
        {
            "id": "env-secret",
            "name": "API_KEY",
            "value": workflow_fields.encrypter.full_mask_token(),
            "value_type": "secret",
            "description": "",
        },
        {
            "id": "env-string",
            "name": "REGION",
            "value": "us-east-1",
            "value_type": "string",
            "description": "",
        },
    ]


def test_workflow_response_preserves_llm_environment_variable_type(sqlite_session: Session) -> None:
    workflow = make_workflow(
        environment_variables=[
            LLMEnvironmentVariable(
                id="env-llm",
                name="for_summarize",
                value={"provider": "provider", "name": "model", "mode": "chat"},
                selector=["env", "for_summarize"],
            )
        ]
    )
    sqlite_session.add_all([make_account(), workflow])
    sqlite_session.commit()

    record = workflow_record(workflow, sqlite_session)
    sqlite_session.close()
    response = workflow_fields.WorkflowResponse.model_validate(
        record,
        from_attributes=True,
    ).model_dump(mode="json")

    assert response["environment_variables"] == [
        {
            "id": "env-llm",
            "name": "for_summarize",
            "value": {"provider": "provider", "name": "model", "mode": "chat"},
            "value_type": "llm",
            "description": "",
        }
    ]


def test_workflow_response_rejects_invalid_environment_variable_dict(sqlite_session: Session) -> None:
    data = asdict(workflow_record(make_workflow(), sqlite_session))
    data["environment_variables"] = [{"value_type": "not-a-segment-type"}]
    sqlite_session.close()
    with pytest.raises(ValidationError):
        workflow_fields.WorkflowResponse.model_validate(data)


@pytest.mark.parametrize("owner", ["snippet", "pipeline"])
@pytest.mark.parametrize("operation", ["draft", "published", "list", "update"])
def test_workflow_records_serialize_after_session_closes(
    sqlite_session: Session,
    owner: str,
    operation: str,
) -> None:
    workflow = make_workflow(workflow_id="workflow-1", app_id="owner-1")
    workflow.kind = WorkflowKind.SNIPPET if owner == "snippet" else WorkflowKind.STANDARD
    workflow.version = "draft" if operation == "draft" else "2026-10-02 12:00:00"
    workflow.updated_by = "editor-1"
    author = make_account()
    editor = make_account(account_id="editor-1", email="editor@example.com")
    sqlite_session.add_all(
        [
            workflow,
            author,
            editor,
            WorkflowToolProvider(
                name="workflow-tool",
                label="Workflow",
                icon="",
                app_id="owner-1",
                version=workflow.version,
                user_id=author.id,
                tenant_id=workflow.tenant_id,
                description="",
            ),
        ]
    )
    sqlite_session.commit()
    if owner == "snippet":
        snippet = CustomizedSnippet(
            id="owner-1",
            tenant_id="tenant-1",
            name="Snippet",
            description="",
            type="node",
            created_by=author.id,
            workflow_id=workflow.id,
        )
        snippets = build_snippet_service(session=sqlite_session)
        match operation:
            case "draft":
                record = snippets.get_draft_workflow_record(snippet)
            case "published":
                record = snippets.get_published_workflow_record(snippet)
            case "list":
                records, _ = snippets.get_all_published_workflows(
                    session=sqlite_session, snippet=snippet, page=1, limit=20
                )
                record = records[0]
            case _:
                record = snippets.update_workflow(
                    session=sqlite_session,
                    snippet=snippet,
                    workflow_id=workflow.id,
                    account=editor,
                    data={"marked_name": "Updated"},
                )
    else:
        pipeline = Pipeline(tenant_id="tenant-1", name="Pipeline", description="")
        pipeline.id = "owner-1"
        pipeline.workflow_id = workflow.id
        pipelines = RagPipelineService(sqlite_session)
        match operation:
            case "draft":
                record = pipelines.get_draft_workflow_record(pipeline)
            case "published":
                record = pipelines.get_published_workflow_record(pipeline)
            case "list":
                records, _ = pipelines.get_all_published_workflow(
                    session=sqlite_session, pipeline=pipeline, page=1, limit=20, user_id=None
                )
                record = records[0]
            case _:
                record = pipelines.update_workflow(
                    session=sqlite_session,
                    account_id=editor.id,
                    data={"marked_name": "Updated"},
                    workflow_ref=WorkflowRef(tenant_id="tenant-1", owner_id="owner-1", workflow_id=workflow.id),
                )
    assert record is not None
    engine = sqlite_session.get_bind()
    sqlite_session.commit()
    sqlite_session.close()

    def unexpected_query(*_args: object) -> None:
        pytest.fail("workflow serialization must not execute SQL")

    event.listen(engine, "before_cursor_execute", unexpected_query)
    try:
        response = workflow_fields.WorkflowResponse.model_validate(record, from_attributes=True).model_dump(mode="json")
    finally:
        event.remove(engine, "before_cursor_execute", unexpected_query)
    assert response["created_by"]["id"] == "account-1"
    assert response["updated_by"]["id"] == "editor-1"
    assert response["tool_published"] is True
    assert response["graph"] == record.graph
    if operation == "update":
        assert response["marked_name"] == "Updated"
