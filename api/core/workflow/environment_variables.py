"""Load persisted workflow environment variables without requiring an ORM model."""

from pydantic import TypeAdapter, ValidationError

from core.helper import encrypter
from core.workflow.llm_environment_variable import LLMEnvironmentVariable
from factories import variable_factory
from graphon.variables import FloatVariable, IntegerVariable, SecretVariable, StringVariable, VariableBase
from graphon.variables.exc import VariableError

_environment_variables_adapter = TypeAdapter(dict[str, dict[str, object]])


def load_environment_variables(
    *, tenant_id: str | None, serialized_variables: str | None
) -> list[StringVariable | IntegerVariable | FloatVariable | SecretVariable | LLMEnvironmentVariable]:
    """Load an owner's persisted variable mapping, validating it before decryption.

    Without an owner return an empty list. Missing or empty serialized data means
    an empty mapping; otherwise require a JSON object whose values are objects.
    Preserve insertion order and variable-factory validation, then decrypt only
    secrets with the supplied tenant. Invalid JSON or mapping shapes raise
    VariableError without exposing the serialized payload; variable validation
    and decryption failures propagate. No secrets are decrypted until every
    mapping entry and variable has been validated.
    """
    # Use the workflow owner to avoid relying on request user in background threads.
    if not tenant_id:
        return []

    try:
        variables = _environment_variables_adapter.validate_json(serialized_variables or "{}")
    except ValidationError:
        raise VariableError(
            "Invalid environment variables: expected a JSON object mapping variable IDs to objects."
        ) from None
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
