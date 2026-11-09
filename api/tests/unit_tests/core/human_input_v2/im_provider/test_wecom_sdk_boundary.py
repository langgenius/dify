from __future__ import annotations

import json
from pathlib import Path

from core.human_input_v2.im_integration.adapters import wecom as wecom_module

_FIXTURE_PATH = Path(__file__).parents[4] / "fixtures" / "im_provider" / "wecom" / "sanitized_protocol.json"


def _load_fixture() -> dict[str, object]:
    value = json.loads(_FIXTURE_PATH.read_text())
    assert isinstance(value, dict)
    return value


def _assert_sanitized(value: object, *, field_name: str = "") -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            normalized_key = key.casefold().replace("-", "_")
            assert normalized_key != "authorization"
            _assert_sanitized(nested, field_name=normalized_key)
        return
    if isinstance(value, list):
        if field_name == "headers":
            for header in value:
                assert isinstance(header, list)
                assert len(header) == 2
                header_name, header_value = header
                assert isinstance(header_name, str)
                assert isinstance(header_value, str)
                assert header_name.casefold() != "authorization"
                _assert_sanitized(header_value, field_name="header_value")
            return
        for nested in value:
            _assert_sanitized(nested, field_name=field_name)
        return
    if field_name in {"agent_id", "agentid"}:
        assert value in {"1000001", 1000001}
        return
    if not isinstance(value, str):
        return
    assert not value.casefold().startswith("bearer ")
    if field_name in {"access_token", "corpsecret", "secret", "encrypted_secret"}:
        assert value.startswith("fake-")
    if field_name in {"corpid", "corp_id", "userid", "msgid"}:
        assert not value or value.startswith("fake-")


def test_sanitized_protocol_fixture_is_complete_and_contains_no_sensitive_values() -> None:
    fixture = _load_fixture()

    _assert_sanitized(fixture)
    assert set(fixture) == {"credential_test", "directory", "message"}
    credential_test = fixture["credential_test"]
    directory = fixture["directory"]
    message = fixture["message"]
    assert isinstance(credential_test, dict)
    assert isinstance(directory, dict)
    assert isinstance(message, dict)
    assert set(credential_test) == {"token", "agent"}
    assert set(directory) == {"departments", "users"}
    assert set(message) == {"request", "response"}


def test_sanitized_provider_responses_match_the_production_boundary_models() -> None:
    fixture = _load_fixture()
    credential_test = fixture["credential_test"]
    directory = fixture["directory"]
    message = fixture["message"]
    assert isinstance(credential_test, dict)
    assert isinstance(directory, dict)
    assert isinstance(message, dict)

    token = credential_test["token"]
    agent = credential_test["agent"]
    departments = directory["departments"]
    users = directory["users"]
    assert isinstance(token, dict)
    assert isinstance(agent, dict)
    assert isinstance(departments, dict)
    assert isinstance(users, dict)
    token_response = token["response"]
    agent_response = agent["response"]
    department_response = departments["response"]
    user_response = users["response"]
    message_response = message["response"]
    assert isinstance(token_response, dict)
    assert isinstance(agent_response, dict)
    assert isinstance(department_response, dict)
    assert isinstance(user_response, dict)
    assert isinstance(message_response, dict)
    department_body = department_response["body"]
    user_body = user_response["body"]
    assert isinstance(department_body, dict)
    assert isinstance(user_body, dict)

    wecom_module._AccessTokenResponse.model_validate(token_response["body"])
    wecom_module._AgentResponse.model_validate(agent_response["body"])
    wecom_module._DepartmentList.model_validate(department_body["department"])
    wecom_module._DirectoryUserList.model_validate(user_body["userlist"])
    wecom_module._MessageSendResponse.model_validate(message_response["body"])
