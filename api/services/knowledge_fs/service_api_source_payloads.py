"""Adapt legacy public import coordinates to the durable Source workflow contract."""

import json

from services.knowledge_fs.product_dto import (
    KnowledgeFSOnlineDocumentWorkflowImportItemPayload,
    KnowledgeFSOnlineDocumentWorkflowImportPayload,
    KnowledgeFSOnlineDriveWorkflowImportItemPayload,
    KnowledgeFSOnlineDriveWorkflowImportPayload,
    KnowledgeFSSourceImportFilesPayload,
    KnowledgeFSSourceImportPagesPayload,
    KnowledgeFSSourceWorkflowImportPayload,
)


def durable_page_import(payload: KnowledgeFSSourceImportPagesPayload) -> KnowledgeFSSourceWorkflowImportPayload:
    return KnowledgeFSSourceWorkflowImportPayload(
        KnowledgeFSOnlineDocumentWorkflowImportPayload(
            kind="online-document-import",
            items=[
                KnowledgeFSOnlineDocumentWorkflowImportItemPayload(
                    **page.model_dump(mode="json", by_alias=True, exclude_none=True),
                    providerItemId=json.dumps([page.workspace_id, page.page_id], separators=(",", ":")),
                )
                for page in payload.pages
            ],
        )
    )


def durable_file_import(payload: KnowledgeFSSourceImportFilesPayload) -> KnowledgeFSSourceWorkflowImportPayload:
    return KnowledgeFSSourceWorkflowImportPayload(
        KnowledgeFSOnlineDriveWorkflowImportPayload(
            kind="online-drive-import",
            items=[
                KnowledgeFSOnlineDriveWorkflowImportItemPayload(
                    **file.model_dump(mode="json", by_alias=True, exclude_none=True),
                    providerItemId=json.dumps([file.bucket or "", file.id], separators=(",", ":")),
                )
                for file in payload.files
            ],
        )
    )
