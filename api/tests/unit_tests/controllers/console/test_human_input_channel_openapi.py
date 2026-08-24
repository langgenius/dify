from __future__ import annotations

import pytest
from flask import Flask

_CHANNEL_PATH_PREFIX = "/workspace/current/human-input/v2"
_HTTP_METHODS = {"delete", "get", "patch", "post", "put"}
_EXPECTED_OPERATIONS = {
    f"{_CHANNEL_PATH_PREFIX}/channel-providers": {"get"},
    f"{_CHANNEL_PATH_PREFIX}/channels": {"get"},
    f"{_CHANNEL_PATH_PREFIX}/channels/email": {"post"},
    f"{_CHANNEL_PATH_PREFIX}/channels/email/test": {"post"},
    f"{_CHANNEL_PATH_PREFIX}/channels/email/{{channel_id}}": {"delete", "get", "put"},
    f"{_CHANNEL_PATH_PREFIX}/channels/im": {"post"},
    f"{_CHANNEL_PATH_PREFIX}/channels/im/test": {"post"},
    f"{_CHANNEL_PATH_PREFIX}/channels/im/{{channel_id}}": {"delete", "get", "put"},
    f"{_CHANNEL_PATH_PREFIX}/channels/im/{{channel_id}}/replacement": {"post"},
}
_EXPECTED_REQUEST_REFS = {
    (f"{_CHANNEL_PATH_PREFIX}/channels/email", "post"): "EmailChannelCreatePayload",
    (f"{_CHANNEL_PATH_PREFIX}/channels/email/test", "post"): "EmailChannelTestPayload",
    (f"{_CHANNEL_PATH_PREFIX}/channels/email/{{channel_id}}", "put"): "EmailChannelUpdatePayload",
    (f"{_CHANNEL_PATH_PREFIX}/channels/im", "post"): "IMChannelCreatePayload",
    (f"{_CHANNEL_PATH_PREFIX}/channels/im/test", "post"): "IMChannelTestPayload",
    (f"{_CHANNEL_PATH_PREFIX}/channels/im/{{channel_id}}", "put"): "IMChannelUpdatePayload",
    (f"{_CHANNEL_PATH_PREFIX}/channels/im/{{channel_id}}/replacement", "post"): "IMChannelReplacementPayload",
}
_EXPECTED_RESPONSE_REFS = {
    (f"{_CHANNEL_PATH_PREFIX}/channel-providers", "get"): "ListChannelProvidersResponse",
    (f"{_CHANNEL_PATH_PREFIX}/channels", "get"): "ListChannelsResponse",
    (f"{_CHANNEL_PATH_PREFIX}/channels/email", "post"): "EmailChannelMutationResponse",
    (f"{_CHANNEL_PATH_PREFIX}/channels/email/test", "post"): "ChannelTestResponse",
    (f"{_CHANNEL_PATH_PREFIX}/channels/email/{{channel_id}}", "get"): "EmailChannelDetailResponse",
    (f"{_CHANNEL_PATH_PREFIX}/channels/email/{{channel_id}}", "put"): "EmailChannelMutationResponse",
    (f"{_CHANNEL_PATH_PREFIX}/channels/email/{{channel_id}}", "delete"): "ChannelDeleteResponse",
    (f"{_CHANNEL_PATH_PREFIX}/channels/im", "post"): "IMChannelMutationResponse",
    (f"{_CHANNEL_PATH_PREFIX}/channels/im/test", "post"): "ChannelTestResponse",
    (f"{_CHANNEL_PATH_PREFIX}/channels/im/{{channel_id}}", "get"): "IMChannelDetailResponse",
    (f"{_CHANNEL_PATH_PREFIX}/channels/im/{{channel_id}}", "put"): "IMChannelMutationResponse",
    (f"{_CHANNEL_PATH_PREFIX}/channels/im/{{channel_id}}", "delete"): "ChannelDeleteResponse",
    (f"{_CHANNEL_PATH_PREFIX}/channels/im/{{channel_id}}/replacement", "post"): "IMChannelMutationResponse",
}


@pytest.fixture
def channel_openapi(monkeypatch: pytest.MonkeyPatch) -> dict[str, object]:
    from configs import dify_config
    from controllers.console import bp as console_bp

    monkeypatch.setattr(dify_config, "SWAGGER_UI_ENABLED", True)

    application = Flask(__name__)
    application.config["TESTING"] = True
    application.config["RESTX_INCLUDE_ALL_MODELS"] = True
    application.register_blueprint(console_bp)

    response = application.test_client().get("/console/api/openapi.json")
    assert response.status_code == 200
    return response.get_json()


def _schema_ref(operation: dict[str, object], *, response: bool) -> str:
    if response:
        responses = operation["responses"]
        assert isinstance(responses, dict)
        success = responses["200"]
        assert isinstance(success, dict)
        content = success["content"]
    else:
        request_body = operation["requestBody"]
        assert isinstance(request_body, dict)
        content = request_body["content"]

    assert isinstance(content, dict)
    json_content = content["application/json"]
    assert isinstance(json_content, dict)
    schema = json_content["schema"]
    assert isinstance(schema, dict)
    schema_ref = schema["$ref"]
    assert isinstance(schema_ref, str)
    return schema_ref.removeprefix("#/components/schemas/")


def test_channel_openapi_uses_only_canonical_routes_and_registered_dtos(
    channel_openapi: dict[str, object],
) -> None:
    paths = channel_openapi["paths"]
    assert isinstance(paths, dict)
    channel_paths = {
        path: {method for method in path_item if method in _HTTP_METHODS}
        for path, path_item in paths.items()
        if isinstance(path, str) and path.startswith(_CHANNEL_PATH_PREFIX) and isinstance(path_item, dict)
    }

    assert channel_paths == _EXPECTED_OPERATIONS
    assert "/workspaces/current/human-input/im-integration" not in paths
    assert "/workspaces/current/human-input/im-integration/test" not in paths

    for path, methods in _EXPECTED_OPERATIONS.items():
        path_item = paths[path]
        assert isinstance(path_item, dict)
        for method in methods:
            operation = path_item[method]
            assert isinstance(operation, dict)
            if method == "get":
                assert "requestBody" not in operation

    for (path, method), expected_schema in _EXPECTED_REQUEST_REFS.items():
        operation = paths[path][method]
        assert isinstance(operation, dict)
        assert _schema_ref(operation, response=False) == expected_schema

    for (path, method), expected_schema in _EXPECTED_RESPONSE_REFS.items():
        operation = paths[path][method]
        assert isinstance(operation, dict)
        assert _schema_ref(operation, response=True) == expected_schema

    for path in (
        f"{_CHANNEL_PATH_PREFIX}/channels/email/{{channel_id}}",
        f"{_CHANNEL_PATH_PREFIX}/channels/im/{{channel_id}}",
    ):
        delete_operation = paths[path]["delete"]
        assert isinstance(delete_operation, dict)
        assert "requestBody" not in delete_operation
        parameters = delete_operation["parameters"]
        assert isinstance(parameters, list)
        expected_version = next(parameter for parameter in parameters if parameter["name"] == "expected_config_version")
        assert expected_version["in"] == "query"
        assert expected_version["required"] is True
        assert expected_version["schema"]["type"] == "string"
