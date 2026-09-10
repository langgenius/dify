"""Append-only persistence contract for actual send results."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from pydantic import JsonValue, NaiveDatetime

from core.human_input_v2.shared.values import TenantId


class DeliveryStatus(StrEnum):
    SUCCEEDED = "succeeded"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class DeliveryAttemptCreateParams:
    """Completed send result; the caller supplies operator-safe error details."""

    status: DeliveryStatus
    error_message: str | None
    response: Mapping[str, JsonValue]


@dataclass(frozen=True, slots=True)
class DeliveryAttempt:
    id: str
    tenant_id: TenantId
    form_id: str
    delivery_id: str
    status: DeliveryStatus
    error_message: str | None
    response: Mapping[str, JsonValue]
    created_at: NaiveDatetime
    updated_at: NaiveDatetime


class DeliveryAttemptRepository(Protocol):
    """Send history bound to a caller-verified tenant and form.

    Every read and write preserves both owner predicates. Callers own the
    transaction; implementations never commit or roll it back. Actual sending
    happens before recording, outside this repository's transaction. No queued
    state, scheduling, provider selection, or delivery mutation is implied.
    All timestamps are naive UTC.
    """

    def record_attempt(self, delivery_id: str, params: DeliveryAttemptCreateParams) -> DeliveryAttempt | None:
        """Append one result with generated ID and timestamps.

        Return None if the delivery is absent from the bound tenant/form.
        Initial sends, automatic retries, and manual resends each append a new
        attempt for the original delivery, without overwriting prior results.
        Calling this twice records two attempts; callers invoke it once per
        actual send. Current channel configuration and binding belong to callers.
        """
        ...
