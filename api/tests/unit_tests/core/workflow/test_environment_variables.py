import json

import pytest

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


def test_load_environment_variables_preserves_order_types_and_decrypts_only_secrets() -> None:
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

    loaded = load_environment_variables(
        tenant_id="owner-tenant", serialized_variables=serialized, decrypt_token=decrypt
    )

    assert loaded == [variables[0], variables[1].model_copy(update={"value": "plaintext"}), *variables[2:]]
    assert [type(var) for var in loaded] == [type(var) for var in variables]
    assert decrypt_calls == [("owner-tenant", "ciphertext")]
    assert variables[1].value == "ciphertext"


def test_load_environment_variables_rejects_invalid_json() -> None:
    with pytest.raises(VariableError, match="Invalid environment variables"):
        load_environment_variables(tenant_id="tenant", serialized_variables="invalid JSON")


def test_load_environment_variables_validates_all_variables_before_decryption() -> None:
    decrypt_calls: list[tuple[str, str]] = []

    def decrypt(*, tenant_id: str, token: str) -> str:
        decrypt_calls.append((tenant_id, token))
        return "plaintext"

    serialized = json.dumps(
        {"secret": {"name": "secret", "value_type": "secret", "value": "ciphertext"}, "invalid": {}}
    )

    with pytest.raises(VariableError, match="missing name"):
        load_environment_variables(tenant_id="tenant", serialized_variables=serialized, decrypt_token=decrypt)
    assert decrypt_calls == []


def test_load_environment_variables_propagates_decryption_failure() -> None:
    failure = RuntimeError("credential store unavailable")

    def decrypt(*, tenant_id: str, token: str) -> str:
        assert (tenant_id, token) == ("tenant", "ciphertext")
        raise failure

    serialized = json.dumps({"secret": {"name": "secret", "value_type": "secret", "value": "ciphertext"}})

    with pytest.raises(RuntimeError) as caught:
        load_environment_variables(tenant_id="tenant", serialized_variables=serialized, decrypt_token=decrypt)
    assert caught.value is failure


@pytest.mark.parametrize(
    "serialized_variables",
    [
        "null",
        "true",
        "42",
        '"text"',
        "[]",
        '[{"name":"text","value_type":"string","value":"hello"}]',
        '{"variable":null}',
        '{"variable":42}',
        '{"variable":[]}',
        '{"variable":"text"}',
    ],
)
def test_load_environment_variables_rejects_invalid_mapping_shapes(serialized_variables: str) -> None:
    """Non-object containers and entries fail at the persisted JSON boundary."""
    with pytest.raises(VariableError, match="Invalid environment variables"):
        load_environment_variables(tenant_id="tenant", serialized_variables=serialized_variables)


def test_invalid_environment_variable_mapping_is_rejected_before_decryption() -> None:
    """An invalid mapping entry prevents any secret decryption or payload disclosure."""
    decrypt_calls: list[tuple[str, str]] = []

    def decrypt(*, tenant_id: str, token: str) -> str:
        decrypt_calls.append((tenant_id, token))
        return "plaintext"

    serialized = json.dumps(
        {
            "secret": {"name": "secret", "value_type": "secret", "value": "sensitive-ciphertext"},
            "invalid": ["sensitive-value"],
        }
    )

    with pytest.raises(VariableError, match="Invalid environment variables") as caught:
        load_environment_variables(tenant_id="tenant", serialized_variables=serialized, decrypt_token=decrypt)
    assert decrypt_calls == []
    assert "sensitive" not in str(caught.value)
    assert caught.value.__suppress_context__
