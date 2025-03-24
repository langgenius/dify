from typing import List, Optional, Union

from extensions.ext_database import db
from models.account import Account, Tenant
from models.model import EndUser
from models.organization import Organization, OrganizationMember, OrganizationRole


class OrganizationService:
    """Service for handling organization-related operations"""

    @classmethod
    def find_organization_by_email_domain(cls, email: str, tenant_id: str) -> Optional[Organization]:
        """
        Find an organization that matches the email domain for a given tenant

        Args:
            email: The email to check
            tenant_id: The tenant ID to search in

        Returns:
            Organization or None if no match found
        """
        if not email or '@' not in email:
            return None

        # Get email domain
        email_domain = email.split('@')[-1].lower()

        # Get active organizations for this tenant
        organizations = (
            db.session.query(Organization)
            .filter(Organization.tenant_id == tenant_id, Organization.status == 'active')
            .all()
        )

        # Check each organization for matching email domain
        for organization in organizations:
            if organization.validate_email(email):
                return organization

        return None

    @classmethod
    def assign_account_to_organization(
        cls, account: Account, organization_id: str, role: str = OrganizationRole.STUDENT
    ) -> bool:
        """
        Assign an account to an organization and set it as the current organization

        Args:
            account: The account to assign
            organization_id: The organization ID to assign to
            role: The role to assign within the organization

        Returns:
            bool: True if successful, False otherwise
        """
        if not account or not organization_id:
            return False

        # Check if organization exists
        organization = db.session.query(Organization).filter(Organization.id == organization_id).first()
        if not organization:
            return False

        # Update account's current organization
        account.current_organization_id = organization_id

        # Check if the account is already a member of this organization
        existing_member = (
            db.session.query(OrganizationMember)
            .filter(OrganizationMember.organization_id == organization_id, OrganizationMember.account_id == account.id)
            .first()
        )

        # If not a member, add them
        if not existing_member:
            member = OrganizationMember(
                organization_id=organization_id,
                account_id=account.id,
                role=role,
                is_default=True,
                created_by=account.id,
            )
            db.session.add(member)

        db.session.commit()
        return True

    @classmethod
    def assign_end_user_to_organization(cls, end_user: EndUser, organization_id: str) -> bool:
        """
        Assign an end user to an organization

        Args:
            end_user: The end user to assign
            organization_id: The organization ID to assign to

        Returns:
            bool: True if successful, False otherwise
        """
        if not end_user or not organization_id:
            return False

        # Check if organization exists
        organization = db.session.query(Organization).filter(Organization.id == organization_id).first()
        if not organization:
            return False

        # Update end user's organization
        end_user.organization_id = organization_id
        db.session.commit()
        return True

    @classmethod
    def get_organization_for_account_or_assign(cls, account: Account, tenant_id: str) -> Optional[Organization]:
        """
        Get the current organization for an account, or find and assign one based on email domain

        Args:
            account: The account to check
            tenant_id: The tenant ID to search in

        Returns:
            Organization or None if no match found
        """
        if not account:
            return None

        # If account already has an organization, return it
        if account.current_organization_id:
            return db.session.query(Organization).filter(Organization.id == account.current_organization_id).first()

        # Otherwise, find an organization based on email domain
        if account.email:
            organization = cls.find_organization_by_email_domain(account.email, tenant_id)
            if organization:
                # Assign the account to this organization
                cls.assign_account_to_organization(account, organization.id)
                return organization

        return None

    @classmethod
    def get_organization_for_end_user(cls, end_user: EndUser, tenant_id: str) -> Optional[Organization]:
        """
        Get the organization for an end user, checking external account if needed

        Args:
            end_user: The end user to check
            tenant_id: The tenant ID to search in

        Returns:
            Organization or None if no match found
        """
        if not end_user:
            return None

        # If end user already has an organization, return it
        if end_user.organization_id:
            return db.session.query(Organization).filter(Organization.id == end_user.organization_id).first()

        # If the end user has an external user ID that's an account, check that
        if end_user.external_user_id and end_user.type == "service_api_with_auth":
            account = db.session.query(Account).filter(Account.id == end_user.external_user_id).first()
            if account:
                organization = cls.get_organization_for_account_or_assign(account, tenant_id)
                if organization:
                    # Assign the end user to this organization
                    cls.assign_end_user_to_organization(end_user, organization.id)
                    return organization

        return None

    @classmethod
    def get_available_organizations_for_tenant(cls, tenant_id: str) -> List[Organization]:
        """
        Get all active organizations for a tenant

        Args:
            tenant_id: The tenant ID to search in

        Returns:
            List of organizations
        """
        return (
            db.session.query(Organization)
            .filter(Organization.tenant_id == tenant_id, Organization.status == 'active')
            .all()
        )

    @classmethod
    def get_organization_by_id(cls, organization_id: str) -> Optional[Organization]:
        """Get an organization by ID"""
        return db.session.query(Organization).filter(Organization.id == organization_id).first()
