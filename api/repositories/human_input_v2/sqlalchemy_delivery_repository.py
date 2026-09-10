"""Owner-scoped delivery creation and token-based access lookup."""

from __future__ import annotations

from typing import override

import sqlalchemy as sa
from pydantic import BaseModel, ConfigDict, NaiveDatetime
from sqlalchemy.orm import Session

from core.human_input_v2.shared.values import RecipientId, TenantId
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.human_input_v2 import HumanInputDelivery, HumanInputRecipient

from .delivery_repository import (
    Delivery,
    DeliveryCreateParams,
    DeliveryRepository,
    SubmissionAuthType,
    TargetSnapshot,
)


class _StoredDelivery(BaseModel):
    model_config = ConfigDict(from_attributes=True, strict=True)

    id: str
    tenant_id: TenantId
    form_id: str
    recipient_id: RecipientId
    token_hash: str
    auth_type: SubmissionAuthType
    target_snapshot: TargetSnapshot
    created_at: NaiveDatetime
    updated_at: NaiveDatetime

    def to_delivery(self) -> Delivery:
        return Delivery(
            id=self.id,
            tenant_id=self.tenant_id,
            form_id=self.form_id,
            recipient_id=self.recipient_id,
            token_hash=self.token_hash,
            auth_type=self.auth_type,
            target_snapshot=self.target_snapshot,
            created_at=self.created_at,
            updated_at=self.updated_at,
        )


class SQLAlchemyDeliveryRepository(DeliveryRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    def _query(self) -> sa.Select[tuple[HumanInputDelivery]]:
        return sa.select(HumanInputDelivery).execution_options(autoflush=False, populate_existing=True)

    @override
    def create_delivery(self, *, tenant_id: TenantId, form_id: str, params: DeliveryCreateParams) -> Delivery | None:
        recipient = sa.select(HumanInputRecipient.id).where(
            HumanInputRecipient.id == params.recipient_id,
            HumanInputRecipient.tenant_id == tenant_id,
            HumanInputRecipient.form_id == form_id,
        )
        delivery_id = str(uuidv7())
        now = naive_utc_now()
        table = HumanInputDelivery.__table__
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
        # Membership and insertion share one statement, including the full owner
        # chain despite the schema's intentionally absent foreign keys.
        candidate = sa.select(
            *(sa.literal(value, type_=table.c[column].type) for column, value in values.items())
        ).where(recipient.exists())
        self._session.execute(
            sa.insert(HumanInputDelivery).from_select(list(values), candidate).execution_options(autoflush=False)
        )
        record = self._session.scalars(
            self._query().where(
                HumanInputDelivery.id == delivery_id,
                HumanInputDelivery.tenant_id == tenant_id,
                HumanInputDelivery.form_id == form_id,
            )
        ).one_or_none()
        return _StoredDelivery.model_validate(record).to_delivery() if record is not None else None

    @override
    def get_delivery_by_token_hash(self, token_hash: str) -> Delivery | None:
        record = self._session.scalars(self._query().where(HumanInputDelivery.token_hash == token_hash)).one_or_none()
        return _StoredDelivery.model_validate(record).to_delivery() if record is not None else None
