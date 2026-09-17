"""Application dependencies shared by the Pipeline controller tests."""

import sys
from dataclasses import dataclass
from types import SimpleNamespace
from unittest.mock import create_autospec

import pytest

from core.app.apps.pipeline.pipeline_generator import PipelineGenerator
from services.credentials.query import CredentialQuery
from services.data_source.provider_service import DatasourceProviderService


@pytest.fixture(autouse=True)
def datasource_application_dependencies(monkeypatch: pytest.MonkeyPatch) -> None:
    registry = SimpleNamespace(
        data_sources=SimpleNamespace(providers=create_autospec(DatasourceProviderService, instance=True, spec_set=True))
    )
    for name in (
        "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow",
        "controllers.console.datasets.rag_pipeline.datasource_content_preview",
        "controllers.console.datasets.website",
    ):
        module = sys.modules.get(name)
        if module is not None:
            monkeypatch.setattr(module, "application_services", lambda: registry)


@dataclass(frozen=True)
class PipelineKnowledgeStub:
    pipeline_generator: PipelineGenerator


@dataclass(frozen=True)
class PipelineDataSourceStub:
    providers: DatasourceProviderService


@dataclass(frozen=True)
class PipelineApplicationStub:
    knowledge: PipelineKnowledgeStub
    credential_queries: CredentialQuery
    data_sources: PipelineDataSourceStub


@pytest.fixture
def pipeline_application(monkeypatch: pytest.MonkeyPatch) -> PipelineGenerator:
    from controllers.console.datasets.rag_pipeline import rag_pipeline_workflow as console_workflow
    from controllers.service_api.dataset.rag_pipeline import rag_pipeline_workflow as service_api_workflow

    generator = create_autospec(PipelineGenerator, instance=True, spec_set=True)
    registry = PipelineApplicationStub(
        knowledge=PipelineKnowledgeStub(pipeline_generator=generator),
        credential_queries=create_autospec(CredentialQuery, instance=True, spec_set=True),
        data_sources=PipelineDataSourceStub(
            providers=create_autospec(DatasourceProviderService, instance=True, spec_set=True)
        ),
    )
    monkeypatch.setattr(console_workflow, "application_services", lambda: registry)
    monkeypatch.setattr(service_api_workflow, "application_services", lambda: registry)
    return generator
