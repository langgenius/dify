import datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy import select
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
from models.dataset import Dataset, DatasetPermissionEnum
from models.dataset import Document as DatasetDocument
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from services.dataset_ref_service import DatasetRef, DocumentRef
from services.enterprise.rbac_service import RBACResourceWhitelistScope, ReplaceMemberBindings
from services.vector_space_admission_service import (
    VECTOR_SPACE_ADMISSION_ERROR_CODE,
    format_vector_space_admission_error,
)


def make_serializable_document(**overrides):
    attrs = {
        "id": "doc-1",
        "position": 1,
        "data_source_type": "upload_file",
        "data_source_info_dict": {"upload_file_id": "file-1"},
        "data_source_detail_dict": {},
        "dataset_process_rule_id": None,
        "name": "Document",
        "created_from": "web",
        "created_by": "u1",
        "created_at": None,
        "tokens": None,
        "indexing_status": "completed",
        "error": None,
        "enabled": True,
        "disabled_at": None,
        "disabled_by": None,
        "archived": False,
        "display_status": "available",
        "word_count": None,
        "hit_count": 0,
        "doc_form": "text_model",
        "doc_metadata_details": None,
        "summary_index_status": None,
        "need_summary": False,
        "process_rule_dict": None,
        "completed_segments": None,
        "total_segments": None,
    }
    attrs.update(overrides)
    document = MagicMock(
        spec_set=[
            *attrs,
            "get_data_source_detail_dict",
            "get_dataset_process_rule",
            "get_doc_metadata_details",
            "get_hit_count",
        ]
    )
    document.configure_mock(**attrs)
    document.get_data_source_detail_dict.return_value = attrs["data_source_detail_dict"]
    document.get_dataset_process_rule.return_value = None
    document.get_doc_metadata_details.return_value = attrs["doc_metadata_details"]
    document.get_hit_count.return_value = attrs["hit_count"]
    return document


def make_document_detail(**overrides):
    attrs = {
        "id": "doc-1",
        "position": 1,
        "data_source_type": "upload_file",
        "data_source_info_dict": {"upload_file_id": "file-1"},
        "data_source_detail_dict": {},
        "dataset_process_rule_id": None,
        "dataset_process_rule": None,
        "name": "Document",
        "created_from": "web",
        "created_by": "u1",
        "created_at": datetime.datetime(2024, 1, 1, tzinfo=datetime.UTC),
        "tokens": 10,
        "indexing_status": "completed",
        "completed_at": None,
        "updated_at": None,
        "indexing_latency": None,
        "error": None,
        "enabled": True,
        "disabled_at": None,
        "disabled_by": None,
        "archived": False,
        "doc_type": "others",
        "doc_metadata_details": [],
        "segment_count": 0,
        "average_segment_length": 0,
        "hit_count": 0,
        "display_status": "available",
        "doc_form": "text_model",
        "doc_language": "English",
        "need_summary": False,
    }
    attrs.update(overrides)
    document = MagicMock(
        spec_set=[
            *attrs,
            "get_data_source_detail_dict",
            "get_dataset_process_rule",
            "get_doc_metadata_details",
            "get_hit_count",
            "get_segment_count",
        ]
    )
    document.configure_mock(**attrs)
    document.get_data_source_detail_dict.return_value = attrs["data_source_detail_dict"]
    document.get_dataset_process_rule.return_value = attrs["dataset_process_rule"]
    document.get_doc_metadata_details.return_value = attrs["doc_metadata_details"]
    document.get_hit_count.return_value = attrs["hit_count"]
    document.get_segment_count.return_value = attrs["segment_count"]
    return document


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


@pytest.fixture
def tenant_ctx():
    return (MagicMock(is_dataset_editor=True, id="u1"), "tenant-1")


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
    return MagicMock(
        id="doc-1",
        tenant_id="tenant-1",
        indexing_status=IndexingStatus.INDEXING,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info_dict={"upload_file_id": "file-1"},
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        archived=False,
        is_paused=False,
        dataset_process_rule=None,
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


class TestGetProcessRuleApi:
    def test_get_default_success(self, app: Flask, patch_tenant):
        api = GetProcessRuleApi()
        method = unwrap(api.get)
        user, _ = patch_tenant
        with app.test_request_context("/"):
            response = method(api, MagicMock(), user)
        assert "rules" in response

    def test_get_with_document_preserves_legacy_segmentation_delimiter(self, app: Flask, patch_tenant):
        api = GetProcessRuleApi()
        method = unwrap(api.get)
        user, _ = patch_tenant

        document = MagicMock(dataset_id="ds-1")
        session = MagicMock()
        dataset = MagicMock()
        dataset.get_latest_process_rule.return_value = SimpleNamespace(
            mode="custom",
            rules_dict={"segmentation": {"delimiter": "---", "max_tokens": 123}},
        )

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
        dataset.get_latest_process_rule.assert_called_once_with(session=session)
        assert response["rules"]["segmentation"]["separator"] == "---"
        assert response["rules"]["segmentation"]["max_tokens"] == 123
        assert "delimiter" not in response["rules"]["segmentation"]

    def test_get_with_document_preserves_null_rules(self, app: Flask, patch_tenant):
        api = GetProcessRuleApi()
        method = unwrap(api.get)
        user, _ = patch_tenant
        session = MagicMock()
        dataset = MagicMock()
        dataset.get_latest_process_rule.return_value = SimpleNamespace(mode="custom", rules_dict=None)
        with (
            app.test_request_context("/?document_id=doc-1"),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.get_document_by_id",
                return_value=MagicMock(dataset_id="ds-1"),
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
        document = MagicMock(dataset_id="ds-1")
        session = MagicMock()
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


class TestDatasetDocumentListApi:
    def test_get_with_fetch_true_counts_segments(self, app: Flask, patch_tenant, patch_dataset, patch_permission):
        api = DatasetDocumentListApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        doc = make_serializable_document()
        pagination = MagicMock(items=[doc], total=1)
        session = MagicMock()
        session.scalar.return_value = 2
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
            resp = method(api, MagicMock(), tenant_id, user, "ds-1")
        assert resp["total"] == 1

    def test_get_success(self, app: Flask, patch_tenant, patch_dataset, patch_permission):
        api = DatasetDocumentListApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        document = make_serializable_document()
        pagination = MagicMock(items=[document], total=1)
        session = MagicMock()
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
        document.get_data_source_detail_dict.assert_called_once_with(session=session)
        document.get_dataset_process_rule.assert_called_once_with(session=session)
        document.get_doc_metadata_details.assert_called_once_with(session=session)
        document.get_hit_count.assert_called_once_with(session=session)

    def test_post_success(self, app: Flask, patch_tenant, patch_dataset, patch_permission):
        api = DatasetDocumentListApi()
        method = unwrap(api.post)
        user, _ = patch_tenant
        payload = {"indexing_technique": "economy"}
        created_dataset = make_dataset()
        created_document = make_document()
        session = MagicMock()
        session.scalar.return_value = 0
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
        user = MagicMock(is_dataset_editor=False)
        with (
            app.test_request_context("/", json={}),
            patch.object(type(console_ns), "payload", {}),
            patch("controllers.console.datasets.datasets_document.DatasetService.get_dataset", return_value=dataset),
        ):
            with pytest.raises(Forbidden):
                method(api, MagicMock(), user, "ds-1")

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
            response = method(api, MagicMock(), tenant_id, user, "ds-1")
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
            response = method(api, MagicMock(), tenant_id, user, "ds-1")
        assert response["total"] == 0


class TestDatasetInitApi:
    def test_post_success_serializes_created_dataset_and_documents(self, app: Flask, patch_tenant):
        api = DatasetInitApi()
        method = unwrap(api.post)
        user, tenant_id = patch_tenant
        payload = {"indexing_technique": "economy"}
        created_dataset = make_dataset()
        created_document = make_document(id="doc-init")
        session = MagicMock()
        session.scalar.return_value = 0
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


class TestDocumentResource:
    def test_get_document_resolves_owner_chain(self, dataset):
        api = DocumentResource()
        session = MagicMock()
        user = MagicMock()
        document = MagicMock()

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
        session = MagicMock()
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
                return_value=MagicMock(),
            ),
        ):
            api.get_document(session, "ds-1", "doc-1", MagicMock(), "tenant-1")

        check_permission.assert_not_called()


class TestDocumentApi:
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
            response, status = method(api, MagicMock(), tenant_id, user, "ds-1", "doc-1")
        assert status == 200

    def test_get_invalid_metadata(self, app: Flask, patch_tenant):
        api = DocumentApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        with app.test_request_context("/?metadata=wrong"), patch.object(api, "get_document", return_value=MagicMock()):
            with pytest.raises(InvalidMetadataError):
                method(api, MagicMock(), tenant_id, user, "ds-1", "doc-1")

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
            patch.object(api, "get_document", return_value=MagicMock()),
            patch("controllers.console.datasets.datasets_document.DocumentService.delete_document", return_value=None),
        ):
            response, status = method(api, MagicMock(), tenant_id, user, "ds-1", "doc-1")
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
            patch.object(api, "get_document", return_value=MagicMock()),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.delete_document",
                side_effect=services.errors.document.DocumentIndexingError(),
            ),
        ):
            with pytest.raises(DocumentIndexingError):
                method(api, MagicMock(), tenant_id, user, "ds-1", "doc-1")


class TestDocumentDownloadApi:
    def test_download_success(self, app: Flask, patch_tenant):
        api = DocumentDownloadApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        document = MagicMock()
        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.get_document_download_url",
                return_value="url",
            ),
        ):
            response = method(api, MagicMock(), tenant_id, user, "ds-1", "doc-1")
        assert response["url"] == "url"


class TestDocumentProcessingApi:
    def test_processing_forbidden_when_not_editor(self, app: Flask):
        api = DocumentProcessingApi()
        method = unwrap(api.patch)
        user = MagicMock(is_dataset_editor=False)
        with app.test_request_context("/"), patch.object(api, "get_document", return_value=MagicMock()):
            with pytest.raises(Forbidden):
                method(api, MagicMock(), "tenant-1", user, "ds-1", "doc-1", "pause")

    def test_resume_from_error_state(self, app: Flask, patch_tenant):
        api = DocumentProcessingApi()
        method = unwrap(api.patch)
        user, tenant_id = patch_tenant
        doc = MagicMock(indexing_status=IndexingStatus.ERROR, is_paused=True)
        session = MagicMock()
        with app.test_request_context("/"), patch.object(api, "get_document", return_value=doc):
            _, status = method(api, session, tenant_id, user, "ds-1", "doc-1", "resume")
        assert status == 200

    def test_resume_success(self, app: Flask, patch_tenant):
        api = DocumentProcessingApi()
        method = unwrap(api.patch)
        user, tenant_id = patch_tenant
        document = MagicMock(indexing_status=IndexingStatus.PAUSED, is_paused=True)
        session = MagicMock()
        with app.test_request_context("/"), patch.object(api, "get_document", return_value=document):
            response, status = method(api, session, tenant_id, user, "ds-1", "doc-1", "resume")
        assert status == 200

    def test_pause_success(self, app: Flask, patch_tenant):
        api = DocumentProcessingApi()
        method = unwrap(api.patch)
        user, tenant_id = patch_tenant
        document = MagicMock(indexing_status="indexing")
        session = MagicMock()
        with app.test_request_context("/"), patch.object(api, "get_document", return_value=document):
            response, status = method(api, session, tenant_id, user, "ds-1", "doc-1", "pause")
        assert status == 200

    def test_pause_invalid(self, app: Flask, patch_tenant):
        api = DocumentProcessingApi()
        method = unwrap(api.patch)
        user, tenant_id = patch_tenant
        document = MagicMock(indexing_status=IndexingStatus.COMPLETED)
        with app.test_request_context("/"), patch.object(api, "get_document", return_value=document):
            with pytest.raises(InvalidActionError):
                method(api, MagicMock(), tenant_id, user, "ds-1", "doc-1", "pause")


class TestDocumentMetadataApi:
    def test_put_metadata_schema_filtering(self, app: Flask, patch_tenant):
        api = DocumentMetadataApi()
        method = unwrap(api.put)
        user, tenant_id = patch_tenant
        doc = MagicMock()
        payload = {"doc_type": "invoice", "doc_metadata": {"amount": 10, "invalid": "x"}}
        schema = {"amount": int}
        session = MagicMock()
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
        document = MagicMock()
        payload = {"doc_type": "others", "doc_metadata": {"a": 1}}
        session = MagicMock()
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
        with app.test_request_context("/"), patch.object(api, "get_document", return_value=MagicMock()):
            with pytest.raises(ValueError):
                method(api, req_data, MagicMock(), tenant_id, user, "ds-1", "doc-1")

    def test_put_invalid_doc_type(self, app: Flask, patch_tenant):
        api = DocumentMetadataApi()
        method = unwrap(api.put)
        user, tenant_id = patch_tenant
        payload = {"doc_type": "invalid", "doc_metadata": {}}
        req_data = DocumentMetadataUpdatePayload.model_validate(payload)
        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=MagicMock()),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.DOCUMENT_METADATA_SCHEMA",
                {"others": {}},
            ),
        ):
            with pytest.raises(ValueError):
                method(api, req_data, MagicMock(), tenant_id, user, "ds-1", "doc-1")


class TestDocumentStatusApi:
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
            response, status = method(api, MagicMock(), user, "ds-1", "enable")
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
                method(api, MagicMock(), user, "ds-1", "enable")


class TestDocumentRetryApi:
    def test_retry_archived_document_skipped(self, app: Flask, patch_tenant, patch_scoped_dataset, patch_permission):
        api = DocumentRetryApi()
        method = unwrap(api.post)
        user, tenant_id = patch_tenant
        payload = {"document_ids": ["doc-1"]}
        req_data = DocumentRetryPayload.model_validate(payload)
        doc = MagicMock(id="doc-1", indexing_status="indexing")
        session = MagicMock()
        session.scalars.return_value.all.return_value = [doc]
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
        document = MagicMock(id="doc-1", indexing_status=IndexingStatus.INDEXING, archived=False)
        session = MagicMock()
        session.scalars.return_value.all.return_value = [document]
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
        first_document = MagicMock(id="doc-1", indexing_status=IndexingStatus.ERROR, archived=False)
        second_document = MagicMock(id="doc-2", indexing_status=IndexingStatus.ERROR, archived=False)
        session = MagicMock()
        session.scalars.return_value.all.return_value = [first_document, second_document]

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.datasets_document.DocumentService.check_archived", return_value=False),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.retry_document", return_value=None
            ) as retry_mock,
        ):
            response, status = method(api, req_data, session, tenant_id, user, "ds-1")

        assert status == 204
        statement = session.scalars.call_args.args[0]
        assert statement.compare(
            select(DatasetDocument).where(
                DatasetDocument.tenant_id == "tenant-1",
                DatasetDocument.dataset_id == "ds-1",
                DatasetDocument.id.in_(["doc-1", "doc-2"]),
            )
        )
        retry_mock.assert_called_once_with("ds-1", [first_document, second_document], session)

    def test_retry_skips_completed_document(self, app: Flask, patch_tenant, patch_scoped_dataset, patch_permission):
        api = DocumentRetryApi()
        method = unwrap(api.post)
        user, tenant_id = patch_tenant
        payload = {"document_ids": ["doc-1"]}
        req_data = DocumentRetryPayload.model_validate(payload)
        document = MagicMock(id="doc-1", indexing_status=IndexingStatus.COMPLETED, archived=False)
        session = MagicMock()
        session.scalars.return_value.all.return_value = [document]
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
        session = MagicMock()
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

        session.scalars.assert_not_called()
        bypass_knowledge_rate_limit.assert_not_called()
        retry_document.assert_not_called()


class TestDocumentPauseRecoverApi:
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
        session = MagicMock()
        document = MagicMock()

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


class TestWebsiteDocumentSyncApi:
    def test_get_uses_scoped_dataset_and_document(self, app: Flask, patch_tenant, dataset):
        api = WebsiteDocumentSyncApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        session = MagicMock()
        document = MagicMock(data_source_type="website_crawl")

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
        user = MagicMock(is_dataset_editor=False)
        session = MagicMock()

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


class TestDocumentPipelineExecutionLogApi:
    def test_get_log_success(self, app: Flask, patch_tenant):
        api = DocumentPipelineExecutionLogApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        log = MagicMock(datasource_info="{}", datasource_type="file", input_data={}, datasource_node_id="n1")
        document = MagicMock(id="trusted-doc")
        session = MagicMock()
        session.scalar.return_value = log
        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=document) as get_document,
        ):
            response, status = method(api, session, tenant_id, user, "ds-1", "doc-1")
        assert status == 200
        get_document.assert_called_once_with(session, "ds-1", "doc-1", user, tenant_id)
        assert "trusted-doc" in session.scalar.call_args.args[0].compile().params.values()


class TestDocumentGenerateSummaryApi:
    def test_generate_summary_missing_documents(self, app: Flask, patch_tenant, patch_permission):
        api = DocumentGenerateSummaryApi()
        method = unwrap(api.post)
        user, _ = patch_tenant
        dataset = MagicMock(indexing_technique="high_quality", summary_index_setting={"enable": True})
        payload = {"document_list": ["doc-1", "doc-2"]}
        req_data = GenerateSummaryPayload.model_validate(payload)
        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.datasets_document.DatasetService.get_dataset", return_value=dataset),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.get_documents_by_ids",
                return_value=[MagicMock(id="doc-1")],
            ),
        ):
            with pytest.raises(NotFound):
                method(api, req_data, MagicMock(), user, "ds-1")

    def test_generate_not_enabled(self, app: Flask, patch_tenant, patch_permission):
        api = DocumentGenerateSummaryApi()
        method = unwrap(api.post)
        user, _ = patch_tenant
        dataset = MagicMock(indexing_technique="high_quality", summary_index_setting={"enable": False})
        payload = {"document_list": ["doc-1"]}
        req_data = GenerateSummaryPayload.model_validate(payload)
        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.datasets_document.DatasetService.get_dataset", return_value=dataset),
        ):
            with pytest.raises(ValueError):
                method(api, req_data, MagicMock(), user, "ds-1")

    def test_generate_summary_success_with_qa_skip(self, app: Flask, patch_tenant, patch_permission):
        api = DocumentGenerateSummaryApi()
        method = unwrap(api.post)
        user, _ = patch_tenant
        dataset = MagicMock(indexing_technique="high_quality", summary_index_setting={"enable": True})
        doc1 = MagicMock(id="doc-1", doc_form=IndexStructureType.QA_INDEX)
        doc2 = MagicMock(id="doc-2", doc_form=IndexStructureType.PARAGRAPH_INDEX)
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
            response, status = method(api, req_data, MagicMock(), user, "ds-1")
        assert status == 200


class TestDocumentSummaryStatusApi:
    def test_get_success(self, app: Flask, patch_tenant, patch_permission):
        api = DocumentSummaryStatusApi()
        method = unwrap(api.get)
        user, _ = patch_tenant
        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset", return_value=MagicMock()
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
            response, status = method(api, MagicMock(), user, "ds-1", "doc-1")
        assert status == 200
        assert response["summary_status"]["timeout"] == 1
        assert response["summaries"][0]["status"] == "timeout"


class TestDocumentIndexingEstimateApi:
    def test_indexing_estimate_file_not_found(self, app: Flask, patch_tenant):
        api = DocumentIndexingEstimateApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        document = MagicMock(
            indexing_status=IndexingStatus.INDEXING,
            data_source_type=DataSourceType.UPLOAD_FILE,
            data_source_info_dict={"upload_file_id": "file-1"},
            tenant_id="tenant-1",
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            dataset_process_rule=None,
        )
        session = MagicMock()
        session.scalar.return_value = None
        with app.test_request_context("/"), patch.object(api, "get_document", return_value=document):
            with pytest.raises(NotFound):
                method(api, session, tenant_id, user, "ds-1", "doc-1")

    def test_indexing_estimate_generic_exception(self, app: Flask, patch_tenant):
        api = DocumentIndexingEstimateApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        document = MagicMock(
            indexing_status=IndexingStatus.INDEXING,
            data_source_type=DataSourceType.UPLOAD_FILE,
            data_source_info_dict={"upload_file_id": "file-1"},
            tenant_id="tenant-1",
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            dataset_process_rule=None,
        )
        upload_file = MagicMock()
        mock_indexing_runner = MagicMock()
        mock_indexing_runner.indexing_estimate.side_effect = RuntimeError("Some indexing error")
        session = MagicMock()
        session.scalar.return_value = upload_file
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
        document = MagicMock(indexing_status=IndexingStatus.COMPLETED)
        with app.test_request_context("/"), patch.object(api, "get_document", return_value=document):
            with pytest.raises(DocumentAlreadyFinishedError):
                method(api, MagicMock(), tenant_id, user, "ds-1", "doc-1")


class TestDocumentBatchDownloadZipApi:
    def test_post_no_documents(self, app: Flask, patch_tenant):
        api = DocumentBatchDownloadZipApi()
        method = unwrap(api.post)
        user, tenant_id = patch_tenant
        payload: dict[str, list[str]] = {"document_ids": []}
        with app.test_request_context("/", json=payload), patch.object(type(console_ns), "payload", payload):
            with pytest.raises(ValueError):
                method(api, MagicMock(), tenant_id, user, "ds-1")


class TestDatasetDocumentListApiDelete:
    def test_delete_success(self, app: Flask, patch_tenant, patch_scoped_dataset, patch_permission):
        """Test successful deletion of documents"""
        api = DatasetDocumentListApi()
        method = unwrap(api.delete)
        user, tenant_id = patch_tenant
        session = MagicMock()
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
                method(api, MagicMock(), tenant_id, user, "ds-1")

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
                method(api, MagicMock(), tenant_id, user, "foreign-dataset")

        bypass_knowledge_rate_limit.assert_not_called()
        delete_documents.assert_not_called()


class TestDocumentBatchIndexingEstimateApi:
    def test_batch_indexing_estimate_website(self, app: Flask, patch_tenant):
        api = DocumentBatchIndexingEstimateApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        doc = MagicMock(
            indexing_status=IndexingStatus.INDEXING,
            data_source_type=DataSourceType.WEBSITE_CRAWL,
            data_source_info_dict={
                "provider": "firecrawl",
                "job_id": "j1",
                "url": "https://x.com",
                "mode": "single",
                "only_main_content": True,
            },
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
        )
        with (
            app.test_request_context("/"),
            patch.object(api, "get_batch_documents", return_value=[doc]),
            patch(
                "controllers.console.datasets.datasets_document.IndexingRunner.indexing_estimate",
                return_value=IndexingEstimate(total_segments=2, preview=[]),
            ),
        ):
            resp, status = method(api, MagicMock(), tenant_id, user, "ds-1", "batch-1")
        assert status == 200

    def test_batch_indexing_estimate_notion(self, app: Flask, patch_tenant):
        api = DocumentBatchIndexingEstimateApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        doc = MagicMock(
            indexing_status=IndexingStatus.INDEXING,
            data_source_type=DataSourceType.NOTION_IMPORT,
            data_source_info_dict={
                "credential_id": "c1",
                "notion_workspace_id": "w1",
                "notion_page_id": "p1",
                "type": "page",
            },
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
        )
        with (
            app.test_request_context("/"),
            patch.object(api, "get_batch_documents", return_value=[doc]),
            patch(
                "controllers.console.datasets.datasets_document.IndexingRunner.indexing_estimate",
                return_value=IndexingEstimate(total_segments=1, preview=[]),
            ),
        ):
            resp, status = method(api, MagicMock(), tenant_id, user, "ds-1", "batch-1")
        assert status == 200

    def test_batch_estimate_unsupported_datasource(self, app: Flask, patch_tenant):
        api = DocumentBatchIndexingEstimateApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        document = MagicMock(
            indexing_status=IndexingStatus.INDEXING,
            data_source_type="unknown",
            data_source_info_dict={},
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
        )
        with app.test_request_context("/"), patch.object(api, "get_batch_documents", return_value=[document]):
            with pytest.raises(ValueError):
                method(api, MagicMock(), tenant_id, user, "ds-1", "batch-1")

    def test_get_batch_estimate_invalid_batch(self, app: Flask, patch_tenant):
        """Test batch estimation with invalid batch"""
        api = DocumentBatchIndexingEstimateApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        with app.test_request_context("/"), patch.object(api, "get_batch_documents", side_effect=NotFound()):
            with pytest.raises(NotFound):
                method(api, MagicMock(), tenant_id, user, "ds-1", "invalid-batch")


class TestDocumentBatchIndexingStatusApi:
    def test_get_batch_status_success_serializes_status_shape(self, app: Flask, patch_tenant):
        api = DocumentBatchIndexingStatusApi()
        method = unwrap(api.get)
        user, _ = patch_tenant
        error = format_vector_space_admission_error(61, 50)
        document = MagicMock(
            id="doc-1",
            indexing_status=IndexingStatus.ERROR,
            is_paused=False,
            processing_started_at=None,
            parsing_completed_at=None,
            cleaning_completed_at=None,
            splitting_completed_at=None,
            completed_at=None,
            paused_at=None,
            error=error,
            stopped_at=None,
        )
        session = MagicMock()
        session.scalar.side_effect = [2, 3]
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
                method(api, MagicMock(), user, "ds-1", "invalid-batch")


class TestDocumentIndexingStatusApi:
    def test_get_status_success_serializes_status_shape(self, app: Flask, patch_tenant):
        api = DocumentIndexingStatusApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        document = MagicMock(
            id="doc-1",
            indexing_status=IndexingStatus.INDEXING,
            is_paused=False,
            processing_started_at=None,
            parsing_completed_at=None,
            cleaning_completed_at=None,
            splitting_completed_at=None,
            completed_at=None,
            paused_at=None,
            error=None,
            stopped_at=None,
        )
        session = MagicMock()
        session.scalar.side_effect = [1, 4]
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
                method(api, MagicMock(), tenant_id, user, "ds-1", "invalid-doc")


class TestDocumentRenameApi:
    def test_post_success_serializes_document_shape(self, app: Flask, patch_tenant):
        api = DocumentRenameApi()
        method = unwrap(api.post)
        user, _ = patch_tenant
        payload = {"name": "Renamed Document"}
        req_data = DocumentRenamePayload.model_validate(payload)
        renamed_document = make_document(id="doc-renamed", name="Renamed Document")
        session = MagicMock()
        session.scalar.return_value = 0
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


class TestDocumentApiMetadata:
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
            response, status = method(api, MagicMock(), tenant_id, user, "ds-1", "doc-1")
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
            response, status = method(api, MagicMock(), tenant_id, user, "ds-1", "doc-1")
        assert status == 200


class TestDocumentGenerateSummaryApiSuccess:
    def test_generate_not_enabled_high_quality(self, app: Flask, patch_tenant, patch_permission):
        """Test summary generation on non-high-quality dataset"""
        api = DocumentGenerateSummaryApi()
        method = unwrap(api.post)
        user, _ = patch_tenant
        dataset = MagicMock(indexing_technique="economy", summary_index_setting={"enable": True})
        payload = {"document_list": ["doc-1"]}
        req_data = GenerateSummaryPayload.model_validate(payload)
        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.datasets_document.DatasetService.get_dataset", return_value=dataset),
        ):
            with pytest.raises(ValueError):
                method(api, req_data, MagicMock(), user, "ds-1")


class TestDocumentProcessingApiResume:
    def test_resume_invalid_status(self, app: Flask, patch_tenant):
        """Test resume on non-paused document"""
        api = DocumentProcessingApi()
        method = unwrap(api.patch)
        user, tenant_id = patch_tenant
        document = MagicMock(indexing_status=IndexingStatus.COMPLETED, is_paused=False)
        with app.test_request_context("/"), patch.object(api, "get_document", return_value=document):
            with pytest.raises(InvalidActionError):
                method(api, MagicMock(), tenant_id, user, "ds-1", "doc-1", "resume")


class TestDocumentPermissionCases:
    def test_document_batch_get_permission_denied(self, app: Flask, patch_tenant):
        api = DocumentBatchIndexingEstimateApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset", return_value=MagicMock()
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission",
                side_effect=services.errors.account.NoPermissionError("No permission"),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, MagicMock(), tenant_id, user, "ds-1", "batch-1")

    def test_document_batch_get_documents_not_found(self, app: Flask, patch_tenant):
        api = DocumentBatchIndexingEstimateApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset", return_value=MagicMock()
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch.object(api, "get_batch_documents", return_value=None),
        ):
            response, status = method(api, MagicMock(), tenant_id, user, "ds-1", "batch-1")
        assert status == 200
        assert response == {"tokens": 0, "total_price": 0, "currency": "USD", "total_segments": 0, "preview": []}

    def test_process_rule_get_by_document_success(self, app: Flask, patch_tenant):
        api = GetProcessRuleApi()
        method = unwrap(api.get)
        user, _ = patch_tenant
        document = MagicMock(dataset_id="ds-1")
        session = MagicMock()
        dataset = MagicMock()
        dataset.get_latest_process_rule.return_value = SimpleNamespace(mode="custom", rules_dict={"a": 1})
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
        user = MagicMock(is_dataset_editor=True)
        document = MagicMock(dataset_id="ds-1")
        session = MagicMock()
        with (
            app.test_request_context("/?document_id=doc-1"),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.get_document_by_id",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset", return_value=MagicMock()
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission",
                side_effect=services.errors.account.NoPermissionError("No permission"),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, session, user)


class TestDocumentListAdvancedCases:
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
            response = method(api, MagicMock(), tenant_id, user, "ds-1")
        assert response["total"] == 1

    def test_document_metadata_with_schema_validation(self, app: Flask, patch_tenant):
        """Test document metadata update with schema validation"""
        api = DocumentMetadataApi()
        method = unwrap(api.put)
        user, tenant_id = patch_tenant
        doc = MagicMock()
        payload = {"doc_type": "contract", "doc_metadata": {"amount": 5000, "currency": "USD", "invalid_field": "x"}}
        schema = {"amount": int, "currency": str}
        session = MagicMock()
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


class TestDocumentIndexingEdgeCases:
    def test_document_indexing_with_extraction_setting(self, app: Flask, patch_tenant):
        api = DocumentIndexingEstimateApi()
        method = unwrap(api.get)
        user, tenant_id = patch_tenant
        document = MagicMock(
            indexing_status=IndexingStatus.INDEXING,
            data_source_type=DataSourceType.UPLOAD_FILE,
            data_source_info_dict={"upload_file_id": "file-1"},
            tenant_id="tenant-1",
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            dataset_process_rule=None,
        )
        upload_file = MagicMock()
        session = MagicMock()
        session.scalar.return_value = upload_file
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
