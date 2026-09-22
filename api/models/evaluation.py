from __future__ import annotations

import json
from datetime import datetime
from enum import StrEnum
from typing import Any

import sqlalchemy as sa
from sqlalchemy import DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from libs.uuid_utils import uuidv7

from .base import Base
from .types import EnumText, LongText, StringUUID


class EvaluationRunStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class EvaluationTargetType(StrEnum):
    APPS = "apps"
    SNIPPETS = "snippets"
    KNOWLEDGE_BASE = "knowledge_base"


class EvaluationRunItemStatus(StrEnum):
    """Durable checkpoint state for one evaluation dataset row."""

    TARGET_COMPLETED = "target_completed"
    COMPLETED = "completed"


class EvaluationConfiguration(Base):
    """Latest editable evaluation configuration for a tenant-owned target."""

    __tablename__ = "evaluation_configurations"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="evaluation_configuration_pkey"),
        sa.UniqueConstraint("tenant_id", "target_type", "target_id", name="evaluation_configuration_target_unique"),
        sa.Index("evaluation_configuration_evaluator_app_idx", "tenant_id", "evaluator_app_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuidv7()))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    target_type: Mapped[EvaluationTargetType] = mapped_column(EnumText(EvaluationTargetType, length=32), nullable=False)
    target_id: Mapped[str] = mapped_column(StringUUID, nullable=False)

    evaluation_model_provider: Mapped[str | None] = mapped_column(String(255), nullable=True)
    evaluation_model: Mapped[str | None] = mapped_column(String(255), nullable=True)
    metrics_config: Mapped[str | None] = mapped_column(LongText, nullable=True)
    judgment_conditions: Mapped[str | None] = mapped_column(LongText, nullable=True)
    evaluator_app_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)

    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    updated_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
    )

    @property
    def metrics_config_dict(self) -> dict[str, Any]:
        return json.loads(self.metrics_config) if self.metrics_config else {}

    @property
    def default_metrics_list(self) -> list[dict[str, Any]]:
        return self.metrics_config_dict.get("default_metrics", [])

    @property
    def customized_metrics_dict(self) -> dict[str, Any] | None:
        return self.metrics_config_dict.get("customized_metrics")

    @property
    def judgment_config_dict(self) -> dict[str, Any] | None:
        if not self.judgment_conditions:
            return None
        value = json.loads(self.judgment_conditions)
        return value or None

    def __repr__(self) -> str:
        return f"<EvaluationConfiguration(id={self.id}, target={self.target_type}:{self.target_id})>"


class EvaluationRun(Base):
    """Immutable configuration snapshot and mutable execution state for one evaluation."""

    __tablename__ = "evaluation_runs"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="evaluation_run_pkey"),
        sa.Index("evaluation_run_target_created_idx", "tenant_id", "target_type", "target_id", "created_at"),
        sa.Index("evaluation_run_tenant_status_idx", "tenant_id", "status"),
        sa.Index("evaluation_run_status_heartbeat_idx", "status", "heartbeat_at"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuidv7()))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    target_type: Mapped[EvaluationTargetType] = mapped_column(EnumText(EvaluationTargetType, length=32), nullable=False)
    target_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    target_workflow_version_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    evaluation_config_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    config_snapshot: Mapped[str] = mapped_column(LongText, nullable=False)

    status: Mapped[EvaluationRunStatus] = mapped_column(
        EnumText(EvaluationRunStatus, length=20), nullable=False, default=EvaluationRunStatus.PENDING
    )
    dataset_file_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    result_file_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)

    total_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    progress_rate: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    metrics_summary: Mapped[str | None] = mapped_column(LongText, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    celery_task_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    execution_token: Mapped[str | None] = mapped_column(StringUUID, nullable=True)

    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
    )

    @property
    def progress(self) -> float:
        return self.progress_rate

    @property
    def metrics_summary_dict(self) -> dict[str, Any]:
        return json.loads(self.metrics_summary) if self.metrics_summary else {}

    @property
    def config_snapshot_dict(self) -> dict[str, Any]:
        return json.loads(self.config_snapshot)

    def __repr__(self) -> str:
        return f"<EvaluationRun(id={self.id}, status={self.status})>"


class EvaluationRunItem(Base):
    """Per-dataset-row result for an evaluation run."""

    __tablename__ = "evaluation_run_items"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="evaluation_run_item_pkey"),
        sa.UniqueConstraint("evaluation_run_id", "item_index", name="evaluation_run_item_run_index_unique"),
        sa.Index("evaluation_run_item_workflow_run_idx", "workflow_run_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuidv7()))
    evaluation_run_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    workflow_run_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    item_index: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[EvaluationRunItemStatus] = mapped_column(
        EnumText(EvaluationRunItemStatus, length=20),
        nullable=False,
        default=EvaluationRunItemStatus.COMPLETED,
    )

    inputs: Mapped[str | None] = mapped_column(LongText, nullable=True)
    expected_output: Mapped[str | None] = mapped_column(LongText, nullable=True)
    actual_output: Mapped[str | None] = mapped_column(LongText, nullable=True)
    metrics: Mapped[str | None] = mapped_column(LongText, nullable=True)
    judgment: Mapped[str | None] = mapped_column(LongText, nullable=True)
    metadata_json: Mapped[str | None] = mapped_column(LongText, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    overall_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())

    @property
    def inputs_dict(self) -> dict[str, Any]:
        return json.loads(self.inputs) if self.inputs else {}

    @property
    def metrics_list(self) -> list[dict[str, Any]]:
        return json.loads(self.metrics) if self.metrics else []

    @property
    def judgment_dict(self) -> dict[str, Any]:
        return json.loads(self.judgment) if self.judgment else {}

    @property
    def metadata_dict(self) -> dict[str, Any]:
        return json.loads(self.metadata_json) if self.metadata_json else {}

    def __repr__(self) -> str:
        return f"<EvaluationRunItem(id={self.id}, run={self.evaluation_run_id}, index={self.item_index})>"
