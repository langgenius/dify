from collections.abc import Callable
from dataclasses import dataclass, field
from typing import cast, override
from unittest.mock import create_autospec, patch

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.plugin.impl.exc import PluginDaemonClientSideError
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.models.document import ChildDocument, Document
from enums import DeploymentEdition
from models.dataset import Dataset, DatasetProcessRule
from models.enums import ProcessRuleMode
from models.model import UploadFile
from services.data_source.website_service import WebsiteService
from services.entities.upload_file import CreatedUploadArtifact
from services.extraction.contracts import (
    DatasourceType,
    ExtractedImage,
    ExtractionResult,
    ExtractSetting,
    NotionInfo,
    UploadFileExtractionInput,
)
from services.extraction.images import ExtractionImageWriter
from services.file_service import FileService
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.indexing.adapters.estimate import IndexingEstimateAdapter, SQLAlchemyProcessRuleReader
from services.knowledge.indexing.estimate import (
    IndexingEstimateExecutionError,
    IndexingEstimateProviderUnavailableError,
)


class _CommitUnknownSession(Session):
    @override
    def commit(self) -> None:
        super().commit()
        raise RuntimeError("commit result unknown")


class _FileServiceFake(FileService):
    def __init__(self) -> None:
        self.deleted_files: list[tuple[str, str]] = []
        self.deleted_artifacts: list[CreatedUploadArtifact] = []

    @override
    def delete_file(self, *, tenant_id: str, file_id: str) -> None:
        self.deleted_files.append((tenant_id, file_id))

    @override
    def delete_uncommitted_artifact(self, *, artifact: CreatedUploadArtifact) -> None:
        self.deleted_artifacts.append(artifact)


@dataclass
class _PreviewProcessor:
    documents: list[Document] = field(default_factory=list)
    callback_file_id: str | None = None
    error: Exception | None = None

    def transform(self, *_args: object, **kwargs: object) -> list[Document]:
        if self.callback_file_id is not None:
            callback = kwargs["on_upload_file_created"]
            assert callable(callback)
            callback(self.callback_file_id)
        if self.error is not None:
            raise self.error
        return self.documents


@dataclass(frozen=True)
class _ProcessorFactory:
    processor: _PreviewProcessor

    def init_index_processor(self) -> _PreviewProcessor:
        return self.processor


def _file_extract_setting() -> ExtractSetting:
    return ExtractSetting(
        datasource_type=DatasourceType.FILE,
        upload_file=UploadFileExtractionInput(
            id="source-upload",
            tenant_id="workspace-1",
            key="source/file.pdf",
            created_by="account-1",
        ),
    )


@pytest.fixture
def website_service() -> WebsiteService:
    return create_autospec(WebsiteService, instance=True, spec_set=True)


def _dataset(dataset_id: str, workspace_id: str) -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=workspace_id,
        name=f"Dataset {dataset_id}",
        description="",
        provider="vendor",
        permission="only_me",
        created_by="account-1",
        maintainer="account-1",
        data_source_type="upload_file",
        indexing_technique="economy",
    )


def test_notion_access_token_is_excluded_from_model_serialization_and_repr() -> None:
    notion_info = NotionInfo(
        credential_id="credential-1",
        notion_workspace_id="workspace-1",
        notion_obj_id="page-1",
        notion_page_type="page",
        tenant_id="tenant-1",
        notion_access_token="secret",
    )

    assert "notion_access_token" not in notion_info.model_dump()
    assert "secret" not in repr(notion_info)


def test_process_rule_reader_loads_tenant_scoped_rule(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        rule = DatasetProcessRule(
            dataset_id="dataset-1",
            mode=ProcessRuleMode.CUSTOM,
            rules='{"segmentation": {"separator": "\\n", "max_tokens": 100}}',
            created_by="account-1",
        )
        rule.id = "rule-1"
        session.add(rule)

    reader = SQLAlchemyProcessRuleReader(session_factory=sqlite_session_factory)

    assert reader.get_by_id(dataset_ref=DatasetRef("workspace-1", "dataset-1"), process_rule_id="rule-1") == {
        "mode": "custom",
        "rules": {"segmentation": {"separator": "\n", "max_tokens": 100}},
    }
    assert reader.get_by_id(dataset_ref=DatasetRef("workspace-2", "dataset-1"), process_rule_id="rule-1") is None


@pytest.mark.parametrize(
    ("doc_form", "mode", "expected_is_automatic"),
    [
        ("text_model", "automatic", True),
        ("hierarchical_model", "hierarchical", True),
        ("qa_model", "custom", False),
    ],
)
def test_estimates_segments_and_limits_previews(
    sqlite_session_factory: sessionmaker[Session],
    doc_form: str,
    mode: str,
    expected_is_automatic: bool,
    config_overrides: Callable[..., None],
    website_service: WebsiteService,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    files = _FileServiceFake()
    processor = _PreviewProcessor(
        documents=[
            Document(
                page_content=f"question-{i}",
                metadata={"answer": f"answer-{i}"},
                children=[ChildDocument(page_content="child")],
            )
            for i in range(11)
        ]
    )
    with (
        patch(
            "services.knowledge.indexing.adapters.estimate.ExtractProcessor.extract",
            return_value=ExtractionResult(documents=[Document(page_content="source")]),
        ) as extract,
        patch(
            "services.knowledge.indexing.adapters.estimate.IndexProcessorFactory",
            return_value=_ProcessorFactory(processor),
        ),
    ):
        result = IndexingEstimateAdapter(
            session_factory=sqlite_session_factory, files=files, website=website_service
        ).run(
            "workspace-1",
            [ExtractSetting(datasource_type=DatasourceType.WEBSITE)],
            {"mode": mode},
            doc_form,
        )

    if doc_form == "qa_model":
        assert result.total_segments == 220
        assert len(result.qa_preview) == 10
        assert result.qa_preview[-1].answer == "answer-9"
    else:
        assert result.total_segments == 11
        assert len(result.preview) == 10
        assert result.preview[0].child_chunks == ["child"]
    assert extract.call_args.kwargs["is_automatic"] is expected_is_automatic
    assert extract.call_args.kwargs.get("capture_source_version", False) is False
    assert extract.call_args.kwargs["image_writer"] is None
    assert extract.call_args.kwargs["website_service"] is website_service


def test_estimate_enforces_batch_limit(
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
    website_service: WebsiteService,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, BATCH_UPLOAD_LIMIT=1)
    files = _FileServiceFake()

    with pytest.raises(IndexingEstimateExecutionError, match="batch upload limit"):
        IndexingEstimateAdapter(session_factory=sqlite_session_factory, files=files, website=website_service).run(
            "workspace-1",
            [ExtractSetting(datasource_type=DatasourceType.WEBSITE)] * 2,
            {"mode": "automatic"},
        )


def test_preview_cleans_file_reported_by_transform_callback(
    sqlite_session_factory: sessionmaker[Session], website_service: WebsiteService
) -> None:
    files = _FileServiceFake()
    processor = _PreviewProcessor(
        documents=[Document(page_content="preview")],
        callback_file_id="transform-upload-1",
    )
    with (
        patch(
            "services.knowledge.indexing.adapters.estimate.ExtractProcessor.extract",
            return_value=ExtractionResult(documents=[Document(page_content="source")]),
        ),
        patch(
            "services.knowledge.indexing.adapters.estimate.IndexProcessorFactory",
            return_value=_ProcessorFactory(processor),
        ),
    ):
        result = IndexingEstimateAdapter(
            session_factory=sqlite_session_factory, files=files, website=website_service
        ).run(
            "workspace-1",
            [ExtractSetting(datasource_type=DatasourceType.WEBSITE)],
            {"mode": "automatic", "rules": {}},
            "text_model",
        )

    assert result.total_segments == 1
    assert files.deleted_files == [("workspace-1", "transform-upload-1")]
    assert files.deleted_artifacts == []


def test_preview_extract_failure_deletes_only_uncommitted_artifact_keys(
    sqlite_session_factory: sessionmaker[Session], website_service: WebsiteService
) -> None:
    files = create_autospec(FileService, instance=True, spec_set=True)
    processor = _PreviewProcessor()
    artifacts: list[CreatedUploadArtifact] = []

    def fail_extract(*_args: object, **kwargs: object) -> ExtractionResult[Document]:
        writer = cast(ExtractionImageWriter | None, kwargs["image_writer"])
        assert writer is not None
        writer.write(ExtractedImage(content=b"image", extension="png", mime_type="image/png"))
        artifacts.extend(writer.created_upload_artifacts)
        raise RuntimeError("extract failed")

    with (
        patch("services.knowledge.indexing.adapters.estimate.ExtractProcessor.extract", side_effect=fail_extract),
        patch(
            "services.knowledge.indexing.adapters.estimate.IndexProcessorFactory",
            return_value=_ProcessorFactory(processor),
        ),
        patch("services.knowledge.indexing.adapters.estimate.storage.save"),
    ):
        with pytest.raises(IndexingEstimateExecutionError, match="extract failed"):
            IndexingEstimateAdapter(session_factory=sqlite_session_factory, files=files, website=website_service).run(
                "workspace-1",
                [_file_extract_setting()],
                {"mode": "automatic"},
                "text_model",
            )

    [artifact] = artifacts
    files.delete_uncommitted_artifact.assert_called_once_with(artifact=artifact)
    files.delete_file.assert_not_called()
    with sqlite_session_factory() as session:
        assert session.get(UploadFile, artifact.id) is None


def test_preview_transform_failure_cleans_extraction_and_published_artifacts_by_their_own_boundaries(
    sqlite_session_factory: sessionmaker[Session], website_service: WebsiteService
) -> None:
    files = create_autospec(FileService, instance=True, spec_set=True)
    processor = _PreviewProcessor(
        callback_file_id="published-transform-upload-1",
        error=RuntimeError("transform failed"),
    )
    artifacts: list[CreatedUploadArtifact] = []

    def extract(*_args: object, **kwargs: object) -> ExtractionResult[Document]:
        writer = cast(ExtractionImageWriter | None, kwargs["image_writer"])
        assert writer is not None
        writer.write(ExtractedImage(content=b"image", extension="png", mime_type="image/png"))
        artifacts.extend(writer.created_upload_artifacts)
        return ExtractionResult(documents=[Document(page_content="source")])

    with (
        patch("services.knowledge.indexing.adapters.estimate.ExtractProcessor.extract", side_effect=extract),
        patch(
            "services.knowledge.indexing.adapters.estimate.IndexProcessorFactory",
            return_value=_ProcessorFactory(processor),
        ),
        patch("services.knowledge.indexing.adapters.estimate.storage.save"),
    ):
        with pytest.raises(IndexingEstimateExecutionError, match="transform failed"):
            IndexingEstimateAdapter(session_factory=sqlite_session_factory, files=files, website=website_service).run(
                "workspace-1",
                [_file_extract_setting()],
                {"mode": "automatic", "rules": {}},
                "text_model",
            )

    [artifact] = artifacts
    files.delete_uncommitted_artifact.assert_called_once_with(artifact=artifact)
    files.delete_file.assert_called_once_with(
        tenant_id="workspace-1",
        file_id="published-transform-upload-1",
    )
    with sqlite_session_factory() as session:
        assert session.get(UploadFile, artifact.id) is None


def test_preview_commit_failure_never_deletes_by_uncommitted_blob_key(
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    website_service: WebsiteService,
) -> None:
    session_factory: sessionmaker[Session] = sessionmaker(
        bind=sqlite_engine, class_=_CommitUnknownSession, expire_on_commit=False
    )
    files = create_autospec(FileService, instance=True, spec_set=True)
    processor = _PreviewProcessor(documents=[Document(page_content="preview")])
    artifacts: list[CreatedUploadArtifact] = []

    def extract(*_args: object, **kwargs: object) -> ExtractionResult[Document]:
        writer = cast(ExtractionImageWriter | None, kwargs["image_writer"])
        assert writer is not None
        writer.write(ExtractedImage(content=b"image", extension="png", mime_type="image/png"))
        artifacts.extend(writer.created_upload_artifacts)
        return ExtractionResult(documents=[Document(page_content="source")])

    with (
        patch("services.knowledge.indexing.adapters.estimate.ExtractProcessor.extract", side_effect=extract),
        patch(
            "services.knowledge.indexing.adapters.estimate.IndexProcessorFactory",
            return_value=_ProcessorFactory(processor),
        ),
        patch("services.knowledge.indexing.adapters.estimate.storage.save"),
    ):
        with pytest.raises(IndexingEstimateExecutionError, match="commit result unknown"):
            IndexingEstimateAdapter(session_factory=session_factory, files=files, website=website_service).run(
                "workspace-1",
                [_file_extract_setting()],
                {"mode": "automatic", "rules": {}},
                "text_model",
            )

    [artifact] = artifacts
    files.delete_file.assert_called_once_with(tenant_id="workspace-1", file_id=artifact.id)
    files.delete_uncommitted_artifact.assert_not_called()
    with sqlite_session_factory() as session:
        assert session.get(UploadFile, artifact.id) is not None


@pytest.mark.parametrize("provider", [None, "embedding-provider"])
def test_estimate_selects_dataset_embedding_and_rejects_foreign_tenant(
    sqlite_session_factory: sessionmaker[Session], provider: str | None, website_service: WebsiteService
) -> None:
    with sqlite_session_factory.begin() as session:
        dataset = _dataset("dataset-1", "workspace-1")
        dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
        dataset.embedding_model_provider = provider
        dataset.embedding_model = "embedding-model"
        session.add(dataset)
    files = _FileServiceFake()
    adapter = IndexingEstimateAdapter(session_factory=sqlite_session_factory, files=files, website=website_service)

    with (
        patch("services.knowledge.indexing.adapters.estimate.ModelManager.for_tenant") as manager,
        patch("services.knowledge.indexing.adapters.estimate.IndexProcessorFactory"),
    ):
        adapter.run("workspace-1", [], {"mode": "automatic"}, dataset_id="dataset-1")
        selected = (
            manager.return_value.get_model_instance if provider else manager.return_value.get_default_model_instance
        )
        selected.assert_called_once()
        with pytest.raises(IndexingEstimateExecutionError, match="Dataset not found"):
            adapter.run("foreign", [], {"mode": "automatic"}, dataset_id="dataset-1")


@pytest.mark.parametrize(
    ("processor_error", "expected_error"),
    [
        (LLMBadRequestError("provider unavailable"), IndexingEstimateProviderUnavailableError),
        (ProviderTokenNotInitError("provider unavailable"), IndexingEstimateProviderUnavailableError),
        (PluginDaemonClientSideError("provider unavailable"), IndexingEstimateProviderUnavailableError),
        (RuntimeError("processor failed"), IndexingEstimateExecutionError),
    ],
)
def test_estimate_translates_infrastructure_errors(
    sqlite_session_factory: sessionmaker[Session],
    processor_error: Exception,
    expected_error: type[Exception],
    website_service: WebsiteService,
) -> None:
    files = _FileServiceFake()
    adapter = IndexingEstimateAdapter(session_factory=sqlite_session_factory, files=files, website=website_service)

    with (
        patch("services.knowledge.indexing.adapters.estimate.IndexProcessorFactory", side_effect=processor_error),
        pytest.raises(expected_error, match="provider unavailable|processor failed"),
    ):
        adapter.run(
            "workspace-1",
            [ExtractSetting(datasource_type=DatasourceType.WEBSITE)],
            {"mode": "automatic", "rules": {}},
        )
