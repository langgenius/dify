"""Persistence mapping for weighted-score retrieval traces."""

from __future__ import annotations

from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy import Index, func
from sqlalchemy.orm import Mapped, mapped_column

from models.base import TypeBase

from .base import gen_uuidv7_string
from .enums import RetrievalWeightTraceStage
from .types import AdjustedJSON, EnumText, StringUUID


class RetrievalWeightTrace(TypeBase):
    """One keyword/vector weighted-score rerank performed by a knowledge-retrieval node execution.

    Rows are append-only and joined to message feedback through ``workflow_run_id``.
    ``dataset_id`` is set exactly for the ``dataset`` stage (hybrid search inside that dataset) and
    null for the ``cross_dataset`` stage (merge across the node's datasets).
    ``candidates`` is the full scored pool, each entry holding ``index_node_id``, ``document_id``,
    ``dataset_id``, ``vector_score``, ``keyword_score``, ``final_score`` and ``selected_rank``.
    """

    __tablename__ = "retrieval_weight_traces"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="retrieval_weight_traces_pkey"),
        sa.CheckConstraint(
            "(stage = 'dataset' AND dataset_id IS NOT NULL) OR (stage = 'cross_dataset' AND dataset_id IS NULL)",
            name="retrieval_weight_traces_stage_dataset_ck",
        ),
        Index("retrieval_weight_traces_run_idx", "tenant_id", "app_id", "workflow_run_id"),
        Index("retrieval_weight_traces_created_at_idx", "created_at"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default_factory=gen_uuidv7_string, init=False)
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    workflow_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    workflow_run_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    node_id: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    stage: Mapped[RetrievalWeightTraceStage] = mapped_column(
        EnumText(RetrievalWeightTraceStage, length=32), nullable=False
    )
    dataset_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    vector_weight: Mapped[float] = mapped_column(sa.Float, nullable=False)
    keyword_weight: Mapped[float] = mapped_column(sa.Float, nullable=False)
    embedding_provider_name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    embedding_model_name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    score_threshold: Mapped[float | None] = mapped_column(sa.Float, nullable=True)
    top_n: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    candidates: Mapped[list[dict[str, Any]]] = mapped_column(AdjustedJSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
