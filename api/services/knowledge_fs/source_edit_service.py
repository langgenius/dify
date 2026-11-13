"""Source edit orchestration shared by KnowledgeFS entry points.

A Source edit either applies one atomic metadata/sync-policy update, or, when
the selected content changed, disables the Source and commits a re-import that
carries the remaining configuration through the import workflow.
"""

from __future__ import annotations

from collections import Counter
from hashlib import sha256

from services.knowledge_fs.data_facade import KnowledgeFSDataFacade
from services.knowledge_fs.product_dto import (
    KnowledgeFSAsyncSourceImportPayload,
    KnowledgeFSAtomicSourceUpdatePayload,
    KnowledgeFSSourceImportConfigurationPayload,
    KnowledgeFSSourceResponse,
    KnowledgeFSSourceUpdatePayload,
    normalize_knowledge_fs_source_url,
)
from services.knowledge_fs.product_remote import KnowledgeFSProductResourceNotFoundError
from services.knowledge_fs.source_import_commit_service import commit_source_import

_IMPORT_KIND_BY_SELECTION_KIND = {
    "website_crawl": "website-crawl-import",
    "online_document": "online-document-import",
    "online_drive": "online-drive-import",
}


def source_edit_requires_import(source: KnowledgeFSSourceResponse, payload: KnowledgeFSSourceUpdatePayload) -> bool:
    """Return whether the edit changes imported content and must run a new import."""

    selection = payload.selection
    if selection is None:
        return False
    provider_kind = source.metadata.get("providerKind")
    configured_kind = "website_crawl" if source.type == "web" else None
    if isinstance(provider_kind, str):
        configured_kind = {"online-document": "online_document", "online-drive": "online_drive"}.get(provider_kind)
    if configured_kind is not None and selection.kind != configured_kind:
        raise ValueError("Source selection kind cannot be changed")
    if source.status == "error":
        return True
    if payload.uri is not None and payload.uri != source.uri:
        return True
    if payload.provider_parameters is not None and payload.provider_parameters != source.metadata.get("parameters"):
        return True
    if payload.metadata is not None and any(
        key != "syncPolicy" and value != source.metadata.get(key) for key, value in payload.metadata.items()
    ):
        return True
    if selection.kind == "website_crawl":
        website_selection = source.metadata.get("__knowledgeFsWebsiteSelection")
        frozen_urls = (
            website_selection.get("sourceUrls")
            if isinstance(website_selection, dict) and website_selection.get("version") == 1
            else None
        )
        initial_preview = source.metadata.get("initialPreview")
        initial_urls = (
            initial_preview.get("canonicalSourceUrls") or initial_preview.get("requestedSourceUrls")
            if isinstance(initial_preview, dict)
            else None
        )
        crawled = source.metadata.get("crawled")
        current_urls = (
            Counter(normalize_knowledge_fs_source_url(url) for url in frozen_urls)
            if isinstance(frozen_urls, list) and all(isinstance(url, str) for url in frozen_urls)
            else Counter(normalize_knowledge_fs_source_url(url) for url in initial_urls)
            if isinstance(initial_urls, list) and all(isinstance(url, str) for url in initial_urls)
            else Counter(normalize_knowledge_fs_source_url(url) for url in crawled)
            if isinstance(crawled, dict)
            else Counter[str]()
        )
        selected_urls = Counter(normalize_knowledge_fs_source_url(url) for url in selection.source_urls)
        return selected_urls != current_urls

    marker = source.metadata.get("__knowledgeFsProviderSelection")
    current_hashes = (
        set(marker.get("identityHashes", ()))
        if isinstance(marker, dict) and isinstance(marker.get("identityHashes"), list)
        else set()
    )
    provider_kind = "online-document" if selection.kind == "online_document" else "online-drive"
    selected_hashes = {
        sha256(f"{provider_kind}\0{item.provider_item_id}".encode()).hexdigest() for item in selection.items
    }
    return selected_hashes != current_hashes


def edit_source(
    *,
    facade: KnowledgeFSDataFacade,
    tenant_id: str,
    account_id: str,
    control_space_id: str,
    source_id: str,
    payload: KnowledgeFSSourceUpdatePayload,
) -> KnowledgeFSSourceResponse:
    """Apply a Source edit, starting a re-import when the selection changed.

    When an import is started, the returned Source carries it in ``sync_workflow``.
    """

    selection = payload.selection
    desired_sync_policy = payload.sync_policy
    current_source = (
        facade.get_source(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            source_id=source_id,
        )
        if selection is not None or desired_sync_policy is not None
        else None
    )
    requires_import = current_source is not None and source_edit_requires_import(current_source, payload)
    source_metadata = payload.metadata
    if requires_import and selection is not None and selection.kind != "website_crawl":
        source_metadata = {**(source_metadata or {}), "__knowledgeFsProviderSelection": None}
    expected_policy_revision = None
    if desired_sync_policy is not None and not requires_import:
        try:
            current_policy = facade.get_source_sync_policy(
                tenant_id=tenant_id,
                account_id=account_id,
                control_space_id=control_space_id,
                source_id=source_id,
            )
            expected_policy_revision = current_policy.revision
        except KnowledgeFSProductResourceNotFoundError:
            expected_policy_revision = 0
    source_payload = KnowledgeFSAtomicSourceUpdatePayload.model_validate(
        payload.model_dump(mode="json", by_alias=True, exclude_none=True)
    ).model_copy(
        update={
            "metadata": source_metadata,
            "selection": None,
            "sync_policy": None if requires_import else desired_sync_policy,
            "expected_policy_revision": expected_policy_revision,
            "expected_version": payload.expected_version or (current_source.version if current_source else None),
            **({"status": "disabled", "sync_after_update": False} if requires_import else {}),
        }
    )
    has_source_update = any(
        value is not None
        for value in (
            source_payload.metadata,
            source_payload.name,
            source_payload.provider_parameters,
            source_payload.sync_policy,
            source_payload.status,
            source_payload.uri,
        )
    )
    if requires_import:
        assert current_source is not None
        result = current_source
    elif has_source_update:
        result = facade.update_source(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            source_id=source_id,
            payload=source_payload,
        )
    else:
        result = facade.get_source(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            source_id=source_id,
        )

    if requires_import and selection is not None:
        if desired_sync_policy is None:
            raise ValueError("syncPolicy is required when selection is provided")
        import_payload = KnowledgeFSAsyncSourceImportPayload.model_validate(
            {
                **selection.model_dump(mode="json", by_alias=True),
                "kind": _IMPORT_KIND_BY_SELECTION_KIND[selection.kind],
                "syncPolicy": desired_sync_policy.model_dump(mode="json", by_alias=True),
            }
        ).root
        workflow = commit_source_import(
            facade=facade,
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            source_id=source_id,
            payload=import_payload,
            idempotency_key=f"source-edit:{source_id}:{source_payload.expected_version}",
            source_update=KnowledgeFSSourceImportConfigurationPayload.model_validate(
                source_payload.model_dump(
                    mode="json",
                    by_alias=True,
                    exclude_none=True,
                    exclude={"selection", "sync_policy", "sync_after_update", "expected_policy_revision"},
                )
            ),
        )
        result = facade.get_source(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            source_id=source_id,
        )
        result.sync_workflow = workflow
    return result


__all__ = ["edit_source", "source_edit_requires_import"]
