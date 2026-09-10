"""Append-only storage for completed delivery attempts."""

from __future__ import annotations

from typing import override

import sqlalchemy as sa
from pydantic import BaseModel, ConfigDict, NaiveDatetime
from sqlalchemy.orm import Session

from core.human_input_v2.shared.values import TenantId
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.human_input_v2 import DeliveryResponse, HumanInputDelivery, HumanInputDeliveryAttempt

from .delivery_attempt_repository import (
    DeliveryAttempt,
    DeliveryAttemptCreateParams,
    DeliveryAttemptRepository,
    DeliveryStatus,
)


class _StoredAttempt(BaseModel):
    model_config = ConfigDict(from_attributes=True, strict=True)

    id: str
    tenant_id: TenantId
    form_id: str
    delivery_id: str
    status: DeliveryStatus
    error_message: str | None
    response: DeliveryResponse
    created_at: NaiveDatetime
    updated_at: NaiveDatetime

    def to_attempt(self) -> DeliveryAttempt:
        return DeliveryAttempt(
            id=self.id,
            tenant_id=self.tenant_id,
            form_id=self.form_id,
            delivery_id=self.delivery_id,
            status=self.status,
            error_message=self.error_message,
            response=self.response.root,
            created_at=self.created_at,
            updated_at=self.updated_at,
        )


class SQLAlchemyDeliveryAttemptRepository(DeliveryAttemptRepository):
    def __init__(self, session: Session, tenant_id: TenantId, form_id: str) -> None:
        self._session = session
        self._tenant_id = tenant_id
        self._form_id = form_id

    def _query(self) -> sa.Select[tuple[HumanInputDeliveryAttempt]]:
        return (
            sa.select(HumanInputDeliveryAttempt)
            .where(
                HumanInputDeliveryAttempt.tenant_id == self._tenant_id,
                HumanInputDeliveryAttempt.form_id == self._form_id,
            )
            .execution_options(autoflush=False, populate_existing=True)
        )

    @override
    def record_attempt(self, delivery_id: str, params: DeliveryAttemptCreateParams) -> DeliveryAttempt | None:
        delivery = sa.select(HumanInputDelivery.id).where(
            HumanInputDelivery.id == delivery_id,
            HumanInputDelivery.tenant_id == self._tenant_id,
            HumanInputDelivery.form_id == self._form_id,
        )
        attempt_id = str(uuidv7())
        now = naive_utc_now()
        table = HumanInputDeliveryAttempt.__table__
        values = {
            "id": attempt_id,
            "tenant_id": self._tenant_id,
            "form_id": self._form_id,
            "delivery_id": delivery_id,
            "status": params.status,
            "error_message": params.error_message,
            "response": DeliveryResponse(root=dict(params.response)),
            "created_at": now,
            "updated_at": now,
        }
        candidate = sa.select(
            *(sa.literal(value, type_=table.c[column].type) for column, value in values.items())
        ).where(delivery.exists())
        self._session.execute(
            sa.insert(HumanInputDeliveryAttempt).from_select(list(values), candidate).execution_options(autoflush=False)
        )
        record = self._session.scalars(self._query().where(HumanInputDeliveryAttempt.id == attempt_id)).one_or_none()
        return _StoredAttempt.model_validate(record).to_attempt() if record is not None else None
