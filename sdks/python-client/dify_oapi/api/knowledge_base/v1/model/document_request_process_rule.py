from __future__ import annotations

from typing import Literal

from pydantic import BaseModel
from .document_request_rules import DocumentRequestRules


class DocumentRequestProcessRule(BaseModel):
    mode: str | None = None
    rules: DocumentRequestRules | None = None

    @staticmethod
    def builder() -> DocumentRequestProcessRuleBuilder:
        return DocumentRequestProcessRuleBuilder()


class DocumentRequestProcessRuleBuilder(object):
    def __init__(self):
        self._document_request_process_rule = DocumentRequestProcessRule()

    def build(self) -> DocumentRequestProcessRule:
        return self._document_request_process_rule

    def mode(
        self, mode: Literal["automatic", "custom"]
    ) -> DocumentRequestProcessRuleBuilder:
        self._document_request_process_rule.mode = mode
        return self

    def rules(self, rules: DocumentRequestRules) -> DocumentRequestProcessRuleBuilder:
        self._document_request_process_rule.rules = rules
        return self
