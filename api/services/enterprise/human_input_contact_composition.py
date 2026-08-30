"""Enterprise-only composition for Human Input Contact capabilities."""

from sqlalchemy.orm import Session

from repositories.human_input_v2.contact import SQLAlchemyContactIMBindingRepository, SQLAlchemyContactRepository
from services.human_input_v2.contact_service import ContactManagementService

from .human_input_contact_service import EnterpriseContactManagementService, EnterpriseOrganizationContactReader


def build_enterprise_contact_management_service(session: Session) -> EnterpriseContactManagementService:
    repository = SQLAlchemyContactRepository(session)
    contact_queries = ContactManagementService(repository, SQLAlchemyContactIMBindingRepository(session))
    return EnterpriseContactManagementService(repository, repository, contact_queries)


def build_enterprise_organization_contact_reader(session: Session) -> EnterpriseOrganizationContactReader:
    return EnterpriseOrganizationContactReader(SQLAlchemyContactRepository(session))


__all__ = ["build_enterprise_contact_management_service", "build_enterprise_organization_contact_reader"]
