"""Materialized inputs and results for converting a basic app into a workflow."""

from dataclasses import dataclass
from typing import Any

from models.model import AppMode, AppModelConfigDict


@dataclass(frozen=True)
class WorkflowConversionSource:
    id: str
    tenant_id: str
    mode: AppMode
    name: str
    icon_type: str | None
    icon: str | None
    icon_background: str | None
    enable_site: bool
    enable_api: bool
    api_rpm: int
    api_rph: int
    is_public: bool
    # Missing or foreign config references produce None; the use case rejects conversion.
    model_config_id: str | None
    model_config: AppModelConfigDict | None


@dataclass(frozen=True)
class ConversionExtension:
    id: str
    name: str
    api_endpoint: str
    api_key: str


@dataclass(frozen=True)
class ConvertedWorkflow:
    mode: AppMode
    graph: dict[str, Any]
    features: dict[str, Any]
