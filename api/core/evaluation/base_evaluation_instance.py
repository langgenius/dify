import json
import logging
from abc import ABC, abstractmethod
from collections.abc import Mapping
from typing import Any

from core.evaluation.entities.evaluation_entity import (
    EvaluationCategory,
    EvaluationItemInput,
    EvaluationItemResult,
    EvaluationMetric,
)

logger = logging.getLogger(__name__)


class BaseEvaluationInstance(ABC):
    """Abstract base class for evaluation framework adapters. """

    @abstractmethod
    def evaluate_llm(
        self,
        items: list[EvaluationItemInput],
        default_metrics: str,
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        """Evaluate LLM outputs using the configured framework."""
        ...

    @abstractmethod
    def evaluate_retrieval(
        self,
        items: list[EvaluationItemInput],
        default_metrics: str,
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        """Evaluate retrieval quality using the configured framework."""
        ...

    @abstractmethod
    def evaluate_agent(
        self,
        items: list[EvaluationItemInput],
        default_metrics: str,
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        """Evaluate agent outputs using the configured framework."""
        ...

    @abstractmethod
    def get_supported_metrics(self, category: EvaluationCategory) -> list[str]:
        """Return the list of supported metric names for a given evaluation category."""
        ...

