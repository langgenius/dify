from collections.abc import Callable
from unittest.mock import create_autospec

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from services.knowledge.pipeline_templates.adapters import PipelineTemplateCatalogAdapter
from services.rag_pipeline.pipeline_template.built_in.built_in_retrieval import BuiltInPipelineTemplateRetrieval
from services.rag_pipeline.pipeline_template.pipeline_template_base import PipelineTemplateRetrievalBase
from services.rag_pipeline.pipeline_template.pipeline_template_factory import PipelineTemplateRetrievalFactory


@pytest.mark.parametrize(
    ("template_type", "language", "mode", "fallback"),
    [
        ("built-in", "ja-JP", "remote", True),
        ("built-in", "en-US", "remote", False),
        ("customized", "ja-JP", "customized", False),
        ("unknown-legacy-type", "en-US", "customized", False),
    ],
)
def test_catalog_preserves_source_selection_and_language_fallback(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    template_type: str,
    language: str,
    mode: str,
    fallback: bool,
) -> None:
    retrieval = create_autospec(PipelineTemplateRetrievalBase, instance=True, spec_set=True)
    calls: list[Session] = []

    def list_templates(selected_language: str, workspace_id: str, *, session: Session) -> dict[str, object]:
        assert selected_language == language
        assert workspace_id == "tenant-1"
        calls.append(session)
        return {"pipeline_templates": []}

    retrieval.get_pipeline_templates.side_effect = list_templates

    def factory(selected_mode: str) -> Callable[[], PipelineTemplateRetrievalBase]:
        assert selected_mode == mode
        return lambda: retrieval

    builtin = create_autospec(BuiltInPipelineTemplateRetrieval, spec_set=True)
    builtin.fetch_pipeline_templates_from_builtin.return_value = {"pipeline_templates": [{"id": "fallback"}]}
    monkeypatch.setattr(PipelineTemplateRetrievalFactory, "get_pipeline_template_factory", factory)
    monkeypatch.setattr(PipelineTemplateRetrievalFactory, "get_built_in_pipeline_template_retrieval", lambda: builtin)
    catalog = PipelineTemplateCatalogAdapter(sqlite_session_factory, built_in_mode="remote")
    result = catalog.list_templates("tenant-1", template_type, language)
    assert result == {"pipeline_templates": [{"id": "fallback"}] if fallback else []}
    assert len(calls) == 1
    if fallback:
        builtin.fetch_pipeline_templates_from_builtin.assert_called_once_with("en-US")
    else:
        builtin.fetch_pipeline_templates_from_builtin.assert_not_called()
    assert isinstance(sqlite_engine.pool, QueuePool)
    assert sqlite_engine.pool.checkedout() == 0


@pytest.mark.parametrize("template_type", ["built-in", "customized"])
def test_catalog_detail_preserves_none_and_closes_session_on_errors(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    template_type: str,
) -> None:
    retrieval = create_autospec(PipelineTemplateRetrievalBase, instance=True, spec_set=True)
    retrieval.get_pipeline_template_detail.return_value = None
    modes: list[str] = []

    def factory(mode: str) -> Callable[[], PipelineTemplateRetrievalBase]:
        modes.append(mode)
        return lambda: retrieval

    monkeypatch.setattr(PipelineTemplateRetrievalFactory, "get_pipeline_template_factory", factory)
    catalog = PipelineTemplateCatalogAdapter(sqlite_session_factory, built_in_mode="database")
    assert catalog.get_template("tenant-1", "template-1", template_type) is None
    assert modes == ["database" if template_type == "built-in" else "customized"]
    assert retrieval.get_pipeline_template_detail.call_args.args == ("template-1", "tenant-1")
    retrieval.get_pipeline_template_detail.side_effect = RuntimeError("read failed")
    with pytest.raises(RuntimeError, match="read failed"):
        catalog.get_template("tenant-1", "template-1", template_type)
    assert isinstance(sqlite_engine.pool, QueuePool)
    assert sqlite_engine.pool.checkedout() == 0
