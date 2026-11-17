"""Session-bound Contact service composition for the deployment entry point."""

from sqlalchemy.orm import Session

from core.human_input_v2.im_integration import IMBindingCommandError, IMBindingCommandErrorCode
from repositories.human_input_v2.sqlalchemy_contact_repository import (
    SQLAlchemyContactIMBindingRepository,
    SQLAlchemyContactRepository,
)
from repositories.human_input_v2.sqlalchemy_im_binding_repository import SQLAlchemyIMBindingRepository
from repositories.human_input_v2.sqlalchemy_im_channel_repository import DeploymentIMChannelReader
from repositories.human_input_v2.sqlalchemy_im_identity_repository import SQLAlchemyIMIdentityRepository
from services.human_input_v2.contact_service import ContactManagementService


def build_deployment_contact_service(session: Session, *, for_update: bool) -> ContactManagementService:
    """Use the caller's Session; commands lock the current Channel until the caller commits or rolls back."""
    channels = DeploymentIMChannelReader(session)
    channel = channels.get_for_update() if for_update else channels.get()
    if for_update and channel is None:
        raise IMBindingCommandError(
            IMBindingCommandErrorCode.INTEGRATION_NOT_CONFIGURED, "IM Channel is not configured"
        )
    contacts = SQLAlchemyContactRepository(session)
    return ContactManagementService(
        contacts,
        SQLAlchemyContactIMBindingRepository(session, channel),
        SQLAlchemyIMIdentityRepository(session, channel.id) if channel is not None else None,
        organization_bindings=SQLAlchemyIMBindingRepository(session, channel.id) if channel is not None else None,
    )
