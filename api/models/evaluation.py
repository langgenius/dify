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
from .types import LongText, StringUUID


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


class EvaluationConfiguration(Base):
    """Stores evaluation configuration for each target (App or Snippet)."""

    __tablename__ = "evaluation_configurations"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="evaluation_configuration_pkey"),
        sa.Index("evaluation_configuration_target_idx", "tenant_id", "target_type", "target_id"),
        sa.Index("evaluation_configuration_workflow_idx", "customized_workflow_id"),
        sa.UniqueConstraint("tenant_id", "target_type", "target_id", name="evaluation_configuration_unique"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuidv7()))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    target_type: Mapped[str] = mapped_column(String(20), nullable=False)
    target_id: Mapped[str] = mapped_column(StringUUID, nullable=False)

    evaluation_model_provider: Mapped[str | None] = mapped_column(String(255), nullable=True)
    evaluation_model: Mapped[str | None] = mapped_column(String(255), nullable=True)
    metrics_config: Mapped[str | None] = mapped_column(LongText, nullable=True)
    judgement_conditions: Mapped[str | None] = mapped_column(LongText, nullable=True)
    customized_workflow_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)

    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    updated_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), onupdate=func.current_timestamp()
    )

    @property
    def metrics_config_dict(self) -> dict[str, Any]:
        if self.metrics_config:
            return json.loads(self.metrics_config)
        return {}

    @metrics_config_dict.setter
    def metrics_config_dict(self, value: dict[str, Any]) -> None:
        self.metrics_config = json.dumps(value)

    @property
    def default_metrics_list(self) -> list[dict[str, Any]]:
        """Extract default_metrics from the stored metrics_config JSON."""
        config = self.metrics_config_dict
        return config.get("default_metrics", [])

    @property
    def customized_metrics_dict(self) -> dict[str, Any] | None:
        """Extract customized_metrics from the stored metrics_config JSON."""
        config = self.metrics_config_dict
        return config.get("customized_metrics")

    @property
    def judgment_config_dict(self) -> dict[str, Any] | None:
        """Return judgment config (stored in the judgement_conditions column)."""
        if self.judgement_conditions:
            parsed = json.loads(self.judgement_conditions)
            return parsed if parsed else None
        return None

    @property
    def judgement_conditions_dict(self) -> dict[str, Any]:
        if self.judgement_conditions:
            return json.loads(self.judgement_conditions)
        return {}

    @judgement_conditions_dict.setter
    def judgement_conditions_dict(self, value: dict[str, Any]) -> None:
        self.judgement_conditions = json.dumps(value)

    def __repr__(self) -> str:
        return f"<EvaluationConfiguration(id={self.id}, target={self.target_type}:{self.target_id})>"


class EvaluationRun(Base):
    """Stores each evaluation run record."""

    __tablename__ = "evaluation_runs"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="evaluation_run_pkey"),
        sa.Index("evaluation_run_target_idx", "tenant_id", "target_type", "target_id"),
        sa.Index("evaluation_run_status_idx", "tenant_id", "status"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuidv7()))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    target_type: Mapped[str] = mapped_column(String(20), nullable=False)
    target_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    evaluation_config_id: Mapped[str] = mapped_column(StringUUID, nullable=False)

    status: Mapped[str] = mapped_column(String(20), nullable=False, default=EvaluationRunStatus.PENDING)
    dataset_file_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    result_file_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)

    total_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    celery_task_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), onupdate=func.current_timestamp()
    )

    @property
    def progress(self) -> float:
        if self.total_items == 0:
            return 0.0
        return (self.completed_items + self.failed_items) / self.total_items

    def __repr__(self) -> str:
        return f"<EvaluationRun(id={self.id}, status={self.status})>"


class EvaluationRunItem(Base):
    """Stores per-row evaluation results."""

    __tablename__ = "evaluation_run_items"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="evaluation_run_item_pkey"),
        sa.Index("evaluation_run_item_run_idx", "evaluation_run_id"),
        sa.Index("evaluation_run_item_index_idx", "evaluation_run_id", "item_index"),
        sa.Index("evaluation_run_item_workflow_run_idx", "workflow_run_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuidv7()))
    evaluation_run_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    workflow_run_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)

    item_index: Mapped[int] = mapped_column(Integer, nullable=False)
    inputs: Mapped[str | None] = mapped_column(LongText, nullable=True)
    expected_output: Mapped[str | None] = mapped_column(LongText, nullable=True)
    context: Mapped[str | None] = mapped_column(LongText, nullable=True)
    actual_output: Mapped[str | None] = mapped_column(LongText, nullable=True)

    metrics: Mapped[str | None] = mapped_column(LongText, nullable=True)
    judgment: Mapped[str | None] = mapped_column(LongText, nullable=True)
    metadata_json: Mapped[str | None] = mapped_column(LongText, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    overall_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())

    @property
    def inputs_dict(self) -> dict[str, Any]:
        if self.inputs:
            return json.loads(self.inputs)
        return {}

    @property
    def metrics_list(self) -> list[dict[str, Any]]:
        if self.metrics:
            return json.loads(self.metrics)
        return []

    @property
    def judgment_dict(self) -> dict[str, Any]:
        if self.judgment:
            return json.loads(self.judgment)
        return {}

    @property
    def metadata_dict(self) -> dict[str, Any]:
        if self.metadata_json:
            return json.loads(self.metadata_json)
        return {}

    def __repr__(self) -> str:
        return f"<EvaluationRunItem(id={self.id}, run={self.evaluation_run_id}, index={self.item_index})>"
