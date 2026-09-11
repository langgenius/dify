"""Owner-scoped delivery creation and token-based access lookup."""

from __future__ import annotations

from typing import override

import sqlalchemy as sa
from sqlalchemy.orm import Session

from core.human_input_v2.shared.values import RecipientId, TenantId
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.human_input_v2 import HumanInputDelivery

from .delivery_repository import (
    Delivery,
    DeliveryCreateParams,
    DeliveryRepository,
)


def _to_delivery(record: HumanInputDelivery) -> Delivery:
    return Delivery(
        id=record.id,
        tenant_id=TenantId(record.tenant_id),
        form_id=record.form_id,
        recipient_id=RecipientId(record.recipient_id),
        token_hash=record.token_hash,
        auth_type=record.auth_type,
        target_snapshot=record.target_snapshot,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


class SQLAlchemyDeliveryRepository(DeliveryRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    def _query(self) -> sa.Select[tuple[HumanInputDelivery]]:
        return sa.select(HumanInputDelivery).execution_options(autoflush=False, populate_existing=True)

    @override
    def create_delivery(self, *, tenant_id: TenantId, form_id: str, params: DeliveryCreateParams) -> Delivery:
        delivery_id = str(uuidv7())
        now = naive_utc_now()
        values = {
            "id": delivery_id,
            "tenant_id": tenant_id,
            "form_id": form_id,
            "recipient_id": params.recipient_id,
            "token_hash": params.token_hash,
            "auth_type": params.auth_type,
            "target_snapshot": params.target_snapshot,
            "created_at": now,
            "updated_at": now,
        }
        record = self._session.scalars(
            sa.insert(HumanInputDelivery)
            .values(**values)
            .returning(HumanInputDelivery)
            .execution_options(autoflush=False)
        ).one()
        return _to_delivery(record)

    @override
    def get_delivery_by_token_hash(self, token_hash: str) -> Delivery | None:
        record = self._session.scalars(self._query().where(HumanInputDelivery.token_hash == token_hash)).one_or_none()
        return _to_delivery(record) if record is not None else None
