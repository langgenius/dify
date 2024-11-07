from __future__ import annotations
from pydantic import BaseModel
from .document_request_segmentation import DocumentRequestSegmentation
from .document_request_pre_processing_rule import DocumentRequestPreProcessingRule


class DocumentRequestRules(BaseModel):
    pre_processing_rules: list[DocumentRequestPreProcessingRule] | None = None
    segmentation: DocumentRequestSegmentation | None = None

    @staticmethod
    def builder() -> DocumentRequestRulesBuilder:
        return DocumentRequestRulesBuilder()


class DocumentRequestRulesBuilder(object):
    def __init__(self):
        self._document_request_rules = DocumentRequestRules()

    def build(self) -> DocumentRequestRules:
        return self._document_request_rules

    def pre_processing_rules(
        self, pre_processing_rules: list[DocumentRequestPreProcessingRule]
    ) -> DocumentRequestRulesBuilder:
        self._document_request_rules.pre_processing_rules = pre_processing_rules
        return self

    def segmentation(
        self, segmentation: DocumentRequestSegmentation
    ) -> DocumentRequestRulesBuilder:
        self._document_request_rules.segmentation = segmentation
        return self
