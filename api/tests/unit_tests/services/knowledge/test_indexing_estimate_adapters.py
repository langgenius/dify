from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.entities.knowledge_entities import IndexingEstimate
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.plugin.impl.exc import PluginDaemonClientSideError
from core.rag.extractor.entity.extract_setting import ExtractSetting, NotionInfo
from extensions.storage.storage_type import StorageType
from models.dataset import DatasetProcessRule
from models.enums import CreatorUserRole, ProcessRuleMode
from models.model import UploadFile
from services.entities.knowledge_entities.indexing_estimate import (
    ExistingDocumentsEstimateCommand,
    NewSourcesEstimateCommand,
    NotionEstimateSource,
    UploadFileEstimateSource,
    WebsiteEstimateSource,
)
from services.entities.knowledge_entities.records import DatasetRecord, DocumentRecord
from services.knowledge.adapters import (
    EstimateSourceNotFoundError,
    IndexingEstimateExecutionError,
    IndexingEstimateProviderUnavailableError,
    IndexingRunnerEstimateGateway,
    UnsupportedEstimateSourceError,
)


@dataclass(frozen=True)
class RunnerCall:
    tenant_id: str
    source_types: tuple[str, ...]
    file_ids: tuple[str | None, ...]
    notion_page_ids: tuple[str | None, ...]
    notion_tokens: tuple[str | None, ...]
    website_urls: tuple[str | None, ...]
    process_rule: Mapping[str, object]
    dataset_id: str | None


@dataclass
class RecordingIndexingRunner:
    calls: list[RunnerCall] = field(default_factory=list)
    error: Exception | None = None

    def indexing_estimate(
        self,
        tenant_id: str,
        extract_settings: list[ExtractSetting],
        tmp_processing_rule: Mapping[str, object],
        doc_form: str | None = None,
        doc_language: str = "English",
        dataset_id: str | None = None,
        indexing_technique: str = "economy",
        *,
        session: Session,
    ) -> IndexingEstimate:
        del doc_form, doc_language, indexing_technique, session
        if self.error is not None:
            raise self.error
        self.calls.append(
            RunnerCall(
                tenant_id=tenant_id,
                source_types=tuple(str(setting.datasource_type) for setting in extract_settings),
                file_ids=tuple(setting.upload_file.id if setting.upload_file else None for setting in extract_settings),
                notion_page_ids=tuple(
                    setting.notion_info.notion_obj_id if setting.notion_info else None for setting in extract_settings
                ),
                notion_tokens=tuple(
                    setting.notion_info.notion_access_token if setting.notion_info else None
                    for setting in extract_settings
                ),
                website_urls=tuple(
                    setting.website_info.url if setting.website_info else None for setting in extract_settings
                ),
                process_rule=tmp_processing_rule,
                dataset_id=dataset_id,
            )
        )
        return IndexingEstimate(total_segments=len(extract_settings), preview=[])


@dataclass
class StaticCredentialResolver:
    credentials: Mapping[str, object] = field(default_factory=lambda: {"integration_secret": "secret"})
    calls: list[tuple[str, str, str, str, str]] = field(default_factory=list)

    def resolve(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
        provider: str,
        plugin_id: str,
    ) -> dict[str, object]:
        self.calls.append((workspace_id, actor_id, credential_id, provider, plugin_id))
        return dict(self.credentials)


def test_notion_access_token_is_excluded_from_model_serialization_and_repr() -> None:
    info = NotionInfo(
        credential_id="credential-1",
        notion_workspace_id="workspace",
        notion_obj_id="page-1",
        notion_page_type="page",
        tenant_id="workspace-1",
        notion_access_token="secret",
    )

    assert "notion_access_token" not in info.model_dump()
    assert "secret" not in repr(info)


def _upload(file_id: str) -> UploadFile:
    upload = UploadFile(
        tenant_id="workspace-1",
        storage_type=StorageType.LOCAL,
        key=f"{file_id}.txt",
        name=f"{file_id}.txt",
        size=10,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        created_at=datetime(2026, 1, 1),
        used=False,
    )
    upload.id = file_id
    return upload


def _dataset() -> DatasetRecord:
    return DatasetRecord(
        id="dataset-1",
        workspace_id="workspace-1",
        maintainer_id="account-1",
        permission="only_me",
        data_source_type="upload_file",
        indexing_technique="high_quality",
        embedding_model=None,
        embedding_model_provider=None,
    )


def _document(
    document_id: str,
    source_type: str,
    source_info: Mapping[str, object] | None,
    *,
    process_rule_id: str | None = "rule-1",
) -> DocumentRecord:
    return DocumentRecord(
        id=document_id,
        workspace_id="workspace-1",
        dataset_id="dataset-1",
        name=document_id,
        data_source_type=source_type,
        data_source_info=source_info,
        enabled=True,
        archived=False,
        indexing_status="waiting",
        batch="batch-1",
        doc_form="text_model",
        doc_language="English",
        dataset_process_rule_id=process_rule_id,
        need_summary=False,
        doc_metadata=None,
    )


def test_gateway_maps_all_new_source_variants(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_upload("file-1"))
    runner = RecordingIndexingRunner()
    credentials = StaticCredentialResolver()
    gateway = IndexingRunnerEstimateGateway(
        session_factory=sqlite_session_factory,
        credentials=credentials,
        runner_factory=lambda: runner,
    )

    result = gateway.estimate(
        workspace_id="workspace-1",
        actor_id="account-1",
        command=NewSourcesEstimateCommand(
            sources=(
                UploadFileEstimateSource("file-1"),
                NotionEstimateSource("notion-workspace", "page-1", "page", "credential-1"),
                WebsiteEstimateSource("firecrawl", "job-1", "https://example.com"),
            ),
            process_rule={"mode": "automatic", "rules": {}},
            dataset_id="dataset-1",
        ),
    )

    assert result.total_segments == 3
    assert runner.calls == [
        RunnerCall(
            tenant_id="workspace-1",
            source_types=("upload_file", "notion_import", "website_crawl"),
            file_ids=("file-1", None, None),
            notion_page_ids=(None, "page-1", None),
            notion_tokens=(None, "secret", None),
            website_urls=(None, None, "https://example.com"),
            process_rule={"mode": "automatic", "rules": {}},
            dataset_id="dataset-1",
        )
    ]
    assert credentials.calls == [
        (
            "workspace-1",
            "account-1",
            "credential-1",
            "notion_datasource",
            "langgenius/notion_datasource",
        )
    ]


def test_gateway_maps_entire_existing_document_batch_in_one_runner_call(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_upload("file-1"))
        rule = DatasetProcessRule(
            dataset_id="dataset-1",
            mode=ProcessRuleMode.AUTOMATIC,
            rules=None,
            created_by="account-1",
        )
        rule.id = "rule-1"
        session.add(rule)
    runner = RecordingIndexingRunner()
    credentials = StaticCredentialResolver()
    gateway = IndexingRunnerEstimateGateway(
        session_factory=sqlite_session_factory,
        credentials=credentials,
        runner_factory=lambda: runner,
    )

    result = gateway.estimate(
        workspace_id="workspace-1",
        actor_id="account-1",
        command=ExistingDocumentsEstimateCommand(
            dataset=_dataset(),
            documents=(
                _document("document-1", "upload_file", {"upload_file_id": "file-1"}),
                _document(
                    "document-2",
                    "notion_import",
                    {
                        "credential_id": "credential-1",
                        "notion_workspace_id": "notion-workspace",
                        "notion_page_id": "page-1",
                        "type": "page",
                    },
                ),
                _document(
                    "document-3",
                    "website_crawl",
                    {
                        "provider": "firecrawl",
                        "job_id": "job-1",
                        "url": "https://example.com",
                        "mode": "crawl",
                        "only_main_content": True,
                    },
                ),
            ),
        ),
    )

    assert result.total_segments == 3
    assert len(runner.calls) == 1
    assert runner.calls[0].source_types == ("upload_file", "notion_import", "website_crawl")


def test_gateway_resolves_duplicate_notion_credential_once(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    runner = RecordingIndexingRunner()
    credentials = StaticCredentialResolver()
    gateway = IndexingRunnerEstimateGateway(
        session_factory=sqlite_session_factory,
        credentials=credentials,
        runner_factory=lambda: runner,
    )

    gateway.estimate(
        workspace_id="workspace-1",
        actor_id="account-1",
        command=NewSourcesEstimateCommand(
            sources=(
                NotionEstimateSource("notion-workspace", "page-1", "page", "credential-1"),
                NotionEstimateSource("notion-workspace", "page-2", "page", "credential-1"),
            ),
            process_rule={"mode": "automatic", "rules": {}},
        ),
    )

    assert len(credentials.calls) == 1
    assert runner.calls[0].notion_page_ids == ("page-1", "page-2")


def test_gateway_returns_zero_for_empty_sources_without_creating_runner(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    runner_created = False

    def create_runner() -> RecordingIndexingRunner:
        nonlocal runner_created
        runner_created = True
        return RecordingIndexingRunner()

    gateway = IndexingRunnerEstimateGateway(
        session_factory=sqlite_session_factory,
        credentials=StaticCredentialResolver(),
        runner_factory=create_runner,
    )

    result = gateway.estimate(
        workspace_id="workspace-1",
        actor_id="account-1",
        command=NewSourcesEstimateCommand(sources=(), process_rule={"mode": "automatic", "rules": {}}),
    )

    assert result == IndexingEstimate(total_segments=0, preview=[])
    assert runner_created is False


def test_gateway_rejects_upload_file_outside_workspace(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_upload("file-1"))
    gateway = IndexingRunnerEstimateGateway(
        session_factory=sqlite_session_factory,
        credentials=StaticCredentialResolver(),
        runner_factory=RecordingIndexingRunner,
    )

    with pytest.raises(EstimateSourceNotFoundError, match="file-1"):
        gateway.estimate(
            workspace_id="workspace-2",
            actor_id="account-1",
            command=NewSourcesEstimateCommand(
                sources=(UploadFileEstimateSource("file-1"),),
                process_rule={"mode": "automatic", "rules": {}},
            ),
        )


def test_gateway_rejects_existing_upload_file_outside_workspace(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    foreign_upload = _upload("file-1")
    foreign_upload.tenant_id = "workspace-2"
    with sqlite_session_factory.begin() as session:
        session.add(foreign_upload)
    gateway = IndexingRunnerEstimateGateway(
        session_factory=sqlite_session_factory,
        credentials=StaticCredentialResolver(),
        runner_factory=RecordingIndexingRunner,
    )

    with pytest.raises(EstimateSourceNotFoundError, match="file-1"):
        gateway.estimate(
            workspace_id="workspace-1",
            actor_id="account-1",
            command=ExistingDocumentsEstimateCommand(
                dataset=_dataset(),
                documents=(_document("document-1", "upload_file", {"upload_file_id": "file-1"}),),
            ),
        )


def test_gateway_uses_automatic_rule_when_existing_documents_have_no_saved_rule(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    runner = RecordingIndexingRunner()
    gateway = IndexingRunnerEstimateGateway(
        session_factory=sqlite_session_factory,
        credentials=StaticCredentialResolver(),
        runner_factory=lambda: runner,
    )

    result = gateway.estimate(
        workspace_id="workspace-1",
        actor_id="account-1",
        command=ExistingDocumentsEstimateCommand(
            dataset=_dataset(),
            documents=(
                _document(
                    "document-1",
                    "website_crawl",
                    {
                        "provider": "firecrawl",
                        "job_id": "job-1",
                        "url": "https://example.com",
                        "mode": "crawl",
                    },
                    process_rule_id=None,
                ),
            ),
        ),
    )

    assert result.total_segments == 1
    assert runner.calls[0].process_rule == {"mode": "automatic", "rules": {}}


def test_gateway_skips_existing_document_without_source_info(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    runner_created = False

    def create_runner() -> RecordingIndexingRunner:
        nonlocal runner_created
        runner_created = True
        return RecordingIndexingRunner()

    gateway = IndexingRunnerEstimateGateway(
        session_factory=sqlite_session_factory,
        credentials=StaticCredentialResolver(),
        runner_factory=create_runner,
    )

    result = gateway.estimate(
        workspace_id="workspace-1",
        actor_id="account-1",
        command=ExistingDocumentsEstimateCommand(
            dataset=_dataset(),
            documents=(_document("document-1", "upload_file", None, process_rule_id=None),),
        ),
    )

    assert result == IndexingEstimate(total_segments=0, preview=[])
    assert runner_created is False


def test_gateway_rejects_notion_credential_without_secret(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    gateway = IndexingRunnerEstimateGateway(
        session_factory=sqlite_session_factory,
        credentials=StaticCredentialResolver(credentials={}),
        runner_factory=RecordingIndexingRunner,
    )

    with pytest.raises(EstimateSourceNotFoundError, match="credential-1"):
        gateway.estimate(
            workspace_id="workspace-1",
            actor_id="account-1",
            command=NewSourcesEstimateCommand(
                sources=(NotionEstimateSource("notion-workspace", "page-1", "page", "credential-1"),),
                process_rule={"mode": "automatic", "rules": {}},
            ),
        )


@pytest.mark.parametrize(
    ("document", "expected_message"),
    [
        (
            _document(
                "document-1",
                "notion_import",
                {
                    "credential_id": "credential-1",
                    "notion_page_id": "page-1",
                    "type": "page",
                },
            ),
            "notion_workspace_id",
        ),
        (_document("document-1", "unsupported", {"source": "value"}), "unsupported"),
    ],
)
def test_gateway_rejects_invalid_existing_document_source(
    sqlite_session_factory: sessionmaker[Session],
    document: DocumentRecord,
    expected_message: str,
) -> None:
    gateway = IndexingRunnerEstimateGateway(
        session_factory=sqlite_session_factory,
        credentials=StaticCredentialResolver(),
        runner_factory=RecordingIndexingRunner,
    )
    expected_error = (
        EstimateSourceNotFoundError if document.data_source_type == "notion_import" else UnsupportedEstimateSourceError
    )

    with pytest.raises(expected_error, match=expected_message):
        gateway.estimate(
            workspace_id="workspace-1",
            actor_id="account-1",
            command=ExistingDocumentsEstimateCommand(dataset=_dataset(), documents=(document,)),
        )


def test_gateway_rejects_missing_existing_process_rule(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    gateway = IndexingRunnerEstimateGateway(
        session_factory=sqlite_session_factory,
        credentials=StaticCredentialResolver(),
        runner_factory=RecordingIndexingRunner,
    )

    with pytest.raises(EstimateSourceNotFoundError, match="rule-1"):
        gateway.estimate(
            workspace_id="workspace-1",
            actor_id="account-1",
            command=ExistingDocumentsEstimateCommand(
                dataset=_dataset(),
                documents=(
                    _document(
                        "document-1",
                        "website_crawl",
                        {
                            "provider": "firecrawl",
                            "job_id": "job-1",
                            "url": "https://example.com",
                            "mode": "crawl",
                        },
                    ),
                ),
            ),
        )


@pytest.mark.parametrize(
    ("runner_error", "expected_error"),
    [
        (LLMBadRequestError("provider unavailable"), IndexingEstimateProviderUnavailableError),
        (ProviderTokenNotInitError("provider unavailable"), IndexingEstimateProviderUnavailableError),
        (PluginDaemonClientSideError("provider unavailable"), IndexingEstimateProviderUnavailableError),
        (RuntimeError("runner failed"), IndexingEstimateExecutionError),
    ],
)
def test_gateway_translates_runner_errors(
    sqlite_session_factory: sessionmaker[Session],
    runner_error: Exception,
    expected_error: type[Exception],
) -> None:
    runner = RecordingIndexingRunner(error=runner_error)
    gateway = IndexingRunnerEstimateGateway(
        session_factory=sqlite_session_factory,
        credentials=StaticCredentialResolver(),
        runner_factory=lambda: runner,
    )

    with pytest.raises(expected_error, match="provider unavailable|runner failed"):
        gateway.estimate(
            workspace_id="workspace-1",
            actor_id="account-1",
            command=NewSourcesEstimateCommand(
                sources=(WebsiteEstimateSource("firecrawl", "job-1", "https://example.com"),),
                process_rule={"mode": "automatic", "rules": {}},
            ),
        )
