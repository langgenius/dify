"""Shared Console payloads for selecting Notion estimate sources."""

from pydantic import BaseModel, Field

from core.rag.extractor.entity.datasource_type import NotionPageType


class NotionEstimatePagePayload(BaseModel):
    page_id: str = Field(min_length=1)
    page_type: NotionPageType = Field(alias="type")


class NotionEstimateWorkspacePayload(BaseModel):
    workspace_id: str = Field(min_length=1)
    credential_id: str = Field(min_length=1)
    pages: list[NotionEstimatePagePayload] = Field(min_length=1)
