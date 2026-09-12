"""Datasource-specific extraction input resolvers."""

from collections.abc import Mapping, Sequence
from typing import Protocol

from configs import dify_config
from core.rag.entities.extraction import (
    ExtractSetting,
    NotionInfo,
    UploadFileExtractionInput,
    WebsiteInfo,
)
from core.rag.extractor.entity.datasource_type import DatasourceType, NotionPageType
from core.rag.extractor.notion_credentials import (
    NotionCredentialUnavailableError,
    resolve_stored_notion_access_token,
)
from services.data_source.credential_gateway import (
    ActorDatasourceCredentialResolver,
    StoredDatasourceCredentialResolver,
)
from services.knowledge.indexing.errors import (
    IndexingInputSourceError,
    SourceCredentialUnavailableError,
    UnsupportedStoredSourceError,
)
from services.knowledge.indexing.estimate import StoredSource

_NOTION_PROVIDER = "notion_datasource"
_NOTION_PLUGIN = "langgenius/notion_datasource"


class StoredSourceAdapter(Protocol):
    """Resolve one persisted datasource kind."""

    def resolve(self, source: StoredSource) -> ExtractSetting: ...


class KnowledgeUploadCatalog(Protocol):
    def get_by_ids(self, *, workspace_id: str, file_ids: Sequence[str]) -> Mapping[str, UploadFileExtractionInput]: ...


class FileSourceAdapter:
    def __init__(self, *, uploads: KnowledgeUploadCatalog) -> None:
        self._uploads = uploads

    def resolve(self, source: StoredSource) -> ExtractSetting:
        info = _required_info(source, "no upload file found")
        file_id = _required_string(info, "upload_file_id", "no upload file found")
        return self.resolve_selection(
            workspace_id=source.document_ref.dataset.tenant_id,
            file_id=file_id,
            document_model=source.document_model,
        )

    def resolve_selection(
        self,
        *,
        workspace_id: str,
        file_id: str,
        document_model: str,
    ) -> ExtractSetting:
        return self.resolve_selections(workspace_id=workspace_id, file_ids=(file_id,), document_model=document_model)[
            file_id
        ]

    def resolve_selections(
        self, *, workspace_id: str, file_ids: Sequence[str], document_model: str
    ) -> dict[str, ExtractSetting]:
        if not file_ids:
            return {}
        uploads = self._uploads.get_by_ids(workspace_id=workspace_id, file_ids=file_ids)
        settings: dict[str, ExtractSetting] = {}
        for file_id in file_ids:
            upload = uploads.get(file_id)
            if upload is None:
                raise IndexingInputSourceError(f"no upload file found: {file_id}")
            settings[file_id] = ExtractSetting(
                datasource_type=DatasourceType.FILE, upload_file=upload, document_model=document_model
            )
        return settings


class WebsiteSourceAdapter:
    def resolve(self, source: StoredSource) -> ExtractSetting:
        info = _required_info(source, "no website crawl info found")
        return self.resolve_selection(
            workspace_id=source.document_ref.dataset.tenant_id,
            provider=_required_string(info, "provider"),
            job_id=_required_string(info, "job_id"),
            url=_required_string(info, "url"),
            mode=_required_string(info, "mode"),
            only_main_content=bool(info.get("only_main_content", False)),
            document_model=source.document_model,
        )

    def resolve_selection(
        self,
        *,
        workspace_id: str,
        provider: str,
        job_id: str,
        url: str,
        mode: str,
        only_main_content: bool,
        document_model: str,
    ) -> ExtractSetting:
        return ExtractSetting(
            datasource_type=DatasourceType.WEBSITE,
            website_info=WebsiteInfo(
                provider=provider,
                job_id=job_id,
                url=url,
                mode=mode,
                tenant_id=workspace_id,
                only_main_content=only_main_content,
            ),
            document_model=document_model,
        )


class NotionSourceResolver:
    """Resolve actor-selected and trusted-stored Notion extraction inputs."""

    def __init__(
        self,
        *,
        actor_credentials: ActorDatasourceCredentialResolver,
        stored_credentials: StoredDatasourceCredentialResolver,
        integration_token: str | None = None,
    ) -> None:
        self._actor_credentials = actor_credentials
        self._stored_credentials = stored_credentials
        self._integration_token = integration_token

    def resolve(self, source: StoredSource) -> ExtractSetting:
        info = _required_info(source, "no notion import info found")
        document_ref = source.document_ref
        credential_id = _string_value(info, "credential_id")
        token = self._stored_token(source, credential_id)
        return self._prepared(
            tenant_id=document_ref.dataset.tenant_id,
            notion_workspace_id=_required_string(info, "notion_workspace_id"),
            page_id=_required_string(info, "notion_page_id"),
            page_type=_notion_page_type(info),
            document_model=source.document_model,
            credential_id=credential_id,
            token=token,
        )

    def _stored_token(self, source: StoredSource, credential_id: str | None) -> str:
        document_ref = source.document_ref

        def load_token(saved_id: str) -> str:
            credentials = self._stored_credentials.resolve_for_document(
                workspace_id=document_ref.dataset.tenant_id,
                dataset_id=document_ref.dataset.dataset_id,
                document_id=document_ref.document_id,
                credential_id=saved_id,
                provider=_NOTION_PROVIDER,
                plugin_id=_NOTION_PLUGIN,
            )
            return self._required_token(credentials)

        try:
            return resolve_stored_notion_access_token(
                credential_id=credential_id,
                load_token=load_token,
                integration_token=self._integration_token or dify_config.NOTION_INTEGRATION_TOKEN,
            )
        except NotionCredentialUnavailableError as error:
            raise SourceCredentialUnavailableError("Notion credential is unavailable") from error

    def resolve_selection(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
        notion_workspace_id: str,
        page_id: str,
        page_type: NotionPageType,
        document_model: str,
    ) -> ExtractSetting:
        credentials = self._actor_credentials.resolve(
            workspace_id=workspace_id,
            actor_id=actor_id,
            credential_id=credential_id,
            provider=_NOTION_PROVIDER,
            plugin_id=_NOTION_PLUGIN,
        )
        return self._prepared(
            tenant_id=workspace_id,
            notion_workspace_id=notion_workspace_id,
            page_id=page_id,
            page_type=page_type,
            document_model=document_model,
            credential_id=credential_id,
            token=self._required_token(credentials),
        )

    def _prepared(
        self,
        *,
        tenant_id: str,
        notion_workspace_id: str,
        page_id: str,
        page_type: NotionPageType,
        document_model: str,
        credential_id: str | None,
        token: str,
    ) -> ExtractSetting:
        return ExtractSetting(
            datasource_type=DatasourceType.NOTION,
            notion_info=NotionInfo(
                credential_id=credential_id,
                notion_workspace_id=notion_workspace_id,
                notion_obj_id=page_id,
                notion_page_type=page_type.value,
                tenant_id=tenant_id,
                notion_access_token=token,
            ),
            document_model=document_model,
        )

    @staticmethod
    def _required_token(credentials: Mapping[str, object]) -> str:
        token = credentials.get("integration_secret")
        if isinstance(token, str) and token:
            return token
        raise SourceCredentialUnavailableError("Notion credential is unavailable")


class CompositeStoredSourceResolver:
    """Route persisted sources to datasource-specific adapters."""

    def __init__(self, *, adapters: Mapping[str, StoredSourceAdapter]) -> None:
        self._adapters = dict(adapters)

    def resolve(self, source: StoredSource) -> ExtractSetting:
        adapter = self._adapters.get(source.source_type)
        if adapter is None:
            raise UnsupportedStoredSourceError(source.source_type)
        return adapter.resolve(source)


def _required_info(source: StoredSource, message: str) -> Mapping[str, object]:
    if source.source_info is None:
        raise IndexingInputSourceError(message)
    return source.source_info


def _string_value(info: Mapping[str, object], key: str) -> str | None:
    value = info.get(key)
    return value if isinstance(value, str) and value else None


def _required_string(info: Mapping[str, object], key: str, message: str | None = None) -> str:
    value = _string_value(info, key)
    if value is None:
        raise IndexingInputSourceError(message or f"invalid data source field: {key}")
    return value


def _notion_page_type(info: Mapping[str, object]) -> NotionPageType:
    value = _required_string(info, "type")
    try:
        return NotionPageType(value)
    except ValueError as error:
        raise IndexingInputSourceError("invalid data source field: type") from error
