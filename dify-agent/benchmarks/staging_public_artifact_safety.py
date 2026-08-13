"""Fail-closed validation for public Staging benchmark artifacts."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
import re
from typing import cast


FORBIDDEN_DYNAMIC_KEY_PARTS: tuple[str, ...] = (
    "api_key",
    "apikey",
    "authorization",
    "backend_ref",
    "binding_ref",
    "conversation_id",
    "sandbox_id",
    "secret",
    "snapshot_id",
    "task_id",
    "tenant_id",
    "token",
    "user_id",
    "workspace_id",
)
CREDENTIAL_VALUE_RE = re.compile(
    r"(?i)(?:bearer\s+\S+|\be2b_[A-Za-z0-9]{16,}|\bapp-[A-Za-z0-9_-]{16,})"
)
DYNAMIC_KEY_ASSIGNMENT_RE = re.compile(
    r"(?i)(?:^|[\s,{])['\"]?([A-Za-z][A-Za-z0-9_-]*)['\"]?\s*[:=]"
)
PRIVATE_VALUE_LABEL_RE = re.compile(
    r"(?i)\b(?:backend|binding|conversation|sandbox|snapshot|task|tenant|user|workspace)"
    r"[\s_-]*(?:id|ref)\s*[:=]"
)
PUBLIC_METADATA_KEY_ALLOWLIST: frozenset[str] = frozenset({"api_key_source"})


class PublicArtifactSafetyError(RuntimeError):
    """A public artifact contained a field or value that must remain private."""

    def __init__(self, *, code: str, safe_message: str) -> None:
        super().__init__(safe_message)
        self.code: str = code
        self.safe_message: str = safe_message


def validate_public_artifact_payload(
    value: object,
    *,
    forbidden_values: Sequence[str] = (),
) -> None:
    """Recursively reject private keys and credential-like public values."""

    exact_values = tuple(item for item in forbidden_values if item)
    _validate_value(value, forbidden_values=exact_values)


def validate_public_artifact_text(
    value: str,
    *,
    forbidden_values: Sequence[str] = (),
) -> None:
    """Reject credentials in a rendered or externally produced public file."""

    for match in DYNAMIC_KEY_ASSIGNMENT_RE.finditer(value):
        normalized = match.group(1).lower().replace("-", "_")
        if normalized not in PUBLIC_METADATA_KEY_ALLOWLIST and any(
            part in normalized for part in FORBIDDEN_DYNAMIC_KEY_PARTS
        ):
            raise PublicArtifactSafetyError(
                code="private_artifact_field",
                safe_message="public artifact contained a private identifier or secret field",
            )
    _validate_string(
        value,
        forbidden_values=tuple(item for item in forbidden_values if item),
    )


def _validate_value(value: object, *, forbidden_values: tuple[str, ...]) -> None:
    if isinstance(value, Mapping):
        mapping = cast(Mapping[object, object], value)
        for key, nested in mapping.items():
            normalized = str(key).lower().replace("-", "_")
            if normalized not in PUBLIC_METADATA_KEY_ALLOWLIST and any(
                part in normalized for part in FORBIDDEN_DYNAMIC_KEY_PARTS
            ):
                raise PublicArtifactSafetyError(
                    code="private_artifact_field",
                    safe_message="public artifact contained a private identifier or secret field",
                )
            _validate_value(nested, forbidden_values=forbidden_values)
        return
    if isinstance(value, list | tuple):
        sequence = cast(Sequence[object], value)
        for nested in sequence:
            _validate_value(nested, forbidden_values=forbidden_values)
        return
    if isinstance(value, str):
        _validate_string(value, forbidden_values=forbidden_values)


def _validate_string(value: str, *, forbidden_values: tuple[str, ...]) -> None:
    if (
        CREDENTIAL_VALUE_RE.search(value)
        or PRIVATE_VALUE_LABEL_RE.search(value)
        or any(secret in value for secret in forbidden_values)
    ):
        raise PublicArtifactSafetyError(
            code="secret_value_detected",
            safe_message="public artifact contained a credential-like value",
        )


__all__ = [
    "CREDENTIAL_VALUE_RE",
    "DYNAMIC_KEY_ASSIGNMENT_RE",
    "FORBIDDEN_DYNAMIC_KEY_PARTS",
    "PRIVATE_VALUE_LABEL_RE",
    "PUBLIC_METADATA_KEY_ALLOWLIST",
    "PublicArtifactSafetyError",
    "validate_public_artifact_payload",
    "validate_public_artifact_text",
]
