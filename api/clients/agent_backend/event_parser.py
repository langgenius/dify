from __future__ import annotations

from collections.abc import Iterable, Iterator, Mapping
from typing import Any

from pydantic import TypeAdapter, ValidationError

from clients.agent_backend.dto import CONTRACT_VERSION
from clients.agent_backend.errors import (
    AgentBackendContractVersionError,
    AgentBackendEventParseError,
    AgentBackendUnknownEventError,
)
from clients.agent_backend.events import (
    AgentBackendEvent,
    AgentBackendEventEnvelope,
    AgentBackendEventType,
)

_event_adapter = TypeAdapter(AgentBackendEvent)


class AgentBackendEventParser:
    def parse(self, raw_event: Mapping[str, Any]) -> AgentBackendEvent:
        raw_contract_version = raw_event.get("contract_version")
        if raw_contract_version != CONTRACT_VERSION:
            raise AgentBackendContractVersionError(
                f"Unsupported agent backend contract version: {raw_contract_version}"
            )

        raw_event_type = raw_event.get("type")
        try:
            event_type = AgentBackendEventType(raw_event_type)
        except ValueError as exc:
            raise AgentBackendUnknownEventError(
                f"Unknown agent backend event type: {raw_event_type}",
                raw_event=raw_event,
            ) from exc

        try:
            envelope = AgentBackendEventEnvelope.model_validate({**raw_event, "type": event_type.value})
        except ValidationError as exc:
            raise AgentBackendEventParseError("Invalid agent backend event envelope", raw_event=raw_event) from exc

        event_payload = {
            "event_id": envelope.event_id,
            "sequence": envelope.sequence,
            "type": event_type.value,
            "created_at": envelope.created_at,
            "execution_context": envelope.execution_context,
            **envelope.payload,
        }

        try:
            return _event_adapter.validate_python(event_payload)
        except ValidationError as exc:
            raise AgentBackendEventParseError(
                f"Invalid payload for agent backend event type: {event_type}",
                raw_event=raw_event,
            ) from exc

    def parse_many(self, raw_events: Iterable[Mapping[str, Any]]) -> Iterator[AgentBackendEvent]:
        for raw_event in raw_events:
            yield self.parse(raw_event)
