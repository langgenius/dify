from unittest.mock import Mock

from services.tools.api_tools_manage_service import ApiToolManageService


def test_get_api_tool_provider_remote_schema_uses_ssrf_proxy_get(monkeypatch) -> None:
    schema = """
    {
        "openapi": "3.0.0",
        "info": {"title": "Demo API", "version": "1.0.0"},
        "servers": [{"url": "https://api.example.com"}],
        "paths": {}
    }
    """
    url = "https://example.com/openapi.json"
    expected_headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)"
        " Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
        "Accept": "*/*",
    }
    mock_get = Mock(return_value=Mock(status_code=200, text=schema))
    mock_parser = Mock()

    monkeypatch.setattr("services.tools.api_tools_manage_service.ssrf_proxy.get", mock_get)
    monkeypatch.setattr(ApiToolManageService, "parser_api_schema", mock_parser)

    result = ApiToolManageService.get_api_tool_provider_remote_schema("user-1", "tenant-1", url)

    assert result == {"schema": schema}
    mock_get.assert_called_once_with(url, headers=expected_headers, timeout=10)
    mock_parser.assert_called_once_with(schema)
