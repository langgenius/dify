"""Convert the legacy end-user provisioner's ORM results at the runtime boundary."""

from collections.abc import Mapping

from models.enums import CreatorUserRole, EndUserType
from models.model import EndUser
from services.app_scoped_end_user_service import AppScopedEndUserService
from services.workflow.entities import TriggerActor


class AppScopedTriggerEndUsers:
    def __init__(self, *, end_users: AppScopedEndUserService[EndUser]) -> None:
        self._end_users = end_users

    def create_end_user_batch(
        self, type: EndUserType, tenant_id: str, app_ids: list[str], user_id: str
    ) -> Mapping[str, TriggerActor]:
        records = self._end_users.create_end_user_batch(
            type=type, tenant_id=tenant_id, app_ids=app_ids, user_id=user_id
        )
        return {app_id: TriggerActor(id=record.id, role=CreatorUserRole.END_USER) for app_id, record in records.items()}
