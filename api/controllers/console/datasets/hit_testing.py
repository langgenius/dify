from __future__ import annotations

from datetime import datetime
from typing import Any

from flask_restx import Resource
from pydantic import Field, field_validator

from controllers.common.schema import register_schema_models
from fields.base import ResponseModel
from libs.helper import to_timestamp
from libs.login import login_required

from .. import console_ns
from ..datasets.hit_testing_base import DatasetsHitTestingBase, HitTestingPayload
from ..wraps import (
    account_initialization_required,
    cloud_edition_billing_rate_limit_check,
    setup_required,
)


class HitTestingDocument(ResponseModel):
    id: str | None = None
    data_source_type: str | None = None
    name: str | None = None
    doc_type: str | None = None
    doc_metadata: Any | None = None


class HitTestingSegment(ResponseModel):
    id: str | None = None
    position: int | None = None
    document_id: str | None = None
    content: str | None = None
    sign_content: str | None = None
    answer: str | None = None
    word_count: int | None = None
    tokens: int | None = None
    keywords: list[str] = Field(default_factory=list)
    index_node_id: str | None = None
    index_node_hash: str | None = None
    hit_count: int | None = None
    enabled: bool | None = None
    disabled_at: int | None = None
    disabled_by: str | None = None
    status: str | None = None
    created_by: str | None = None
    created_at: int | None = None
    indexing_at: int | None = None
    completed_at: int | None = None
    error: str | None = None
    stopped_at: int | None = None
    document: HitTestingDocument | None = None

    @field_validator("disabled_at", "created_at", "indexing_at", "completed_at", "stopped_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class HitTestingChildChunk(ResponseModel):
    id: str | None = None
    content: str | None = None
    position: int | None = None
    score: float | None = None


class HitTestingFile(ResponseModel):
    id: str | None = None
    name: str | None = None
    size: int | None = None
    extension: str | None = None
    mime_type: str | None = None
    source_url: str | None = None


class HitTestingRecord(ResponseModel):
    segment: HitTestingSegment | None = None
    child_chunks: list[HitTestingChildChunk] = Field(default_factory=list)
    score: float | None = None
    tsne_position: Any | None = None
    files: list[HitTestingFile] = Field(default_factory=list)
    summary: str | None = None


class HitTestingResponse(ResponseModel):
    query: str
    records: list[HitTestingRecord] = Field(default_factory=list)


register_schema_models(
    console_ns,
    HitTestingPayload,
    HitTestingDocument,
    HitTestingSegment,
    HitTestingChildChunk,
    HitTestingFile,
    HitTestingRecord,
    HitTestingResponse,
)


@console_ns.route("/datasets/<uuid:dataset_id>/hit-testing")
class HitTestingApi(Resource, DatasetsHitTestingBase):
    @console_ns.doc("test_dataset_retrieval")
    @console_ns.doc(description="Test dataset knowledge retrieval")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.expect(console_ns.models[HitTestingPayload.__name__])
    @console_ns.response(
        200,
        "Hit testing completed successfully",
        model=console_ns.models[HitTestingResponse.__name__],
    )
    @console_ns.response(404, "Dataset not found")
    @console_ns.response(400, "Invalid parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    def post(self, dataset_id):
        dataset_id_str = str(dataset_id)

        dataset = self.get_and_validate_dataset(dataset_id_str)
        payload = HitTestingPayload.model_validate(console_ns.payload or {})
        args = payload.model_dump(exclude_none=True)
        self.hit_testing_args_check(args)

        return HitTestingResponse.model_validate(self.perform_hit_testing(dataset, args)).model_dump(mode="json")
