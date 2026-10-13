"""Resolve creator identities for files uploaded to a v2 approval."""

from dataclasses import dataclass
from typing import Protocol

from models.enums import CreatorUserRole


@dataclass(frozen=True, slots=True)
class FileUploadOwner:
    id: str
    creator_role: CreatorUserRole


class FileUploadRepository(Protocol):
    def get_owner(
        self, *, tenant_id: str, app_id: str, owner_id: str, owner_role: CreatorUserRole
    ) -> FileUploadOwner | None: ...

    def get_delivery_test_owner(self, *, tenant_id: str, app_id: str) -> FileUploadOwner | None: ...
