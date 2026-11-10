from collections.abc import Mapping

import pytest

from dev.generate_swagger_specs import export_console_spec


@pytest.fixture(scope="module")
def console_openapi() -> dict[str, object]:
    """Export the production Console contract once for all admission assertions."""
    return export_console_spec()


def _mapping(value: object) -> Mapping[str, object]:
    """Narrow a generated OpenAPI object before reading its nested fields."""
    assert isinstance(value, Mapping)
    return value


@pytest.mark.parametrize(
    ("path", "expected_error_schemas"),
    [
        (
            "/apps/{app_id}/workflows/draft/environment-variables",
            ["AppNotFoundError", "DraftWorkflowNotExistError", "ErrorResponse"],
        ),
        (
            "/rag/pipelines/{pipeline_id}/workflows/draft/environment-variables",
            ["DraftWorkflowNotExistError", "PipelineNotFoundError", "ErrorResponse"],
        ),
        (
            "/snippets/{snippet_id}/workflows/draft/environment-variables",
            ["DraftWorkflowNotExistError", "ErrorResponse"],
        ),
    ],
)
def test_owner_admission_documents_lookup_and_handler_errors(
    console_openapi: dict[str, object], path: str, expected_error_schemas: list[str]
) -> None:
    """Require each owner kind to expose exactly its reachable 404 business errors."""
    paths = _mapping(console_openapi["paths"])
    operation = _mapping(_mapping(paths[path])["get"])
    responses = _mapping(operation["responses"])
    content = _mapping(_mapping(responses["404"])["content"])
    response_schema = _mapping(_mapping(content["application/json"])["schema"])
    options = response_schema["anyOf"]
    assert isinstance(options, list)

    error_schemas: list[str] = []
    for option in options:
        ref = _mapping(option)["$ref"]
        assert isinstance(ref, str)
        error_schemas.append(ref.rsplit("/", 1)[-1])

    assert error_schemas == expected_error_schemas
