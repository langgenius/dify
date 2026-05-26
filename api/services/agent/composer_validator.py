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
        cls._reject_plaintext_secrets(agent_soul.model_dump(mode="json"), path="agent_soul")

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
