"""Dataset ACL policy independent of persistence and request globals."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class DatasetAccess:
    permission: str
    maintainer_id: str | None
    role: str | None
    has_explicit_permission: bool

    def allows(self, account_id: str) -> bool:
        if self.role is None:
            return False
        if self.role == "owner" or self.maintainer_id == account_id:
            return True
        if self.permission == "only_me":
            return False
        if self.permission == "partial_members":
            return self.has_explicit_permission
        return self.permission == "all_team_members"
