"""Infrastructure adapters for knowledge application services."""

import json
from collections.abc import Callable, Mapping
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.entities.knowledge_entities import IndexingEstimate
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.indexing_runner import IndexingRunner
from core.plugin.impl.exc import PluginDaemonClientSideError
from core.rag.extractor.entity.datasource_type import DatasourceType
from core.rag.extractor.entity.extract_setting import ExtractSetting, NotionInfo, WebsiteInfo
from models.dataset import DatasetProcessRule
from models.model import UploadFile
from services.entities.knowledge_entities.indexing_estimate import (
    EstimateCommand,
    ExistingDocumentsEstimateCommand,
    NewSourcesEstimateCommand,
    NotionEstimateSource,
    UploadFileEstimateSource,
    WebsiteEstimateSource,
)
from services.entities.knowledge_entities.records import DocumentRecord
from tasks.document_indexing_sync_task import document_indexing_sync_task

_NOTION_PROVIDER = "notion_datasource"
_NOTION_PLUGIN = "langgenius/notion_datasource"


class CeleryDocumentSyncDispatcher:
    def __init__(self, delay: Callable[[str, str], object] | None = None) -> None:
        self._delay = delay or document_indexing_sync_task.delay

    def dispatch(self, *, dataset_id: str, document_id: str) -> None:
        self._delay(dataset_id, document_id)


class _EstimateRunner(Protocol):
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
    ) -> IndexingEstimate: ...


class _CredentialResolver(Protocol):
    def resolve(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
        provider: str,
        plugin_id: str,
    ) -> dict[str, object]: ...


class IndexingEstimateAdapterError(Exception):
    """Base class for failures produced by the estimate infrastructure adapter."""


class EstimateSourceNotFoundError(IndexingEstimateAdapterError):
    def __init__(self, source_id: str) -> None:
        super().__init__(f"Estimate source not found: {source_id}")


class UnsupportedEstimateSourceError(IndexingEstimateAdapterError):
    def __init__(self, source_type: str) -> None:
        super().__init__(f"Data source type not supported: {source_type}")


class IndexingEstimateProviderUnavailableError(IndexingEstimateAdapterError):
    """Raised when a configured model or plugin credential is unavailable."""


class IndexingEstimateExecutionError(IndexingEstimateAdapterError):
    """Raised when the existing runner cannot complete an estimate."""


class IndexingRunnerEstimateGateway:
    """Keep the runner's caller-owned Session requirement inside one adapter."""

    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        credentials: _CredentialResolver,
        runner_factory: Callable[[], _EstimateRunner] = IndexingRunner,
    ) -> None:
        self._session_factory = session_factory
        self._credentials = credentials
        self._runner_factory = runner_factory

    def estimate(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        command: EstimateCommand,
    ) -> IndexingEstimate:
        notion_tokens = self._resolve_notion_tokens(
            workspace_id=workspace_id,
            actor_id=actor_id,
            command=command,
        )
        with self._session_factory() as session:
            if isinstance(command, NewSourcesEstimateCommand):
                extract_settings = self._new_source_settings(session, workspace_id, command, notion_tokens)
                process_rule = command.process_rule
                doc_form = command.doc_form
                doc_language = command.doc_language
                dataset_id = command.dataset_id
                indexing_technique = command.indexing_technique
            else:
                extract_settings = self._document_settings(
                    session,
                    workspace_id,
                    command.documents,
                    notion_tokens,
                )
                process_rule = self._load_process_rule(session, command)
                first_document = command.documents[0] if command.documents else None
                doc_form = first_document.doc_form if first_document else "text_model"
                doc_language = first_document.doc_language or "English" if first_document else "English"
                dataset_id = command.dataset.id
                indexing_technique = command.dataset.indexing_technique or "economy"

            if not extract_settings:
                return IndexingEstimate(total_segments=0, preview=[])

            try:
                return self._runner_factory().indexing_estimate(
                    tenant_id=workspace_id,
                    extract_settings=extract_settings,
                    tmp_processing_rule=process_rule,
                    doc_form=doc_form,
                    doc_language=doc_language,
                    dataset_id=dataset_id,
                    indexing_technique=indexing_technique,
                    session=session,
                )
            except (LLMBadRequestError, ProviderTokenNotInitError, PluginDaemonClientSideError) as error:
                description = getattr(error, "description", str(error))
                raise IndexingEstimateProviderUnavailableError(description) from error
            except Exception as error:
                raise IndexingEstimateExecutionError(str(error)) from error

    @staticmethod
    def _new_source_settings(
        session: Session,
        workspace_id: str,
        command: NewSourcesEstimateCommand,
        notion_tokens: Mapping[str, str],
    ) -> list[ExtractSetting]:
        file_ids = tuple(source.file_id for source in command.sources if isinstance(source, UploadFileEstimateSource))
        files_by_id: dict[str, UploadFile] = {}
        if file_ids:
            files = session.scalars(
                select(UploadFile).where(UploadFile.tenant_id == workspace_id, UploadFile.id.in_(file_ids))
            ).all()
            files_by_id = {file.id: file for file in files}

        settings: list[ExtractSetting] = []
        for source in command.sources:
            if isinstance(source, UploadFileEstimateSource):
                upload_file = files_by_id.get(source.file_id)
                if upload_file is None:
                    raise EstimateSourceNotFoundError(source.file_id)
                settings.append(
                    ExtractSetting(
                        datasource_type=DatasourceType.FILE,
                        upload_file=upload_file,
                        document_model=command.doc_form,
                    )
                )
            elif isinstance(source, NotionEstimateSource):
                settings.append(
                    ExtractSetting(
                        datasource_type=DatasourceType.NOTION,
                        notion_info=NotionInfo(
                            credential_id=source.credential_id,
                            notion_workspace_id=source.workspace_id,
                            notion_obj_id=source.page_id,
                            notion_page_type=source.page_type,
                            tenant_id=workspace_id,
                            notion_access_token=notion_tokens[source.credential_id],
                        ),
                        document_model=command.doc_form,
                    )
                )
            elif isinstance(source, WebsiteEstimateSource):
                settings.append(
                    ExtractSetting(
                        datasource_type=DatasourceType.WEBSITE,
                        website_info=WebsiteInfo(
                            provider=source.provider,
                            job_id=source.job_id,
                            url=source.url,
                            mode=source.mode,
                            tenant_id=workspace_id,
                            only_main_content=source.only_main_content,
                        ),
                        document_model=command.doc_form,
                    )
                )
        return settings

    def _document_settings(
        self,
        session: Session,
        workspace_id: str,
        documents: tuple[DocumentRecord, ...],
        notion_tokens: Mapping[str, str],
    ) -> list[ExtractSetting]:
        upload_ids = tuple(
            source_id
            for document in documents
            if document.data_source_type == "upload_file"
            if (source_id := self._string_value(document.data_source_info, "upload_file_id")) is not None
        )
        files_by_id: dict[str, UploadFile] = {}
        if upload_ids:
            files = session.scalars(
                select(UploadFile).where(UploadFile.tenant_id == workspace_id, UploadFile.id.in_(upload_ids))
            ).all()
            files_by_id = {file.id: file for file in files}

        settings: list[ExtractSetting] = []
        for document in documents:
            info = document.data_source_info
            if not info:
                continue
            match document.data_source_type:
                case "upload_file":
                    file_id = self._required_string(info, "upload_file_id")
                    upload_file = files_by_id.get(file_id)
                    if upload_file is None:
                        raise EstimateSourceNotFoundError(file_id)
                    settings.append(
                        ExtractSetting(
                            datasource_type=DatasourceType.FILE,
                            upload_file=upload_file,
                            document_model=document.doc_form,
                        )
                    )
                case "notion_import":
                    credential_id = self._required_string(info, "credential_id")
                    settings.append(
                        ExtractSetting(
                            datasource_type=DatasourceType.NOTION,
                            notion_info=NotionInfo(
                                credential_id=credential_id,
                                notion_workspace_id=self._required_string(info, "notion_workspace_id"),
                                notion_obj_id=self._required_string(info, "notion_page_id"),
                                notion_page_type=self._required_string(info, "type"),
                                tenant_id=workspace_id,
                                notion_access_token=notion_tokens[credential_id],
                            ),
                            document_model=document.doc_form,
                        )
                    )
                case "website_crawl":
                    settings.append(
                        ExtractSetting(
                            datasource_type=DatasourceType.WEBSITE,
                            website_info=WebsiteInfo(
                                provider=self._required_string(info, "provider"),
                                job_id=self._required_string(info, "job_id"),
                                url=self._required_string(info, "url"),
                                mode=self._required_string(info, "mode"),
                                tenant_id=workspace_id,
                                only_main_content=bool(info.get("only_main_content", False)),
                            ),
                            document_model=document.doc_form,
                        )
                    )
                case _:
                    raise UnsupportedEstimateSourceError(document.data_source_type)
        return settings

    def _resolve_notion_tokens(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        command: EstimateCommand,
    ) -> dict[str, str]:
        if isinstance(command, NewSourcesEstimateCommand):
            credential_ids = tuple(
                dict.fromkeys(
                    source.credential_id for source in command.sources if isinstance(source, NotionEstimateSource)
                )
            )
        else:
            credential_ids = tuple(
                dict.fromkeys(
                    self._required_string(document.data_source_info or {}, "credential_id")
                    for document in command.documents
                    if document.data_source_type == "notion_import"
                )
            )

        tokens: dict[str, str] = {}
        for credential_id in credential_ids:
            credentials = self._credentials.resolve(
                workspace_id=workspace_id,
                actor_id=actor_id,
                credential_id=credential_id,
                provider=_NOTION_PROVIDER,
                plugin_id=_NOTION_PLUGIN,
            )
            integration_secret = credentials.get("integration_secret")
            if not isinstance(integration_secret, str) or not integration_secret:
                raise EstimateSourceNotFoundError(credential_id)
            tokens[credential_id] = integration_secret
        return tokens

    @staticmethod
    def _load_process_rule(
        session: Session,
        command: ExistingDocumentsEstimateCommand,
    ) -> Mapping[str, object]:
        process_rule_id = next(
            (document.dataset_process_rule_id for document in command.documents if document.dataset_process_rule_id),
            None,
        )
        if process_rule_id is None:
            return {"mode": "automatic", "rules": {}}
        process_rule = session.scalar(
            select(DatasetProcessRule)
            .where(
                DatasetProcessRule.id == process_rule_id,
                DatasetProcessRule.dataset_id == command.dataset.id,
            )
            .limit(1)
        )
        if process_rule is None:
            raise EstimateSourceNotFoundError(process_rule_id)
        rules = json.loads(process_rule.rules) if process_rule.rules else {}
        return {"mode": str(process_rule.mode), "rules": rules}

    @staticmethod
    def _string_value(info: Mapping[str, object] | None, key: str) -> str | None:
        if info is None:
            return None
        value = info.get(key)
        return value if isinstance(value, str) and value else None

    @classmethod
    def _required_string(cls, info: Mapping[str, object], key: str) -> str:
        value = cls._string_value(info, key)
        if value is None:
            raise EstimateSourceNotFoundError(key)
        return value
