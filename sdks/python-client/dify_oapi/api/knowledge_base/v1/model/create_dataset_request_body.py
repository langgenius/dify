from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class CreateDatasetRequestBody(BaseModel):
    name: str | None = None
    description: str | None = None
    indexing_technique: str | None = None
    permission: str | None = None
    provider: str | None = None
    external_knowledge_api_id: str | None = None
    external_knowledge_id: int | None = None

    @staticmethod
    def builder() -> CreateDatasetRequestBodyBuilder:
        return CreateDatasetRequestBodyBuilder()


class CreateDatasetRequestBodyBuilder(object):
    def __init__(self):
        self._create_dataset_request_body = CreateDatasetRequestBody()

    def build(self) -> CreateDatasetRequestBody:
        return self._create_dataset_request_body

    def name(self, name: str) -> CreateDatasetRequestBodyBuilder:
        self._create_dataset_request_body.name = name
        return self

    def description(self, description: str) -> CreateDatasetRequestBodyBuilder:
        self._create_dataset_request_body.description = description
        return self

    def indexing_technique(
        self, indexing_technique: Literal["high_quality", "economy"]
    ) -> CreateDatasetRequestBodyBuilder:
        self._create_dataset_request_body.indexing_technique = indexing_technique
        return self

    def permission(
        self, permission: Literal["only_me", "all_team_members", "partial_members"]
    ) -> CreateDatasetRequestBodyBuilder:
        self._create_dataset_request_body.permission = permission
        return self

    def provider(
        self, provider: Literal["vendor", "external"]
    ) -> CreateDatasetRequestBodyBuilder:
        self._create_dataset_request_body.provider = provider
        return self

    def external_knowledge_api_id(self, value: str) -> CreateDatasetRequestBodyBuilder:
        self._create_dataset_request_body.external_knowledge_api_id = value
        return self

    def external_knowledge_id(
        self, external_knowledge_id: int
    ) -> CreateDatasetRequestBodyBuilder:
        self._create_dataset_request_body.external_knowledge_id = external_knowledge_id
        return self
