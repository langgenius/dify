"""Connection response fields shared by personal and Workspace-backed surfaces."""

from datetime import datetime

from pydantic import Field, field_serializer

from fields.base import ResponseModel
from libs.datetime_utils import to_utc_timestamp
from services.end_user_connection_labels import mask_account_label
from services.end_user_connections.contracts import ConnectionSummary


class EndUserConnectionResponse(ConnectionSummary, ResponseModel):
    @field_serializer("account_label")
    def serialize_account_label(self, value: str | None) -> str | None:
        """Mask a stored provider identity on output without changing its source.

        Missing or empty identities serialize as null. The same policy applies
        to standalone, paginated and nested Connection responses.
        """
        return mask_account_label(value)

    @field_serializer("created_at", "updated_at")
    def serialize_timestamp(self, value: datetime) -> int:
        return to_utc_timestamp(value)

    @field_serializer("last_active_at")
    def serialize_activity(self, value: datetime | None) -> int | None:
        return to_utc_timestamp(value) if value is not None else None

    @field_serializer("expires_at")
    def serialize_expiration(self, value: datetime | None) -> int | None:
        return to_utc_timestamp(value) if value is not None else None


class ConnectionConfigurationResponse(ResponseModel):
    connections: dict[str, EndUserConnectionResponse | None] = Field(
        description=(
            "Saved Connection details keyed by authorization node ID, not a readiness result. "
            "Inaccessible Connection references are returned as null."
        )
    )
    reauthorization_required: bool = Field(
        description=(
            "Whether this App user must renew authorization for the current requirements; not credential readiness."
        )
    )


class EndUserConnectionListResponse(ResponseModel):
    data: list[EndUserConnectionResponse]
    has_more: bool
    next_cursor: str | None
