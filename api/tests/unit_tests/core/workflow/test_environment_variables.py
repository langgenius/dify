import json

import pytest

from core.helper import encrypter
from core.workflow.environment_variables import load_environment_variables
from core.workflow.llm_environment_variable import LLMEnvironmentVariable, dump_environment_variable
from graphon.variables import FloatVariable, IntegerVariable, SecretVariable, StringVariable
from graphon.variables.exc import VariableError


@pytest.mark.parametrize(
    ("tenant_id", "serialized_variables"),
    [(None, "invalid JSON"), ("", "invalid JSON"), ("tenant", None), ("tenant", ""), ("tenant", "{}")],
)
def test_load_empty_or_ownerless_environment_variables(tenant_id: str | None, serialized_variables: str | None) -> None:
    assert load_environment_variables(tenant_id=tenant_id, serialized_variables=serialized_variables) == []


def test_load_environment_variables_preserves_order_types_and_decrypts_only_secrets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    variables = [
        IntegerVariable(name="count", value=0, selector=["env", "count"]),
        SecretVariable(name="token", value="ciphertext", selector=["env", "token"]),
        StringVariable(name="text", value="", selector=["env", "text"]),
        FloatVariable(name="ratio", value=1.5, selector=["env", "ratio"]),
        LLMEnvironmentVariable(
            name="model",
            value={"provider": "langgenius/anthropic/anthropic", "name": "claude-sonnet", "mode": "chat"},
            selector=["env", "model"],
        ),
    ]
    serialized = json.dumps({var.name: dump_environment_variable(var, mode="json") for var in variables})
    decrypt_calls: list[tuple[str, str]] = []

    def decrypt(*, tenant_id: str, token: str) -> str:
        decrypt_calls.append((tenant_id, token))
        return "plaintext"

    monkeypatch.setattr(encrypter, "decrypt_token", decrypt)
    loaded = load_environment_variables(tenant_id="owner-tenant", serialized_variables=serialized)

    assert loaded == [variables[0], variables[1].model_copy(update={"value": "plaintext"}), *variables[2:]]
    assert [type(var) for var in loaded] == [type(var) for var in variables]
    assert decrypt_calls == [("owner-tenant", "ciphertext")]
    assert variables[1].value == "ciphertext"


def test_load_environment_variables_propagates_invalid_json() -> None:
    with pytest.raises(json.JSONDecodeError):
        load_environment_variables(tenant_id="tenant", serialized_variables="invalid JSON")


def test_load_environment_variables_validates_all_variables_before_decryption(monkeypatch: pytest.MonkeyPatch) -> None:
    decrypt_calls: list[tuple[str, str]] = []

    def decrypt(*, tenant_id: str, token: str) -> str:
        decrypt_calls.append((tenant_id, token))
        return "plaintext"

    monkeypatch.setattr(encrypter, "decrypt_token", decrypt)
    serialized = json.dumps(
        {"secret": {"name": "secret", "value_type": "secret", "value": "ciphertext"}, "invalid": {}}
    )

    with pytest.raises(VariableError, match="missing name"):
        load_environment_variables(tenant_id="tenant", serialized_variables=serialized)
    assert decrypt_calls == []


def test_load_environment_variables_propagates_decryption_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    failure = RuntimeError("credential store unavailable")

    def decrypt(*, tenant_id: str, token: str) -> str:
        assert (tenant_id, token) == ("tenant", "ciphertext")
        raise failure

    monkeypatch.setattr(encrypter, "decrypt_token", decrypt)
    serialized = json.dumps({"secret": {"name": "secret", "value_type": "secret", "value": "ciphertext"}})

    with pytest.raises(RuntimeError) as caught:
        load_environment_variables(tenant_id="tenant", serialized_variables=serialized)
    assert caught.value is failure
