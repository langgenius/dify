"""Owner-scoped delivery access and accepted IM message identity storage."""

from __future__ import annotations

from typing import override

import sqlalchemy as sa
from sqlalchemy.orm import Session

from core.human_input_v2.im_integration.adapters.message_locator import MessageLocator
from core.human_input_v2.shared.values import RecipientId, TenantId
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.human_input_v2 import HumanInputDelivery

from .delivery_repository import (
    Delivery,
    DeliveryCreateParams,
    DeliveryRepository,
    DeliveryTargetType,
    IMUserTargetSnapshot,
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
    def list_deliveries(self, *, tenant_id: TenantId, form_id: str) -> tuple[Delivery, ...]:
        records = self._session.scalars(
            self._query()
            .where(HumanInputDelivery.tenant_id == tenant_id, HumanInputDelivery.form_id == form_id)
            .order_by(HumanInputDelivery.id)
        )
        return tuple(_to_delivery(record) for record in records)

    @override
    def get_delivery(self, *, tenant_id: TenantId, form_id: str, delivery_id: str) -> Delivery | None:
        record = self._session.scalars(
            self._query().where(
                HumanInputDelivery.tenant_id == tenant_id,
                HumanInputDelivery.form_id == form_id,
                HumanInputDelivery.id == delivery_id,
            )
        ).one_or_none()
        return _to_delivery(record) if record is not None else None

    @override
    def set_im_message_locator(
        self, *, tenant_id: TenantId, form_id: str, delivery_id: str, message_locator: MessageLocator
    ) -> Delivery | None:
        owner_predicates = (
            HumanInputDelivery.tenant_id == tenant_id,
            HumanInputDelivery.form_id == form_id,
            HumanInputDelivery.id == delivery_id,
        )
        # A delivery owns one message. Serialize acknowledgements before assigning
        # its identity so retries cannot redirect updates to another message.
        record = self._session.scalars(self._query().where(*owner_predicates).with_for_update()).one_or_none()
        if record is None:
            return None
        target = record.target_snapshot
        if not isinstance(target, IMUserTargetSnapshot):
            raise ValueError("Only an IM delivery can retain a message locator")
        if target.message_locator is not None:
            if target.message_locator != message_locator:
                raise ValueError(f"IM delivery {delivery_id} already has a different message locator")
            return _to_delivery(record)
        record = self._session.scalars(
            sa.update(HumanInputDelivery)
            .where(*owner_predicates)
            .values(
                {
                    HumanInputDelivery.target_snapshot: target.model_copy(update={"message_locator": message_locator}),
                    HumanInputDelivery.updated_at: naive_utc_now(),
                }
            )
            .returning(HumanInputDelivery)
            .execution_options(autoflush=False, populate_existing=True)
        ).one()
        return _to_delivery(record)

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
            "target_type": params.target_snapshot.type,
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

    @override
    def get_initiator_delivery(self, *, tenant_id: TenantId, form_id: str) -> Delivery | None:
        record = self._session.scalars(
            self._query().where(
                HumanInputDelivery.tenant_id == tenant_id,
                HumanInputDelivery.form_id == form_id,
                HumanInputDelivery.target_type == DeliveryTargetType.INITIATOR,
            )
        ).one_or_none()
        return _to_delivery(record) if record is not None else None
