import datetime
import json
from inspect import unwrap
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, NotFound

import services
from controllers.console import console_ns
from controllers.console.datasets.datasets_document import (
    DatasetDocumentListApi,
    DatasetInitApi,
    DocumentApi,
    DocumentBatchDownloadZipApi,
    DocumentBatchIndexingEstimateApi,
    DocumentBatchIndexingStatusApi,
    DocumentDownloadApi,
    DocumentGenerateSummaryApi,
    DocumentIndexingEstimateApi,
    DocumentIndexingStatusApi,
    DocumentMetadataApi,
    DocumentMetadataUpdatePayload,
    DocumentPauseApi,
    DocumentPipelineExecutionLogApi,
    DocumentProcessingApi,
    DocumentRecoverApi,
    DocumentRenameApi,
    DocumentRenamePayload,
    DocumentResource,
    DocumentRetryApi,
    DocumentRetryPayload,
    DocumentStatusApi,
    DocumentSummaryStatusApi,
    GenerateSummaryPayload,
    GetProcessRuleApi,
    WebsiteDocumentSyncApi,
)
from controllers.console.datasets.error import (
    DocumentAlreadyFinishedError,
    DocumentIndexingError,
    IndexingEstimateError,
    InvalidActionError,
    InvalidMetadataError,
)
from core.entities.knowledge_entities import IndexingEstimate
from core.rag.index_processor.constant.index_type import IndexStructureType
from extensions.storage.storage_type import StorageType
from models.account import Account, TenantAccountRole
from models.dataset import (
    Dataset,
    DatasetPermissionEnum,
    DatasetProcessRule,
    DocumentPipelineExecutionLog,
    DocumentSegment,
)
from models.dataset import Document as DatasetDocument
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom, IndexingStatus
from models.model import UploadFile
from services.dataset_ref_service import DatasetRef, DocumentRef
from services.enterprise.rbac_service import RBACResourceWhitelistScope, ReplaceMemberBindings
from services.vector_space_admission_service import (
    VECTOR_SPACE_ADMISSION_ERROR_CODE,
    format_vector_space_admission_error,
)


def make_serializable_document(**overrides):
    return make_document(data_source_info=json.dumps({"upload_file_id": "file-1"}), **overrides)


def make_document_detail(**overrides):
    doc_metadata_details = overrides.pop("doc_metadata_details", [])
    return make_document(
        data_source_info=json.dumps({"upload_file_id": "file-1"}),
        created_at=datetime.datetime(2024, 1, 1, tzinfo=datetime.UTC),
        tokens=10,
        doc_type="others",
        doc_metadata=doc_metadata_details,
        doc_language="English",
        **overrides,
    )


def make_dataset(**overrides):
    attrs = {
        "id": "ds-1",
        "tenant_id": "tenant-1",
        "name": "Dataset",
        "indexing_technique": "economy",
        "chunk_structure": IndexStructureType.PARAGRAPH_INDEX,
        "created_by": "u1",
        "summary_index_setting": {"enable": True},
    }
    attrs.update(overrides)
    return Dataset(**attrs)


def make_document(**overrides):
    attrs = {
        "id": "doc-1",
        "tenant_id": "tenant-1",
        "dataset_id": "ds-1",
        "position": 1,
        "data_source_type": DataSourceType.UPLOAD_FILE,
        "data_source_info": None,
        "batch": "batch-1",
        "name": "Document",
        "created_from": DocumentCreatedFrom.WEB,
        "created_by": "u1",
        "indexing_status": IndexingStatus.COMPLETED,
        "enabled": True,
        "archived": False,
        "doc_metadata": None,
        "doc_form": IndexStructureType.PARAGRAPH_INDEX,
        "need_summary": False,
    }
    attrs.update(overrides)
    return DatasetDocument(**attrs)


def make_account(role: TenantAccountRole = TenantAccountRole.EDITOR) -> Account:
    account = Account(name="Test User", email="test@example.com")
    account.id = "u1"
    account.role = role
    return account


def make_segment(*, position: int, completed: bool = True) -> DocumentSegment:
    return DocumentSegment(
        tenant_id="tenant-1",
        dataset_id="ds-1",
        document_id="doc-1",
        position=position,
        content=f"segment {position}",
        word_count=2,
        tokens=2,
        created_by="u1",
        completed_at=datetime.datetime(2024, 1, 1, tzinfo=datetime.UTC) if completed else None,
    )


def make_upload_file() -> UploadFile:
    upload_file = UploadFile(
        tenant_id="tenant-1",
        storage_type=StorageType.LOCAL,
        key="document.txt",
        name="document.txt",
        size=10,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="u1",
        created_at=datetime.datetime(2024, 1, 1, tzinfo=datetime.UTC),
        used=False,
    )
    upload_file.id = "file-1"
    return upload_file


@pytest.fixture
def tenant_ctx():
    account = Account(name="Test User", email="test@example.com")
    account.id = "u1"
    account.role = TenantAccountRole.EDITOR
    return (account, "tenant-1")


@pytest.fixture(autouse=True)
def bypass_knowledge_rate_limit():
    with patch("controllers.console.datasets.datasets_document.check_knowledge_rate_limit") as check:
        yield check


@pytest.fixture
def patch_tenant(tenant_ctx):
    return tenant_ctx


@pytest.fixture
def dataset():
    return make_dataset()


@pytest.fixture
def document():
    return make_document(
        indexing_status=IndexingStatus.INDEXING,
        is_paused=False,
        data_source_info=json.dumps({"upload_file_id": "file-1"}),
    )


@pytest.fixture
def patch_dataset(dataset):
    with patch("controllers.console.datasets.datasets_document.DatasetService.get_dataset", return_value=dataset):
        yield


@pytest.fixture
def patch_scoped_dataset(dataset):
    with patch(
        "controllers.console.datasets.datasets_document.DatasetService.get_dataset_for_tenant", return_value=dataset
    ):
        yield


@pytest.fixture
def patch_permission():
    with patch(
        "controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission", return_value=None
    ):
        yield


class _UsesSQLiteSession:
    session: Session

    @pytest.fixture(autouse=True)
    def _inject_sqlite_session(self, sqlite_session: Session) -> None:
        self.session = sqlite_session


class TestGetProcessRuleApi(_UsesSQLiteSession):
    def test_get_default_success(self, app: Flask, patch_tenant):
        api = GetProcessRuleApi()
        method = unwrap(api.get)
        user, _ = patch_tenant
        with app.test_request_context("/"):
            response = method(api, self.session, user)
        assert "rules" in response

    def test_get_with_document_preserves_legacy_segmentation_delimiter(self, app: Flask, patch_tenant):
        api = GetProcessRuleApi()
        method = unwrap(api.get)
        user, _ = patch_tenant

        document = make_document()
        session = self.session
        dataset = make_dataset()
        process_rule = DatasetProcessRule(
            dataset_id="ds-1",
            mode="custom",
            rules=json.dumps({"segmentation": {"delimiter": "---", "max_tokens": 123}}),
            created_by="u1",
        )
        session.add(process_rule)
        session.flush()

        with (
            app.test_request_context("/?document_id=doc-1"),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.get_document_by_id",
                return_value=document,
            ) as mock_get_document,
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission",
                return_value=None,
            ),
        ):
            response = method(api, session, user)

        mock_get_document.assert_called_once_with("doc-1", session)
        assert response["rules"]["segmentation"]["separator"] == "---"
        assert response["rules"]["segmentation"]["max_tokens"] == 123
        assert "delimiter" not in response["rules"]["segmentation"]

    def test_get_with_document_preserves_null_rules(self, app: Flask, patch_tenant):
        api = GetProcessRuleApi()
        method = unwrap(api.get)
        user, _ = patch_tenant
        session = self.session
        dataset = make_dataset()
        process_rule = DatasetProcessRule(dataset_id="ds-1", mode="custom", rules=None, created_by="u1")
        session.add(process_rule)
        session.flush()
        with (
            app.test_request_context("/?document_id=doc-1"),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.get_document_by_id",
                return_value=make_document(),
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission",
                return_value=None,
            ),
        ):
            response = method(api, session, user)

        assert response["mode"] == "custom"
        assert response["rules"] is None

    def test_get_with_document_dataset_not_found(self, app: Flask, patch_tenant):
        api = GetProcessRuleApi()
        method = unwrap(api.get)
        user, _ = patch_tenant
        document = make_document()
        session = self.session
        with (
            app.test_request_context("/?document_id=doc-1"),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.get_document_by_id",
                return_value=document,
            ),
            patch("controllers.console.datasets.datasets_document.DatasetService.get_dataset", return_value=None),
        ):
            with pytest.raises(NotFound):
                method(api, session, user)


class TestDatasetDocumentListApi(_UsesSQLiteSession):
    def test_get_with_fetch_true_counts_segments(self, app: Flask, patch_tenant, patch_dataset, patch_permission):
        api = DatasetDocumentListApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        doc = make_serializable_document()
        pagination = MagicMock(items=[doc], total=1)
        session = self.session
        session.add_all([make_segment(position=1), make_segment(position=2)])
        session.flush()
        with (
            app.test_request_context("/?fetch=true"),
            patch("controllers.console.datasets.datasets_document.paginate_query", return_value=pagination),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.enrich_documents_with_summary_index_status",
                return_value=None,
            ),
        ):
            resp = method(api, session, tenant_id, user, "ds-1")
        assert resp["data"][0]["id"] == "doc-1"
        assert resp["data"][0]["completed_segments"] == 2
        assert resp["data"][0]["total_segments"] == 2

    def test_get_with_search_status_and_created_at_sort(
        self, app: Flask, patch_tenant, patch_dataset, patch_permission
    ):
        api = DatasetDocumentListApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        pagination = MagicMock(items=[make_serializable_document()], total=1)
        with (
            app.test_request_context("/?keyword=test&status=enabled&sort=created_at"),
            patch("controllers.console.datasets.datasets_document.paginate_query", return_value=pagination),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.apply_display_status_filter",
                side_effect=lambda q, s: q,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.enrich_documents_with_summary_index_status",
                return_value=None,
            ),
        ):
            resp = method(api, self.session, tenant_id, user, "ds-1")
        assert resp["total"] == 1

    def test_get_success(self, app: Flask, patch_tenant, patch_dataset, patch_permission):
        api = DatasetDocumentListApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        document = make_serializable_document()
        pagination = MagicMock(items=[document], total=1)
        session = self.session
        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.datasets_document.paginate_query", return_value=pagination),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.enrich_documents_with_summary_index_status",
                return_value=None,
            ),
        ):
            response = method(api, session, tenant_id, user, "ds-1")
        assert response["total"] == 1
        assert response["data"][0]["id"] == "doc-1"
        assert "completed_segments" not in response["data"][0]
        assert "total_segments" not in response["data"][0]
        assert response["data"][0]["data_source_info"] == {"upload_file_id": "file-1"}
        assert response["data"][0]["doc_metadata"] == []

    def test_post_success(self, app: Flask, patch_tenant, patch_dataset, patch_permission):
        api = DatasetDocumentListApi()
        method = unwrap(api.post)
        user, _ = patch_tenant
        payload = {"indexing_technique": "economy"}
        created_dataset = make_dataset()
        created_document = make_document()
        session = self.session
        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=created_dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.document_create_args_validate",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.save_document_with_dataset_id",
                return_value=([created_document], "batch-1"),
            ),
        ):
            response = method(api, session, user, "ds-1")
        assert "documents" in response
        assert response["dataset"]["id"] == "ds-1"
        assert response["documents"][0]["id"] == "doc-1"
        assert response["documents"][0]["data_source_info"] == {}
        assert response["documents"][0]["doc_metadata"] == []
        assert "data_source_info_dict" not in response["documents"][0]
        assert "doc_metadata_details" not in response["documents"][0]

    def test_post_forbidden(self, app: Flask):
        api = DatasetDocumentListApi()
        method = unwrap(api.post)
        user = make_account(TenantAccountRole.NORMAL)
        with (
            app.test_request_context("/", json={}),
            patch.object(type(console_ns), "payload", {}),
            patch("controllers.console.datasets.datasets_document.DatasetService.get_dataset", return_value=dataset),
        ):
            with pytest.raises(Forbidden):
                method(api, self.session, user, "ds-1")

    def test_get_with_fetch_true_and_invalid_fetch(self, app: Flask, patch_tenant, patch_dataset, patch_permission):
        api = DatasetDocumentListApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        pagination = MagicMock(items=[make_serializable_document()], total=1)
        with (
            app.test_request_context("/?fetch=maybe"),
            patch("controllers.console.datasets.datasets_document.paginate_query", return_value=pagination),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.enrich_documents_with_summary_index_status",
                return_value=None,
            ),
        ):
            response = method(api, self.session, tenant_id, user, "ds-1")
        assert response["total"] == 1

    def test_get_sort_hit_count(self, app: Flask, patch_tenant, patch_dataset, patch_permission):
        api = DatasetDocumentListApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        pagination = MagicMock(items=[], total=0)
        with (
            app.test_request_context("/?sort=hit_count"),
            patch("controllers.console.datasets.datasets_document.paginate_query", return_value=pagination),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.enrich_documents_with_summary_index_status",
                return_value=None,
            ),
        ):
            response = method(api, self.session, tenant_id, user, "ds-1")
        assert response["total"] == 0


class TestDatasetInitApi(_UsesSQLiteSession):
    def test_post_success_serializes_created_dataset_and_documents(self, app: Flask, patch_tenant):
        api = DatasetInitApi()
        method = unwrap(api.post)
        user, tenant_id = patch_tenant
        payload = {"indexing_technique": "economy"}
        created_dataset = make_dataset()
        created_document = make_document(id="doc-init")
        session = self.session
        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch("controllers.console.datasets.datasets_document.dify_config.RBAC_ENABLED", True),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.document_create_args_validate",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.save_document_without_dataset_id",
                return_value=(created_dataset, [created_document], "batch-init"),
            ),
            patch(
                "controllers.console.datasets.datasets_document.enterprise_rbac_service.RBACService.DatasetAccess.replace_whitelist"
            ) as replace_whitelist,
            patch(
                "controllers.console.datasets.datasets_document.initialize_created_app_rbac_access_task"
            ) as initialize_rbac_task,
        ):
            response = method(api, session, tenant_id, user)
        assert response["dataset"]["id"] == "ds-1"
        assert response["documents"][0]["id"] == "doc-init"
        assert response["documents"][0]["data_source_info"] == {}
        assert response["documents"][0]["doc_metadata"] == []
        assert response["batch"] == "batch-init"
        assert created_dataset.permission == DatasetPermissionEnum.ALL_TEAM
        replace_whitelist.assert_called_once_with(
            tenant_id,
            user.id,
            created_dataset.id,
            ReplaceMemberBindings(scope=RBACResourceWhitelistScope.ALL),
        )
        initialize_rbac_task.delay.assert_called_once_with(tenant_id, user.id, dataset_id=created_dataset.id)


class TestDocumentResource(_UsesSQLiteSession):
    def test_get_document_resolves_owner_chain(self, dataset):
        api = DocumentResource()
        session = self.session
        user = make_account()
        document = make_document()

        with (
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset_for_tenant",
                return_value=dataset,
            ) as get_dataset,
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission"
            ) as check_permission,
            patch(
                "controllers.console.datasets.datasets_document.DatasetRefService.get_document_by_ref",
                return_value=document,
            ) as get_document,
        ):
            assert api.get_document(session, "ds-1", "doc-1", user, "tenant-1") is document

        get_dataset.assert_called_once_with("ds-1", "tenant-1", session=session)
        check_permission.assert_called_once_with(dataset, user, session)
        get_document.assert_called_once_with(
            DocumentRef(dataset=DatasetRef(tenant_id="tenant-1", dataset_id="ds-1"), document_id="doc-1"),
            session=session,
        )

    def test_get_document_relies_on_rbac_in_rbac_mode(self, dataset):
        api = DocumentResource()
        session = self.session
        with (
            patch("controllers.console.datasets.datasets_document.dify_config.RBAC_ENABLED", True),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset_for_tenant",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission"
            ) as check_permission,
            patch(
                "controllers.console.datasets.datasets_document.DatasetRefService.get_document_by_ref",
                return_value=make_document(),
            ),
        ):
            api.get_document(session, "ds-1", "doc-1", make_account(), "tenant-1")

        check_permission.assert_not_called()


class TestDocumentApi(_UsesSQLiteSession):
    def test_get_success(self, app: Flask, patch_tenant):
        api = DocumentApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        document = make_document_detail()
        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=document),
            patch("controllers.console.datasets.datasets_document.DatasetService.get_process_rules", return_value={}),
        ):
            response, status = method(api, self.session, tenant_id, user, "ds-1", "doc-1")
        assert status == 200

    def test_get_invalid_metadata(self, app: Flask, patch_tenant):
        api = DocumentApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        with (
            app.test_request_context("/?metadata=wrong"),
            patch.object(api, "get_document", return_value=make_document()),
        ):
            with pytest.raises(InvalidMetadataError):
                method(api, self.session, tenant_id, user, "ds-1", "doc-1")

    def test_delete_success(self, app: Flask, patch_tenant, patch_dataset):
        api = DocumentApi()
        method = unwrap(api.delete)
        user, tenant_id = patch_tenant
        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_model_setting",
                return_value=None,
            ),
            patch.object(api, "get_document", return_value=make_document()),
            patch("controllers.console.datasets.datasets_document.DocumentService.delete_document", return_value=None),
        ):
            response, status = method(api, self.session, tenant_id, user, "ds-1", "doc-1")
        assert status == 204

    def test_delete_indexing_error(self, app: Flask, patch_tenant, patch_dataset):
        api = DocumentApi()
        method = unwrap(api.delete)
        user, tenant_id = patch_tenant
        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_model_setting",
                return_value=None,
            ),
            patch.object(api, "get_document", return_value=make_document()),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.delete_document",
                side_effect=services.errors.document.DocumentIndexingError(),
            ),
        ):
            with pytest.raises(DocumentIndexingError):
                method(api, self.session, tenant_id, user, "ds-1", "doc-1")


class TestDocumentDownloadApi(_UsesSQLiteSession):
    def test_download_success(self, app: Flask, patch_tenant):
        api = DocumentDownloadApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        document = make_document()
        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.get_document_download_url",
                return_value="url",
            ),
        ):
            response = method(api, self.session, tenant_id, user, "ds-1", "doc-1")
        assert response["url"] == "url"


class TestDocumentProcessingApi(_UsesSQLiteSession):
    def test_processing_forbidden_when_not_editor(self, app: Flask):
        api = DocumentProcessingApi()
        method = unwrap(api.patch)
        user = make_account(TenantAccountRole.NORMAL)
        with app.test_request_context("/"), patch.object(api, "get_document", return_value=make_document()):
            with pytest.raises(Forbidden):
                method(api, self.session, "tenant-1", user, "ds-1", "doc-1", "pause")

    def test_resume_from_error_state(self, app: Flask, patch_tenant):
        api = DocumentProcessingApi()
        method = unwrap(api.patch)
        user, tenant_id = patch_tenant
        doc = make_document(indexing_status=IndexingStatus.ERROR, is_paused=True)
        session = self.session
        with app.test_request_context("/"), patch.object(api, "get_document", return_value=doc):
            _, status = method(api, session, tenant_id, user, "ds-1", "doc-1", "resume")
        assert status == 200

    def test_resume_success(self, app: Flask, patch_tenant):
        api = DocumentProcessingApi()
        method = unwrap(api.patch)
        user, tenant_id = patch_tenant
        document = make_document(indexing_status=IndexingStatus.PAUSED, is_paused=True)
        session = self.session
        with app.test_request_context("/"), patch.object(api, "get_document", return_value=document):
            response, status = method(api, session, tenant_id, user, "ds-1", "doc-1", "resume")
        assert status == 200

    def test_pause_success(self, app: Flask, patch_tenant):
        api = DocumentProcessingApi()
        method = unwrap(api.patch)
        user, tenant_id = patch_tenant
        document = make_document(indexing_status=IndexingStatus.INDEXING)
        session = self.session
        with app.test_request_context("/"), patch.object(api, "get_document", return_value=document):
            response, status = method(api, session, tenant_id, user, "ds-1", "doc-1", "pause")
        assert status == 200

    def test_pause_invalid(self, app: Flask, patch_tenant):
        api = DocumentProcessingApi()
        method = unwrap(api.patch)
        user, tenant_id = patch_tenant
        document = make_document(indexing_status=IndexingStatus.COMPLETED)
        with app.test_request_context("/"), patch.object(api, "get_document", return_value=document):
            with pytest.raises(InvalidActionError):
                method(api, self.session, tenant_id, user, "ds-1", "doc-1", "pause")


class TestDocumentMetadataApi(_UsesSQLiteSession):
    def test_put_metadata_schema_filtering(self, app: Flask, patch_tenant):
        api = DocumentMetadataApi()
        method = unwrap(api.put)
        user, tenant_id = patch_tenant
        doc = make_document()
        payload = {"doc_type": "invoice", "doc_metadata": {"amount": 10, "invalid": "x"}}
        schema = {"amount": int}
        session = self.session
        req_data = DocumentMetadataUpdatePayload.model_validate(payload)
        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=doc),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.DOCUMENT_METADATA_SCHEMA",
                {"invoice": schema},
            ),
        ):
            method(api, req_data, session, tenant_id, user, "ds-1", "doc-1")
        assert doc.doc_metadata == {"amount": 10}

    def test_put_success(self, app: Flask, patch_tenant):
        api = DocumentMetadataApi()
        method = unwrap(api.put)
        user, tenant_id = patch_tenant
        document = make_document()
        payload = {"doc_type": "others", "doc_metadata": {"a": 1}}
        session = self.session
        req_data = DocumentMetadataUpdatePayload.model_validate(payload)
        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.DOCUMENT_METADATA_SCHEMA",
                {"others": {}},
            ),
        ):
            response, status = method(api, req_data, session, tenant_id, user, "ds-1", "doc-1")
        assert status == 200

    def test_put_invalid_payload(self, app: Flask, patch_tenant):
        api = DocumentMetadataApi()
        method = unwrap(api.put)
        user, tenant_id = patch_tenant
        req_data = DocumentMetadataUpdatePayload.model_validate({})
        with app.test_request_context("/"), patch.object(api, "get_document", return_value=make_document()):
            with pytest.raises(ValueError):
                method(api, req_data, self.session, tenant_id, user, "ds-1", "doc-1")

    def test_put_invalid_doc_type(self, app: Flask, patch_tenant):
        api = DocumentMetadataApi()
        method = unwrap(api.put)
        user, tenant_id = patch_tenant
        payload = {"doc_type": "invalid", "doc_metadata": {}}
        req_data = DocumentMetadataUpdatePayload.model_validate(payload)
        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=make_document()),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.DOCUMENT_METADATA_SCHEMA",
                {"others": {}},
            ),
        ):
            with pytest.raises(ValueError):
                method(api, req_data, self.session, tenant_id, user, "ds-1", "doc-1")


class TestDocumentStatusApi(_UsesSQLiteSession):
    def test_patch_success(self, app: Flask, patch_tenant, patch_dataset):
        api = DocumentStatusApi()
        method = unwrap(api.patch)
        user, _ = patch_tenant
        with (
            app.test_request_context("/?document_id=doc-1"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_model_setting",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.batch_update_document_status",
                return_value=None,
            ),
        ):
            response, status = method(api, self.session, user, "ds-1", "enable")
        assert status == 200

    def test_patch_invalid_action(self, app: Flask, patch_tenant, patch_dataset):
        api = DocumentStatusApi()
        method = unwrap(api.patch)
        user, _ = patch_tenant
        with (
            app.test_request_context("/?document_id=doc-1"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_model_setting",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.batch_update_document_status",
                side_effect=ValueError("x"),
            ),
        ):
            with pytest.raises(InvalidActionError):
                method(api, self.session, user, "ds-1", "enable")


class TestDocumentRetryApi(_UsesSQLiteSession):
    def test_retry_archived_document_skipped(self, app: Flask, patch_tenant, patch_scoped_dataset, patch_permission):
        api = DocumentRetryApi()
        method = unwrap(api.post)
        user, tenant_id = patch_tenant
        payload = {"document_ids": ["doc-1"]}
        req_data = DocumentRetryPayload.model_validate(payload)
        doc = make_document(indexing_status=IndexingStatus.INDEXING)
        session = self.session
        session.add(doc)
        session.flush()
        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.datasets_document.DocumentService.check_archived", return_value=True),
            patch("controllers.console.datasets.datasets_document.DocumentService.retry_document") as retry_mock,
        ):
            resp, status = method(api, req_data, session, tenant_id, user, "ds-1")
        assert status == 204
        retry_mock.assert_called_once_with("ds-1", [], session)

    def test_retry_success(self, app: Flask, patch_tenant, patch_scoped_dataset, patch_permission):
        api = DocumentRetryApi()
        method = unwrap(api.post)
        user, tenant_id = patch_tenant
        payload = {"document_ids": ["doc-1"]}
        req_data = DocumentRetryPayload.model_validate(payload)
        document = make_document(indexing_status=IndexingStatus.INDEXING)
        session = self.session
        session.add(document)
        session.flush()
        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.datasets_document.DocumentService.check_archived", return_value=False),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.retry_document", return_value=None
            ) as retry_mock,
        ):
            response, status = method(api, req_data, session, tenant_id, user, "ds-1")
        assert status == 204
        retry_mock.assert_called_once_with("ds-1", [document], session)

    def test_retry_loads_selected_documents_in_one_scoped_query(
        self, app: Flask, patch_tenant, patch_scoped_dataset, patch_permission
    ):
        api = DocumentRetryApi()
        method = unwrap(api.post)
        user, tenant_id = patch_tenant
        payload = {"document_ids": ["doc-1", "doc-2"]}
        req_data = DocumentRetryPayload.model_validate(payload)
        first_document = make_document(id="doc-1", indexing_status=IndexingStatus.ERROR)
        second_document = make_document(id="doc-2", position=2, indexing_status=IndexingStatus.ERROR)
        decoy = make_document(id="doc-decoy", tenant_id="other-tenant", dataset_id="other-dataset")
        session = self.session
        session.add_all([first_document, second_document, decoy])
        session.flush()

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.datasets_document.DocumentService.check_archived", return_value=False),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.retry_document", return_value=None
            ) as retry_mock,
        ):
            response, status = method(api, req_data, session, tenant_id, user, "ds-1")

        assert status == 204
        retry_mock.assert_called_once_with("ds-1", [first_document, second_document], session)

    def test_retry_skips_completed_document(self, app: Flask, patch_tenant, patch_scoped_dataset, patch_permission):
        api = DocumentRetryApi()
        method = unwrap(api.post)
        user, tenant_id = patch_tenant
        payload = {"document_ids": ["doc-1"]}
        req_data = DocumentRetryPayload.model_validate(payload)
        document = make_document(indexing_status=IndexingStatus.COMPLETED)
        session = self.session
        session.add(document)
        session.flush()
        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.retry_document", return_value=None
            ) as retry_mock,
        ):
            response, status = method(api, req_data, session, tenant_id, user, "ds-1")
        assert status == 204
        retry_mock.assert_called_once_with("ds-1", [], session)

    def test_retry_foreign_dataset_has_no_side_effects(self, app: Flask, patch_tenant, bypass_knowledge_rate_limit):
        api = DocumentRetryApi()
        method = unwrap(api.post)
        user, tenant_id = patch_tenant
        session = self.session
        payload = {"document_ids": ["doc-1"]}
        req_data = DocumentRetryPayload.model_validate(payload)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset_for_tenant",
                return_value=None,
            ),
            patch("controllers.console.datasets.datasets_document.DocumentService.retry_document") as retry_document,
        ):
            with pytest.raises(NotFound):
                method(api, req_data, session, tenant_id, user, "foreign-dataset")

        bypass_knowledge_rate_limit.assert_not_called()
        retry_document.assert_not_called()


class TestDocumentPauseRecoverApi(_UsesSQLiteSession):
    @pytest.mark.parametrize(
        ("api_type", "service_method"),
        [(DocumentPauseApi, "pause_document"), (DocumentRecoverApi, "recover_document")],
    )
    def test_patch_uses_scoped_document(
        self, app: Flask, patch_tenant, bypass_knowledge_rate_limit, api_type, service_method
    ):
        api = api_type()
        method = unwrap(api.patch)
        user, tenant_id = patch_tenant
        session = self.session
        document = make_document()

        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=document) as get_document,
            patch("controllers.console.datasets.datasets_document.DocumentService.check_archived", return_value=False),
            patch(
                f"controllers.console.datasets.datasets_document.DocumentService.{service_method}"
            ) as process_document,
        ):
            response, status = method(api, session, tenant_id, user, "ds-1", "doc-1")

        assert (response, status) == ("", 204)
        get_document.assert_called_once_with(session, "ds-1", "doc-1", user, tenant_id)
        bypass_knowledge_rate_limit.assert_called_once_with()
        process_document.assert_called_once_with(document, session)


class TestWebsiteDocumentSyncApi(_UsesSQLiteSession):
    def test_get_uses_scoped_dataset_and_document(self, app: Flask, patch_tenant, dataset):
        api = WebsiteDocumentSyncApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        session = self.session
        document = make_document(data_source_type=DataSourceType.WEBSITE_CRAWL)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset_for_tenant",
                return_value=dataset,
            ) as get_dataset,
            patch.object(api, "get_document", return_value=document) as get_document,
            patch("controllers.console.datasets.datasets_document.DocumentService.check_archived", return_value=False),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.sync_website_document"
            ) as sync_document,
        ):
            response, status = method(api, session, tenant_id, user, "ds-1", "doc-1")

        assert status == 200
        assert response["result"] == "success"
        get_dataset.assert_called_once_with("ds-1", tenant_id, session=session)
        get_document.assert_called_once_with(session, dataset.id, "doc-1", user, tenant_id)
        sync_document.assert_called_once_with(dataset, document, session)

    def test_get_rejects_non_editor_before_loading_document(self, app: Flask, dataset):
        api = WebsiteDocumentSyncApi()
        method = unwrap(api.get)
        user = make_account(TenantAccountRole.NORMAL)
        session = self.session

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset_for_tenant",
                return_value=dataset,
            ),
            patch.object(api, "get_document") as get_document,
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.sync_website_document"
            ) as sync_document,
        ):
            with pytest.raises(Forbidden):
                method(api, session, "tenant-1", user, "ds-1", "doc-1")

        get_document.assert_not_called()
        sync_document.assert_not_called()


class TestDocumentPipelineExecutionLogApi(_UsesSQLiteSession):
    def test_get_log_success(self, app: Flask, patch_tenant):
        api = DocumentPipelineExecutionLogApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        log = DocumentPipelineExecutionLog(
            pipeline_id="pipeline-1",
            document_id="trusted-doc",
            datasource_type="file",
            datasource_info="{}",
            datasource_node_id="n1",
            input_data={},
            created_by="u1",
        )
        document = make_document(id="trusted-doc")
        session = self.session
        session.add(log)
        session.flush()
        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=document) as get_document,
        ):
            response, status = method(api, session, tenant_id, user, "ds-1", "doc-1")
        assert status == 200
        get_document.assert_called_once_with(session, "ds-1", "doc-1", user, tenant_id)
        assert response["datasource_node_id"] == "n1"


class TestDocumentGenerateSummaryApi(_UsesSQLiteSession):
    def test_generate_summary_missing_documents(self, app: Flask, patch_tenant, patch_permission):
        api = DocumentGenerateSummaryApi()
        method = unwrap(api.post)
        user, _ = patch_tenant
        dataset = make_dataset(indexing_technique="high_quality", summary_index_setting={"enable": True})
        payload = {"document_list": ["doc-1", "doc-2"]}
        req_data = GenerateSummaryPayload.model_validate(payload)
        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.datasets_document.DatasetService.get_dataset", return_value=dataset),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.get_documents_by_ids",
                return_value=[make_document(id="doc-1")],
            ),
        ):
            with pytest.raises(NotFound):
                method(api, self.session, user, "ds-1")
                method(api, req_data, self.session, user, "ds-1")

    def test_generate_not_enabled(self, app: Flask, patch_tenant, patch_permission):
        api = DocumentGenerateSummaryApi()
        method = unwrap(api.post)
        user, _ = patch_tenant
        dataset = make_dataset(indexing_technique="high_quality", summary_index_setting={"enable": False})
        payload = {"document_list": ["doc-1"]}
        req_data = GenerateSummaryPayload.model_validate(payload)
        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.datasets_document.DatasetService.get_dataset", return_value=dataset),
        ):
            with pytest.raises(ValueError):
                method(api, self.session, user, "ds-1")
                method(api, req_data, self.session, user, "ds-1")

    def test_generate_summary_success_with_qa_skip(self, app: Flask, patch_tenant, patch_permission):
        api = DocumentGenerateSummaryApi()
        method = unwrap(api.post)
        user, _ = patch_tenant
        dataset = make_dataset(indexing_technique="high_quality", summary_index_setting={"enable": True})
        doc1 = make_document(id="doc-1", doc_form=IndexStructureType.QA_INDEX)
        doc2 = make_document(id="doc-2", position=2, doc_form=IndexStructureType.PARAGRAPH_INDEX)
        payload = {"document_list": ["doc-1", "doc-2"]}
        req_data = GenerateSummaryPayload.model_validate(payload)
        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.datasets_document.DatasetService.get_dataset", return_value=dataset),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.get_documents_by_ids",
                return_value=[doc1, doc2],
            ),
            patch(
                "controllers.console.datasets.datasets_document.generate_summary_index_task.delay", return_value=None
            ),
        ):
            response, status = method(api, req_data, self.session, user, "ds-1")
        assert status == 200


class TestDocumentSummaryStatusApi(_UsesSQLiteSession):
    def test_get_success(self, app: Flask, patch_tenant, patch_permission):
        api = DocumentSummaryStatusApi()
        method = unwrap(api.get)
        user, _ = patch_tenant
        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=make_dataset(),
            ),
            patch(
                "services.summary_index_service.SummaryIndexService.get_document_summary_status_detail",
                return_value={
                    "total_segments": 1,
                    "summary_status": {"timeout": 1},
                    "summaries": [
                        {
                            "segment_id": "segment-1",
                            "segment_position": 1,
                            "status": "timeout",
                        }
                    ],
                },
            ),
        ):
            response, status = method(api, self.session, user, "ds-1", "doc-1")
        assert status == 200
        assert response["summary_status"]["timeout"] == 1
        assert response["summaries"][0]["status"] == "timeout"


class TestDocumentIndexingEstimateApi(_UsesSQLiteSession):
    def test_indexing_estimate_file_not_found(self, app: Flask, patch_tenant):
        api = DocumentIndexingEstimateApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        document = make_document(
            indexing_status=IndexingStatus.INDEXING,
            data_source_info=json.dumps({"upload_file_id": "file-1"}),
        )
        session = self.session
        with app.test_request_context("/"), patch.object(api, "get_document", return_value=document):
            with pytest.raises(NotFound):
                method(api, session, tenant_id, user, "ds-1", "doc-1")

    def test_indexing_estimate_generic_exception(self, app: Flask, patch_tenant):
        api = DocumentIndexingEstimateApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        document = make_document(
            indexing_status=IndexingStatus.INDEXING,
            data_source_info=json.dumps({"upload_file_id": "file-1"}),
        )
        upload_file = make_upload_file()
        mock_indexing_runner = MagicMock()
        mock_indexing_runner.indexing_estimate.side_effect = RuntimeError("Some indexing error")
        session = self.session
        session.add(upload_file)
        session.flush()
        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=document),
            patch("controllers.console.datasets.datasets_document.ExtractSetting", return_value=MagicMock()),
            patch("controllers.console.datasets.datasets_document.IndexingRunner", return_value=mock_indexing_runner),
        ):
            with pytest.raises(IndexingEstimateError):
                method(api, session, tenant_id, user, "ds-1", "doc-1")

    def test_get_finished(self, app: Flask, patch_tenant):
        api = DocumentIndexingEstimateApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        document = make_document(indexing_status=IndexingStatus.COMPLETED)
        with app.test_request_context("/"), patch.object(api, "get_document", return_value=document):
            with pytest.raises(DocumentAlreadyFinishedError):
                method(api, self.session, tenant_id, user, "ds-1", "doc-1")


class TestDocumentBatchDownloadZipApi(_UsesSQLiteSession):
    def test_post_no_documents(self, app: Flask, patch_tenant):
        api = DocumentBatchDownloadZipApi()
        method = unwrap(api.post)
        user, tenant_id = patch_tenant
        payload: dict[str, list[str]] = {"document_ids": []}
        with app.test_request_context("/", json=payload), patch.object(type(console_ns), "payload", payload):
            with pytest.raises(ValueError):
                method(api, self.session, tenant_id, user, "ds-1")


class TestDatasetDocumentListApiDelete(_UsesSQLiteSession):
    def test_delete_success(self, app: Flask, patch_tenant, patch_scoped_dataset, patch_permission):
        """Test successful deletion of documents"""
        api = DatasetDocumentListApi()
        method = unwrap(api.delete)
        user, tenant_id = patch_tenant
        session = self.session
        with (
            app.test_request_context("/?document_id=doc-1&document_id=doc-2"),
            patch("controllers.console.datasets.datasets_document.DocumentService.delete_documents", return_value=None),
        ):
            response, status = method(api, session, tenant_id, user, "ds-1")
        assert status == 204

    def test_delete_indexing_error(self, app: Flask, patch_tenant, patch_scoped_dataset, patch_permission):
        """Test deletion with indexing error"""
        api = DatasetDocumentListApi()
        method = unwrap(api.delete)
        user, tenant_id = patch_tenant
        with (
            app.test_request_context("/?document_id=doc-1"),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.delete_documents",
                side_effect=services.errors.document.DocumentIndexingError(),
            ),
        ):
            with pytest.raises(DocumentIndexingError):
                method(api, self.session, tenant_id, user, "ds-1")

    def test_delete_dataset_not_found(self, app: Flask, patch_tenant, bypass_knowledge_rate_limit):
        """Test deletion when dataset not found"""
        api = DatasetDocumentListApi()
        method = unwrap(api.delete)
        user, tenant_id = patch_tenant
        with (
            app.test_request_context("/?document_id=doc-1"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset_for_tenant",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.delete_documents"
            ) as delete_documents,
        ):
            with pytest.raises(NotFound):
                method(api, self.session, tenant_id, user, "foreign-dataset")

        bypass_knowledge_rate_limit.assert_not_called()
        delete_documents.assert_not_called()


class TestDocumentBatchIndexingEstimateApi(_UsesSQLiteSession):
    def test_batch_indexing_estimate_website(self, app: Flask, patch_tenant):
        api = DocumentBatchIndexingEstimateApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        doc = make_document(
            indexing_status=IndexingStatus.INDEXING,
            data_source_type=DataSourceType.WEBSITE_CRAWL,
            data_source_info=json.dumps(
                {
                    "provider": "firecrawl",
                    "job_id": "j1",
                    "url": "https://x.com",
                    "mode": "single",
                    "only_main_content": True,
                }
            ),
        )
        with (
            app.test_request_context("/"),
            patch.object(api, "get_batch_documents", return_value=[doc]),
            patch(
                "controllers.console.datasets.datasets_document.IndexingRunner.indexing_estimate",
                return_value=IndexingEstimate(total_segments=2, preview=[]),
            ),
        ):
            resp, status = method(api, self.session, tenant_id, user, "ds-1", "batch-1")
        assert status == 200

    def test_batch_indexing_estimate_notion(self, app: Flask, patch_tenant):
        api = DocumentBatchIndexingEstimateApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        doc = make_document(
            indexing_status=IndexingStatus.INDEXING,
            data_source_type=DataSourceType.NOTION_IMPORT,
            data_source_info=json.dumps(
                {
                    "credential_id": "c1",
                    "notion_workspace_id": "w1",
                    "notion_page_id": "p1",
                    "type": "page",
                }
            ),
        )
        with (
            app.test_request_context("/"),
            patch.object(api, "get_batch_documents", return_value=[doc]),
            patch(
                "controllers.console.datasets.datasets_document.IndexingRunner.indexing_estimate",
                return_value=IndexingEstimate(total_segments=1, preview=[]),
            ),
        ):
            resp, status = method(api, self.session, tenant_id, user, "ds-1", "batch-1")
        assert status == 200

    def test_batch_estimate_unsupported_datasource(self, app: Flask, patch_tenant):
        api = DocumentBatchIndexingEstimateApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        document = make_document(
            indexing_status=IndexingStatus.INDEXING,
            data_source_type="unknown",
            data_source_info="{}",
        )
        with app.test_request_context("/"), patch.object(api, "get_batch_documents", return_value=[document]):
            with pytest.raises(ValueError):
                method(api, self.session, tenant_id, user, "ds-1", "batch-1")

    def test_get_batch_estimate_invalid_batch(self, app: Flask, patch_tenant):
        """Test batch estimation with invalid batch"""
        api = DocumentBatchIndexingEstimateApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        with app.test_request_context("/"), patch.object(api, "get_batch_documents", side_effect=NotFound()):
            with pytest.raises(NotFound):
                method(api, self.session, tenant_id, user, "ds-1", "invalid-batch")


class TestDocumentBatchIndexingStatusApi(_UsesSQLiteSession):
    def test_get_batch_status_success_serializes_status_shape(self, app: Flask, patch_tenant):
        api = DocumentBatchIndexingStatusApi()
        method = unwrap(api.get)
        user, _ = patch_tenant
        error = format_vector_space_admission_error(61, 50)
        document = make_document(
            indexing_status=IndexingStatus.ERROR,
            is_paused=False,
            error=error,
        )
        session = self.session
        session.add_all([make_segment(position=1), make_segment(position=2), make_segment(position=3, completed=False)])
        session.flush()
        with app.test_request_context("/"), patch.object(api, "get_batch_documents", return_value=[document]):
            response = method(api, session, user, "ds-1", "batch-1")
        assert response == {
            "data": [
                {
                    "id": "doc-1",
                    "indexing_status": "error",
                    "processing_started_at": None,
                    "parsing_completed_at": None,
                    "cleaning_completed_at": None,
                    "splitting_completed_at": None,
                    "completed_at": None,
                    "paused_at": None,
                    "error": error,
                    "error_code": VECTOR_SPACE_ADMISSION_ERROR_CODE,
                    "estimated_vector_space_mb": 61,
                    "vector_space_limit_mb": 50,
                    "stopped_at": None,
                    "completed_segments": 2,
                    "total_segments": 3,
                }
            ]
        }

    def test_get_batch_status_invalid_batch(self, app: Flask, patch_tenant):
        """Test batch status with invalid batch"""
        api = DocumentBatchIndexingStatusApi()
        method = unwrap(api.get)
        user, _ = patch_tenant
        with app.test_request_context("/"), patch.object(api, "get_batch_documents", side_effect=NotFound()):
            with pytest.raises(NotFound):
                method(api, self.session, user, "ds-1", "invalid-batch")


class TestDocumentIndexingStatusApi(_UsesSQLiteSession):
    def test_get_status_success_serializes_status_shape(self, app: Flask, patch_tenant):
        api = DocumentIndexingStatusApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        document = make_document(
            indexing_status=IndexingStatus.INDEXING,
            is_paused=False,
        )
        session = self.session
        session.add_all([make_segment(position=position, completed=position == 1) for position in range(1, 5)])
        session.flush()
        with app.test_request_context("/"), patch.object(api, "get_document", return_value=document):
            response = method(api, session, tenant_id, user, "ds-1", "doc-1")
        assert response["id"] == "doc-1"
        assert response["indexing_status"] == "indexing"
        assert response["completed_segments"] == 1
        assert response["total_segments"] == 4

    def test_get_status_document_not_found(self, app: Flask, patch_tenant):
        """Test getting status for non-existent document"""
        api = DocumentIndexingStatusApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        with app.test_request_context("/"), patch.object(api, "get_document", side_effect=NotFound()):
            with pytest.raises(NotFound):
                method(api, self.session, tenant_id, user, "ds-1", "invalid-doc")


class TestDocumentRenameApi(_UsesSQLiteSession):
    def test_post_success_serializes_document_shape(self, app: Flask, patch_tenant):
        api = DocumentRenameApi()
        method = unwrap(api.post)
        user, _ = patch_tenant
        payload = {"name": "Renamed Document"}
        req_data = DocumentRenamePayload.model_validate(payload)
        renamed_document = make_document(id="doc-renamed", name="Renamed Document")
        session = self.session
        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset", return_value=make_dataset()
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_operator_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.rename_document",
                return_value=renamed_document,
            ),
        ):
            response = method(api, req_data, session, user, "ds-1", "doc-1")
        assert response["id"] == "doc-renamed"
        assert response["name"] == "Renamed Document"
        assert response["data_source_info"] == {}
        assert response["doc_metadata"] == []
        assert "data_source_info_dict" not in response


class TestDocumentApiMetadata(_UsesSQLiteSession):
    def test_get_with_only_option(self, app: Flask, patch_tenant):
        """Test get with 'only' metadata option"""
        api = DocumentApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        document = make_document_detail(doc_metadata_details=[])
        with (
            app.test_request_context("/?metadata=only"),
            patch.object(api, "get_document", return_value=document),
            patch("controllers.console.datasets.datasets_document.DatasetService.get_process_rules", return_value={}),
        ):
            response, status = method(api, self.session, tenant_id, user, "ds-1", "doc-1")
        assert status == 200

    def test_get_with_without_option(self, app: Flask, patch_tenant):
        """Test get with 'without' metadata option"""
        api = DocumentApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        document = make_document_detail()
        with (
            app.test_request_context("/?metadata=without"),
            patch.object(api, "get_document", return_value=document),
            patch("controllers.console.datasets.datasets_document.DatasetService.get_process_rules", return_value={}),
        ):
            response, status = method(api, self.session, tenant_id, user, "ds-1", "doc-1")
        assert status == 200


class TestDocumentGenerateSummaryApiSuccess(_UsesSQLiteSession):
    def test_generate_not_enabled_high_quality(self, app: Flask, patch_tenant, patch_permission):
        """Test summary generation on non-high-quality dataset"""
        api = DocumentGenerateSummaryApi()
        method = unwrap(api.post)
        user, _ = patch_tenant
        dataset = make_dataset(indexing_technique="economy", summary_index_setting={"enable": True})
        payload = {"document_list": ["doc-1"]}
        req_data = GenerateSummaryPayload.model_validate(payload)
        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.datasets_document.DatasetService.get_dataset", return_value=dataset),
        ):
            with pytest.raises(ValueError):
                method(api, req_data, self.session, user, "ds-1")


class TestDocumentProcessingApiResume(_UsesSQLiteSession):
    def test_resume_invalid_status(self, app: Flask, patch_tenant):
        """Test resume on non-paused document"""
        api = DocumentProcessingApi()
        method = unwrap(api.patch)
        user, tenant_id = patch_tenant
        document = make_document(indexing_status=IndexingStatus.COMPLETED, is_paused=False)
        with app.test_request_context("/"), patch.object(api, "get_document", return_value=document):
            with pytest.raises(InvalidActionError):
                method(api, self.session, tenant_id, user, "ds-1", "doc-1", "resume")


class TestDocumentPermissionCases(_UsesSQLiteSession):
    def test_document_batch_get_permission_denied(self, app: Flask, patch_tenant):
        api = DocumentBatchIndexingEstimateApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=make_dataset(),
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission",
                side_effect=services.errors.account.NoPermissionError("No permission"),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, self.session, tenant_id, user, "ds-1", "batch-1")

    def test_document_batch_get_documents_not_found(self, app: Flask, patch_tenant):
        api = DocumentBatchIndexingEstimateApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=make_dataset(),
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch.object(api, "get_batch_documents", return_value=None),
        ):
            response, status = method(api, self.session, tenant_id, user, "ds-1", "batch-1")
        assert status == 200
        assert response == {"tokens": 0, "total_price": 0, "currency": "USD", "total_segments": 0, "preview": []}

    def test_process_rule_get_by_document_success(self, app: Flask, patch_tenant):
        api = GetProcessRuleApi()
        method = unwrap(api.get)
        user, _ = patch_tenant
        document = make_document()
        session = self.session
        dataset = make_dataset()
        process_rule = DatasetProcessRule(dataset_id="ds-1", mode="custom", rules=json.dumps({"a": 1}), created_by="u1")
        session.add(process_rule)
        session.flush()
        with (
            app.test_request_context("/?document_id=doc-1"),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.get_document_by_id",
                return_value=document,
            ),
            patch("controllers.console.datasets.datasets_document.DatasetService.get_dataset", return_value=dataset),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission",
                return_value=None,
            ),
        ):
            result = method(api, session, user)
        if isinstance(result, tuple):
            response, status = result
        else:
            response, status = (result, 200)
        assert status == 200
        assert response["mode"] == "custom"

    def test_process_rule_permission_denied(self, app: Flask):
        api = GetProcessRuleApi()
        method = unwrap(api.get)
        user = make_account()
        document = make_document()
        session = self.session
        with (
            app.test_request_context("/?document_id=doc-1"),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.get_document_by_id",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=make_dataset(),
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission",
                side_effect=services.errors.account.NoPermissionError("No permission"),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, session, user)


class TestDocumentListAdvancedCases(_UsesSQLiteSession):
    def test_document_list_with_multiple_sort_options(self, app: Flask, patch_tenant, patch_dataset, patch_permission):
        """Test document list with different sort options"""
        api = DatasetDocumentListApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        pagination = MagicMock(items=[make_serializable_document()], total=1)
        with (
            app.test_request_context("/?sort=updated_at"),
            patch("controllers.console.datasets.datasets_document.paginate_query", return_value=pagination),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.enrich_documents_with_summary_index_status",
                return_value=None,
            ),
        ):
            response = method(api, self.session, tenant_id, user, "ds-1")
        assert response["total"] == 1

    def test_document_metadata_with_schema_validation(self, app: Flask, patch_tenant):
        """Test document metadata update with schema validation"""
        api = DocumentMetadataApi()
        method = unwrap(api.put)
        user, tenant_id = patch_tenant
        doc = make_document()
        payload = {"doc_type": "contract", "doc_metadata": {"amount": 5000, "currency": "USD", "invalid_field": "x"}}
        schema = {"amount": int, "currency": str}
        session = self.session
        req_data = DocumentMetadataUpdatePayload.model_validate(payload)
        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=doc),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.DOCUMENT_METADATA_SCHEMA",
                {"contract": schema},
            ),
        ):
            response, status = method(api, req_data, session, tenant_id, user, "ds-1", "doc-1")
            assert status == 200
            assert doc.doc_metadata == {"amount": 5000, "currency": "USD"}


class TestDocumentIndexingEdgeCases(_UsesSQLiteSession):
    def test_document_indexing_with_extraction_setting(self, app: Flask, patch_tenant):
        api = DocumentIndexingEstimateApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        document = make_document(
            indexing_status=IndexingStatus.INDEXING,
            data_source_info=json.dumps({"upload_file_id": "file-1"}),
        )
        upload_file = make_upload_file()
        session = self.session
        session.add(upload_file)
        session.flush()
        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=document),
            patch("controllers.console.datasets.datasets_document.ExtractSetting", return_value=MagicMock()),
            patch(
                "controllers.console.datasets.datasets_document.IndexingRunner.indexing_estimate",
                return_value=IndexingEstimate(total_segments=5, preview=[]),
            ),
        ):
            response, status = method(api, session, tenant_id, user, "ds-1", "doc-1")
        assert status == 200
