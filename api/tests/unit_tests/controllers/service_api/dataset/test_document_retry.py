"""Exercise retry HTTP admission with real document services and SQLite persistence."""

from collections.abc import Iterator
from dataclasses import dataclass
from unittest.mock import Mock, patch
from uuid import uuid4

import pytest
from flask import Flask
from flask.testing import FlaskClient
from flask_login import LoginManager
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from controllers.service_api import bp
from extensions.ext_application_services import ApplicationServices
from extensions.ext_database import db
from models import Account, Tenant, TenantAccountJoin
from models.account import TenantAccountRole
from models.dataset import Dataset, Document, RateLimitLog
from models.enums import ApiTokenType, DataSourceType, DocumentCreatedFrom, IndexingStatus
from models.model import ApiToken, DatasetApiTokenBinding
from services.entities.feature_entities import KnowledgeRateLimitModel
from services.knowledge.dataset_access import DatasetAccessDeniedError
from services.knowledge.documents.application import DatasetDocumentApplicationService


@dataclass
class RetryRecords:
    dataset: Dataset
    document: Document
    token: ApiToken
    account: Account

    @property
    def path(self) -> str:
        return f"/v1/datasets/{self.dataset.id}/documents/retry"

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token.token}"}


@pytest.fixture
def records(sqlite_session: Session) -> RetryRecords:
    tenant = Tenant(name="Retry workspace")
    account = Account(name="Retry owner", email=f"retry-{uuid4()}@example.test")
    membership = TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER)
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=tenant.id,
        name="Retry dataset",
        created_by=account.id,
        maintainer=account.id,
        indexing_technique="economy",
        enable_api=True,
    )
    document = Document(
        id=str(uuid4()),
        tenant_id=tenant.id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info='{"upload_file_id": "stored-source"}',
        batch="original-batch",
        name="Retry document",
        created_from=DocumentCreatedFrom.API,
        created_by=account.id,
        indexing_status=IndexingStatus.ERROR,
        enabled=True,
        archived=False,
        is_paused=False,
        doc_form="text_model",
    )
    token = ApiToken(tenant_id=tenant.id, type=ApiTokenType.DATASET, token=f"dataset-test-{uuid4()}")
    sqlite_session.add_all([tenant, account, membership, dataset, document, token])
    sqlite_session.commit()
    return RetryRecords(dataset, document, token, account)


@pytest.fixture
def client(sqlite_engine: Engine, account_application_services: ApplicationServices) -> Iterator[FlaskClient]:
    app = Flask(__name__)
    app.config.update(TESTING=True, SECRET_KEY="retry-test", SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(app)
    LoginManager(app)
    app.extensions["application_services"] = account_application_services
    app.register_blueprint(bp)
    with app.test_client() as client:
        yield client
    with app.app_context():
        db.session.remove()
        db.engine.dispose()


@pytest.fixture
def dispatch() -> Iterator[Mock]:
    with patch("services.knowledge.dataset_service.retry_document_indexing_task.delay") as delay:
        yield delay


def test_retry_schedules_existing_document_once(
    client: FlaskClient, records: RetryRecords, dispatch: Mock, sqlite_session: Session
) -> None:
    response = client.post(
        records.path, headers=records.headers, json={"document_ids": [records.document.id, records.document.id]}
    )

    assert response.status_code == 204
    assert response.data == b""
    dispatch.assert_called_once_with(records.dataset.id, [records.document.id], records.account.id)
    sqlite_session.refresh(records.document)
    assert records.document.indexing_status == IndexingStatus.WAITING
    assert records.document.batch == "original-batch"
    assert records.document.data_source_info_dict == {"upload_file_id": "stored-source"}


@pytest.mark.parametrize("authorization", [None, "Basic invalid", "Bearer invalid"])
def test_retry_requires_dataset_token(
    client: FlaskClient, records: RetryRecords, dispatch: Mock, authorization: str | None
) -> None:
    headers: dict[str, str] = {"Authorization": authorization} if authorization else {}
    response = client.post(records.path, headers=headers, json={"document_ids": [records.document.id]})
    assert response.status_code == 401
    dispatch.assert_not_called()


@pytest.mark.parametrize("access", ["other_tenant", "unbound_dataset", "disabled", "app_token"])
def test_retry_enforces_dataset_key_scope(
    client: FlaskClient, records: RetryRecords, dispatch: Mock, sqlite_session: Session, access: str
) -> None:
    expected_status = 403
    if access == "other_tenant":
        records.dataset.tenant_id = str(uuid4())
        expected_status = 404
    elif access == "unbound_dataset":
        sqlite_session.add(DatasetApiTokenBinding(api_token_id=records.token.id, dataset_id=str(uuid4())))
    elif access == "disabled":
        records.dataset.enable_api = False
    else:
        records.token.type = ApiTokenType.APP
        expected_status = 401
    sqlite_session.commit()

    response = client.post(records.path, headers=records.headers, json={"document_ids": [records.document.id]})
    assert response.status_code == expected_status
    dispatch.assert_not_called()


@pytest.mark.parametrize(
    "payload", [{}, {"document_ids": []}, {"document_ids": ["invalid"]}, {"document_ids": [str(uuid4())] * 101}]
)
def test_retry_validates_payload(
    client: FlaskClient, records: RetryRecords, dispatch: Mock, payload: dict[str, object]
) -> None:
    response = client.post(records.path, headers=records.headers, json=payload)
    assert response.status_code == 400
    dispatch.assert_not_called()


@pytest.mark.parametrize("ownership", ["other_dataset", "other_tenant"])
def test_retry_does_not_accept_foreign_documents(
    client: FlaskClient, records: RetryRecords, dispatch: Mock, sqlite_session: Session, ownership: str
) -> None:
    if ownership == "other_dataset":
        records.document.dataset_id = str(uuid4())
    else:
        records.document.tenant_id = str(uuid4())
    sqlite_session.commit()

    response = client.post(records.path, headers=records.headers, json={"document_ids": [records.document.id]})
    assert response.status_code == 404
    dispatch.assert_not_called()


@pytest.mark.parametrize(("state", "status"), [("archived", 403), ("paused", 400), ("indexing", 400)])
def test_retry_maps_document_state_errors(
    client: FlaskClient, records: RetryRecords, dispatch: Mock, sqlite_session: Session, state: str, status: int
) -> None:
    if state == "archived":
        records.document.archived = True
    elif state == "paused":
        records.document.is_paused = True
    else:
        records.document.indexing_status = IndexingStatus.INDEXING
    sqlite_session.commit()

    response = client.post(records.path, headers=records.headers, json={"document_ids": [records.document.id]})
    assert response.status_code == status
    dispatch.assert_not_called()


def test_retry_respects_existing_retry_lock(
    client: FlaskClient, records: RetryRecords, dispatch: Mock, sqlite_session: Session
) -> None:
    with patch("services.knowledge.dataset_service.redis_client.lock") as lock:
        lock.return_value.acquire.return_value = False
        response = client.post(records.path, headers=records.headers, json={"document_ids": [records.document.id]})
    assert response.status_code == 400
    dispatch.assert_not_called()
    sqlite_session.refresh(records.document)
    assert records.document.indexing_status == IndexingStatus.ERROR


def test_retry_translates_application_access_denial(
    client: FlaskClient, records: RetryRecords, dispatch: Mock, sqlite_session: Session
) -> None:
    with patch.object(
        DatasetDocumentApplicationService, "retry_failed_documents", side_effect=DatasetAccessDeniedError()
    ):
        response = client.post(records.path, headers=records.headers, json={"document_ids": [records.document.id]})

    assert response.status_code == 403
    assert response.json is not None
    assert response.json["code"] == "forbidden"
    assert response.json["message"] == "You do not have permission to access this dataset"
    dispatch.assert_not_called()
    sqlite_session.refresh(records.document)
    assert records.document.indexing_status == IndexingStatus.ERROR


def test_retry_applies_knowledge_rate_limit(client: FlaskClient, records: RetryRecords, dispatch: Mock) -> None:
    with (
        patch(
            "controllers.service_api.wraps.FeatureService.get_knowledge_rate_limit",
            return_value=KnowledgeRateLimitModel(enabled=True, limit=1),
        ),
        patch("controllers.service_api.wraps.redis_client.zcard", return_value=2),
    ):
        response = client.post(records.path, headers=records.headers, json={"document_ids": [records.document.id]})
    assert response.status_code == 403
    dispatch.assert_not_called()
    with client.application.app_context():
        assert db.session.scalar(select(RateLimitLog).where(RateLimitLog.tenant_id == records.dataset.tenant_id))
