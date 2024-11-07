from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class DocumentRequestPreProcessingRule(BaseModel):
    id: str | None = None
    enabled: bool | None = None

    @staticmethod
    def builder() -> DocumentRequestPreProcessingRuleBuilder:
        return DocumentRequestPreProcessingRuleBuilder()


class DocumentRequestPreProcessingRuleBuilder(object):
    def __init__(self):
        self._document_request_pre_processing_rule = DocumentRequestPreProcessingRule()

    def build(self) -> DocumentRequestPreProcessingRule:
        return self._document_request_pre_processing_rule

    def id(
        self, id_: Literal["remove_extra_spaces", "remove_urls_emails"]
    ) -> DocumentRequestPreProcessingRuleBuilder:
        self._document_request_pre_processing_rule.id = id_
        return self

    def enabled(self, enabled: bool) -> DocumentRequestPreProcessingRuleBuilder:
        self._document_request_pre_processing_rule.enabled = enabled
        return self
