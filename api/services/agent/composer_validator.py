import re
from typing import Any

from pydantic import ValidationError

from services.agent.errors import AgentSoulLockedError, InvalidComposerConfigError, PlaintextSecretNotAllowedError
from services.entities.agent_entities import (
    AgentSoulConfig,
    ComposerSavePayload,
    ComposerVariant,
    WorkflowNodeJobConfig,
)

_PLAINTEXT_SECRET_KEYS = {
    "api_key",
    "apikey",
    "authorization",
    "password",
    "secret",
    "secret_key",
}

# Env/secret names become shell ``export`` identifiers in the sandbox bootstrap, so
# they must be valid shell identifiers. Validating here fails fast at composer save
# with a friendly error instead of at run time in the agent backend shell layer.
_SHELL_ENV_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_CLI_TOOL_NAME_KEYS = ("name", "tool_name", "label")
_CLI_TOOL_COMMAND_KEYS = ("command", "install_command", "install", "setup_command")


class ComposerConfigValidator:
    @classmethod
    def validate_save_payload(cls, payload: ComposerSavePayload) -> None:
        if payload.variant == ComposerVariant.WORKFLOW and payload.soul_lock.locked and payload.agent_soul is not None:
            raise AgentSoulLockedError()

        if payload.agent_soul is not None:
            cls.validate_agent_soul(payload.agent_soul)
        if payload.node_job is not None:
            cls.validate_node_job(payload.node_job)

    @classmethod
    def validate_agent_soul(cls, agent_soul: AgentSoulConfig) -> None:
        dumped = agent_soul.model_dump(mode="json")
        cls._reject_plaintext_secrets(dumped, path="agent_soul")
        cls._validate_shell_config(dumped)

    @classmethod
    def validate_node_job(cls, node_job: WorkflowNodeJobConfig) -> None:
        cls._reject_plaintext_secrets(node_job.model_dump(mode="json"), path="node_job")

    @classmethod
    def validate_agent_soul_dict(cls, value: dict[str, Any]) -> AgentSoulConfig:
        try:
            config = AgentSoulConfig.model_validate(value)
        except ValidationError as exc:
            raise InvalidComposerConfigError(str(exc)) from exc
        cls.validate_agent_soul(config)
        return config

    @classmethod
    def validate_node_job_dict(cls, value: dict[str, Any]) -> WorkflowNodeJobConfig:
        try:
            config = WorkflowNodeJobConfig.model_validate(value)
        except ValidationError as exc:
            raise InvalidComposerConfigError(str(exc)) from exc
        cls.validate_node_job(config)
        return config

    @classmethod
    def _validate_shell_config(cls, soul: dict[str, Any]) -> None:
        """Fail fast on shell env/secret/CLI config the sandbox would otherwise reject at run time."""
        env = soul.get("env") or {}
        seen_env_names: set[str] = set()
        for section in ("variables", "secret_refs"):
            entries = env.get(section)
            if not isinstance(entries, list):
                continue
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                raw_name = entry.get("name")
                if not isinstance(raw_name, str) or not raw_name.strip():
                    # Unnamed draft rows are tolerated; only named entries are bound to the shell.
                    continue
                name = raw_name.strip()
                if not _SHELL_ENV_NAME_PATTERN.fullmatch(name):
                    raise InvalidComposerConfigError(
                        f"env/secret name '{name}' must be a valid shell identifier (^[A-Za-z_][A-Za-z0-9_]*$)."
                    )
                if name in seen_env_names:
                    raise InvalidComposerConfigError(
                        f"duplicate env/secret name '{name}': environment variables and secret references "
                        "share the shell namespace."
                    )
                seen_env_names.add(name)

        tools = soul.get("tools") or {}
        cli_tools = tools.get("cli_tools")
        if isinstance(cli_tools, list):
            for entry in cli_tools:
                if not isinstance(entry, dict) or entry.get("enabled") is False:
                    continue
                has_name = any(isinstance(entry.get(key), str) and entry[key].strip() for key in _CLI_TOOL_NAME_KEYS)
                has_command = bool(entry.get("install_commands")) or any(
                    isinstance(entry.get(key), str) and entry[key].strip() for key in _CLI_TOOL_COMMAND_KEYS
                )
                if not has_name and not has_command:
                    raise InvalidComposerConfigError("an enabled CLI tool must declare a name or an install command.")

    @classmethod
    def _reject_plaintext_secrets(cls, value: Any, *, path: str) -> None:
        if isinstance(value, dict):
            for key, nested in value.items():
                normalized_key = key.lower().replace("-", "_")
                nested_path = f"{path}.{key}"
                if normalized_key in _PLAINTEXT_SECRET_KEYS and isinstance(nested, str) and nested:
                    raise PlaintextSecretNotAllowedError(f"Plaintext secret is not allowed at {nested_path}")
                cls._reject_plaintext_secrets(nested, path=nested_path)
        elif isinstance(value, list):
            for index, nested in enumerate(value):
                cls._reject_plaintext_secrets(nested, path=f"{path}[{index}]")
