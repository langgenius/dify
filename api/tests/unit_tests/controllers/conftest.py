"""Application dependencies shared by the Pipeline controller tests."""

from dataclasses import dataclass
from unittest.mock import create_autospec

import pytest

from core.app.apps.pipeline.pipeline_generator import PipelineGenerator


@dataclass(frozen=True)
class PipelineKnowledgeStub:
    pipeline_generator: PipelineGenerator


@dataclass(frozen=True)
class PipelineApplicationStub:
    knowledge: PipelineKnowledgeStub


@pytest.fixture
def pipeline_application(monkeypatch: pytest.MonkeyPatch) -> PipelineGenerator:
    from controllers.console.datasets.rag_pipeline import rag_pipeline_workflow as console_workflow
    from controllers.service_api.dataset.rag_pipeline import rag_pipeline_workflow as service_api_workflow

    generator = create_autospec(PipelineGenerator, instance=True, spec_set=True)
    registry = PipelineApplicationStub(knowledge=PipelineKnowledgeStub(pipeline_generator=generator))
    monkeypatch.setattr(console_workflow, "application_services", lambda: registry)
    monkeypatch.setattr(service_api_workflow, "application_services", lambda: registry)
    return generator
