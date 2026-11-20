"""Enterprise-only composition for Human Input Contact capabilities."""

from sqlalchemy.orm import Session

from repositories.human_input_v2.sqlalchemy_contact_repository import (
    SQLAlchemyContactIMBindingRepository,
    SQLAlchemyContactRepository,
)
from repositories.human_input_v2.sqlalchemy_im_channel_repository import DeploymentIMChannelReader
from repositories.human_input_v2.sqlalchemy_im_identity_repository import SQLAlchemyIMIdentityRepository
from services.human_input_v2.contact_service import ContactManagementService

from .human_input_contact_service import EnterpriseContactManagementService


def build_enterprise_contact_management_service(session: Session) -> EnterpriseContactManagementService:
    repository = SQLAlchemyContactRepository(session)
    channel = DeploymentIMChannelReader(session).get()
    contact_queries = ContactManagementService(
        repository,
        SQLAlchemyContactIMBindingRepository(session, channel),
        SQLAlchemyIMIdentityRepository(session, channel.id) if channel is not None else None,
    )
    return EnterpriseContactManagementService(repository, contact_queries)


__all__ = ["build_enterprise_contact_management_service"]
