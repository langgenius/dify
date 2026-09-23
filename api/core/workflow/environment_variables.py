"""Load persisted workflow environment variables without requiring an ORM model."""

import json
from typing import cast

from core.helper import encrypter
from core.workflow.llm_environment_variable import LLMEnvironmentVariable
from factories import variable_factory
from graphon.variables import FloatVariable, IntegerVariable, SecretVariable, StringVariable, VariableBase


def load_environment_variables(
    *, tenant_id: str | None, serialized_variables: str | None
) -> list[StringVariable | IntegerVariable | FloatVariable | SecretVariable | LLMEnvironmentVariable]:
    # Use the workflow owner to avoid relying on request user in background threads.
    if not tenant_id:
        return []

    variables = cast(dict[str, dict[str, object]], json.loads(serialized_variables or "{}"))
    results = [variable_factory.build_environment_variable_from_mapping(value) for value in variables.values()]

    def decrypt_func(
        var: VariableBase,
    ) -> StringVariable | IntegerVariable | FloatVariable | SecretVariable | LLMEnvironmentVariable:
        match var:
            case SecretVariable():
                return var.model_copy(update={"value": encrypter.decrypt_token(tenant_id=tenant_id, token=var.value)})
            case StringVariable() | IntegerVariable() | FloatVariable() | LLMEnvironmentVariable():
                return var
            case _:
                raise AssertionError(f"Unexpected variable type for environment variable: {type(var)}")

    return [decrypt_func(var) for var in results]
