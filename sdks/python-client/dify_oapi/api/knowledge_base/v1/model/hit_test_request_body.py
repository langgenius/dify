from __future__ import annotations
from pydantic import BaseModel
from .hit_test_request_body_retrieval_model import HitTestRequestBodyRetrievalModel


class HitTestRequestBody(BaseModel):
    query: str | None = None
    retrieval_model: HitTestRequestBodyRetrievalModel | None = None
    external_retrieval_model: dict | None = None

    @staticmethod
    def builder() -> HitTestRequestBodyBuilder:
        return HitTestRequestBodyBuilder()


class HitTestRequestBodyBuilder(object):
    def __init__(self):
        self._hit_test_request_body = HitTestRequestBody()

    def build(self) -> HitTestRequestBody:
        return self._hit_test_request_body

    def query(self, query: str) -> HitTestRequestBodyBuilder:
        self._hit_test_request_body.query = query
        return self

    def retrieval_model(
        self, retrieval_model: HitTestRequestBodyRetrievalModel
    ) -> HitTestRequestBodyBuilder:
        self._hit_test_request_body.retrieval_model = retrieval_model
        return self

    def external_retrieval_model(
        self, external_retrieval_model: dict
    ) -> HitTestRequestBodyBuilder:
        self._hit_test_request_body.external_retrieval_model = external_retrieval_model
        return self
