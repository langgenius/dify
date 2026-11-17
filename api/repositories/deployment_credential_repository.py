"""Session-bound reads and conditional writes for the installation credential key."""

from dataclasses import dataclass
from uuid import UUID

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from libs.credential_cipher import CredentialKeyUnavailableError
from models.model import DifySetup

_INSTANCE_ID = TypeAdapter(UUID)


@dataclass(frozen=True)
class DeploymentCredentialKey:
    instance_id: str
    reference: str | None


class DeploymentCredentialRepository:
    """Use an injected Session; the service owns every transaction."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self) -> DeploymentCredentialKey:
        """Require exactly one setup with stable identity; return its immutable key facts."""
        rows = self._session.scalars(select(DifySetup).limit(2)).all()
        if len(rows) != 1 or rows[0].instance_id is None:
            raise CredentialKeyUnavailableError("Deployment identity is unavailable")
        try:
            instance_id = str(_INSTANCE_ID.validate_python(rows[0].instance_id))
        except ValidationError:
            raise CredentialKeyUnavailableError("Deployment identity is unavailable") from None
        return DeploymentCredentialKey(instance_id, rows[0].credential_encryption_key_ref)

    def save_reference(self, instance_id: str, reference: str) -> None:
        """Require the same uninitialized setup; CAS prevents a changed identity/reference from being overwritten."""
        self._session.execute(
            update(DifySetup)
            .where(
                DifySetup.instance_id == instance_id,
                DifySetup.credential_encryption_key_ref.is_(None),
            )
            .values(credential_encryption_key_ref=reference)
        )
        current = self.get()
        if current.instance_id != instance_id or current.reference != reference:
            raise CredentialKeyUnavailableError("Deployment credential key reference changed")
