"""Prepare pipeline document names and metadata before opening a write transaction."""

import datetime
from collections.abc import Mapping
from typing import Any

from core.datasource.entities.datasource_entities import DatasourceProviderType
from core.rag.index_processor.constant.built_in_field import BuiltInField
from models.pipeline_execution import PipelineDocumentSeed


def prepare_pipeline_document(
    *,
    built_in_field_enabled: bool,
    datasource_type: DatasourceProviderType,
    datasource_info: Mapping[str, Any],
    uploader_name: str,
) -> PipelineDocumentSeed:
    match datasource_type:
        case DatasourceProviderType.LOCAL_FILE | DatasourceProviderType.ONLINE_DRIVE:
            name = datasource_info.get("name", "untitled")
        case DatasourceProviderType.ONLINE_DOCUMENT:
            name = datasource_info.get("page", {}).get("page_name", "untitled")
        case DatasourceProviderType.WEBSITE_CRAWL:
            name = datasource_info.get("title", "untitled")
        case _:
            raise ValueError(f"Unsupported datasource type: {datasource_type}")
    metadata: dict[str, Any] = {}
    if built_in_field_enabled:
        now = datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%d %H:%M:%S")
        metadata = {
            BuiltInField.document_name: name,
            BuiltInField.uploader: uploader_name,
            BuiltInField.upload_date: now,
            BuiltInField.last_update_date: now,
            BuiltInField.source: datasource_type,
        }
    return PipelineDocumentSeed(name, datasource_type, datasource_info, metadata)
