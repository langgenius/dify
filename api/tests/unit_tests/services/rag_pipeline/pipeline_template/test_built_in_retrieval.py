import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session

from services.rag_pipeline.pipeline_template.built_in.built_in_retrieval import BuiltInPipelineTemplateRetrieval
from services.rag_pipeline.pipeline_template.pipeline_template_type import PipelineTemplateType


def test_get_type() -> None:
    retrieval = BuiltInPipelineTemplateRetrieval()

    assert retrieval.get_type() == PipelineTemplateType.BUILTIN


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_get_pipeline_templates(mocker: MockerFixture, sqlite_session: Session) -> None:
    mocker.patch.object(
        BuiltInPipelineTemplateRetrieval,
        "_get_builtin_data",
        return_value={
            "pipeline_templates": {
                "en-US": {"pipeline_templates": [{"id": "tpl-1"}]},
                "tpl-1": {"id": "tpl-1", "name": "Template 1"},
            }
        },
    )
    retrieval = BuiltInPipelineTemplateRetrieval()

    templates = retrieval.get_pipeline_templates("en-US", session=sqlite_session)

    assert templates == {"pipeline_templates": [{"id": "tpl-1"}]}
    assert not sqlite_session.in_transaction()


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_get_pipeline_template_detail(mocker: MockerFixture, sqlite_session: Session) -> None:
    mocker.patch.object(
        BuiltInPipelineTemplateRetrieval,
        "_get_builtin_data",
        return_value={
            "pipeline_templates": {
                "tpl-1": {"id": "tpl-1", "name": "Template 1"},
            }
        },
    )
    retrieval = BuiltInPipelineTemplateRetrieval()

    detail = retrieval.get_pipeline_template_detail("tpl-1", session=sqlite_session)

    assert detail == {"id": "tpl-1", "name": "Template 1"}
    assert not sqlite_session.in_transaction()


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_get_pipeline_templates_missing_language_returns_empty_dict(
    mocker: MockerFixture, sqlite_session: Session
) -> None:
    mocker.patch.object(
        BuiltInPipelineTemplateRetrieval,
        "_get_builtin_data",
        return_value={"pipeline_templates": {}},
    )
    retrieval = BuiltInPipelineTemplateRetrieval()

    result = retrieval.get_pipeline_templates("fr-FR", session=sqlite_session)

    assert result == {}
    assert not sqlite_session.in_transaction()


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_get_pipeline_template_detail_returns_none_for_unknown_id(
    mocker: MockerFixture, sqlite_session: Session
) -> None:
    mocker.patch.object(
        BuiltInPipelineTemplateRetrieval,
        "_get_builtin_data",
        return_value={"pipeline_templates": {"tpl-1": {"id": "tpl-1"}}},
    )
    retrieval = BuiltInPipelineTemplateRetrieval()

    result = retrieval.get_pipeline_template_detail("nonexistent-id", session=sqlite_session)

    assert result is None
    assert not sqlite_session.in_transaction()


def test_get_builtin_data_reads_from_file_and_caches(mocker: MockerFixture) -> None:
    import json

    # Ensure no cached data
    BuiltInPipelineTemplateRetrieval.builtin_data = None

    mock_app = mocker.Mock()
    mock_app.root_path = "/fake/root"

    mocker.patch(
        "services.rag_pipeline.pipeline_template.built_in.built_in_retrieval.current_app",
        mock_app,
    )

    test_data = {"pipeline_templates": {"en-US": {"templates": []}}}
    mocker.patch(
        "services.rag_pipeline.pipeline_template.built_in.built_in_retrieval.Path.read_text",
        return_value=json.dumps(test_data),
    )

    result = BuiltInPipelineTemplateRetrieval._get_builtin_data()

    assert result == test_data
    assert BuiltInPipelineTemplateRetrieval.builtin_data == test_data

    # Reset class state
    BuiltInPipelineTemplateRetrieval.builtin_data = None


def test_get_builtin_data_returns_cache_on_second_call(mocker: MockerFixture) -> None:
    cached_data = {"pipeline_templates": {"en-US": {}}}
    BuiltInPipelineTemplateRetrieval.builtin_data = cached_data

    result = BuiltInPipelineTemplateRetrieval._get_builtin_data()

    assert result == cached_data

    # Reset class state
    BuiltInPipelineTemplateRetrieval.builtin_data = None
