"""
Integration tests for mail_invite_member_task using testcontainers.

This module provides integration tests for the mail invitation task
using TestContainers to ensure realistic testing scenarios with actual database
and service dependencies.
"""

import logging
from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from extensions.ext_database import db
from libs.email_i18n import EmailType
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from tasks.mail_invite_member_task import send_invite_member_mail_task

logger = logging.getLogger(__name__)


class TestMailInviteMemberTask:
    """Integration tests for send_invite_member_mail_task using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("tasks.mail_invite_member_task.mail") as mock_mail,
            patch("tasks.mail_invite_member_task.get_email_i18n_service") as mock_get_email_service,
            patch("tasks.mail_invite_member_task.dify_config") as mock_dify_config,
        ):
            # Setup mock mail service
            mock_mail.is_inited.return_value = True

            # Setup mock email service
            mock_email_service = MagicMock()
            mock_get_email_service.return_value = mock_email_service

            # Setup mock config
            mock_dify_config.CONSOLE_WEB_URL = "https://test.dify.com"

            yield {
                "mail": mock_mail,
                "email_service": mock_email_service,
                "dify_config": mock_dify_config,
            }

    def _create_test_workspace_and_accounts(self, db_session_with_containers):
        """
        Helper method to create test workspace and accounts for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure

        Returns:
            tuple: (inviter_account, tenant, invitee_email) - Created test data
        """
        fake = Faker()

        # Create inviter account
        inviter_account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status="active",
        )
        db.session.add(inviter_account)
        db.session.commit()

        # Create tenant (workspace)
        tenant = Tenant(
            name=fake.company(),
            status="normal",
        )
        db.session.add(tenant)
        db.session.commit()

        # Create tenant-account join for inviter
        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=inviter_account.id,
            role=TenantAccountRole.OWNER.value,
            current=True,
        )
        db.session.add(join)
        db.session.commit()

        # Generate invitee email
        invitee_email = fake.email()

        return inviter_account, tenant, invitee_email

    def test_send_invite_member_mail_success(self, db_session_with_containers, mock_external_service_dependencies):
        """Test successful invitation email sending."""
        # Arrange: Create test data
        inviter_account, tenant, invitee_email = self._create_test_workspace_and_accounts(db_session_with_containers)

        # Test parameters
        language = "en-US"
        token = "test_invitation_token_123"
        inviter_name = inviter_account.name
        workspace_name = tenant.name

        # Act: Execute the task
        send_invite_member_mail_task(
            language=language,
            to=invitee_email,
            token=token,
            inviter_name=inviter_name,
            workspace_name=workspace_name,
        )

        # Assert: Verify the expected outcomes
        mock_external_service_dependencies["mail"].is_inited.assert_called_once()
        mock_external_service_dependencies["email_service"].send_email.assert_called_once_with(
            email_type=EmailType.INVITE_MEMBER,
            language_code=language,
            to=invitee_email,
            template_context={
                "to": invitee_email,
                "inviter_name": inviter_name,
                "workspace_name": workspace_name,
                "url": f"{mock_external_service_dependencies['dify_config'].CONSOLE_WEB_URL}/activate?token={token}",
            },
        )

    def test_send_invite_member_mail_mail_not_initialized(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Test behavior when mail service is not initialized."""
        # Arrange: Setup mail service to return False
        mock_external_service_dependencies["mail"].is_inited.return_value = False

        # Test parameters
        language = "en-US"
        invitee_email = "test@example.com"
        token = "test_token"
        inviter_name = "Test Inviter"
        workspace_name = "Test Workspace"

        # Act: Execute the task
        result = send_invite_member_mail_task(
            language=language,
            to=invitee_email,
            token=token,
            inviter_name=inviter_name,
            workspace_name=workspace_name,
        )

        # Assert: Verify early return behavior
        assert result is None
        mock_external_service_dependencies["email_service"].send_email.assert_not_called()

    def test_send_invite_member_mail_exception_handling(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Test exception handling during email sending."""
        # Arrange: Create test data
        inviter_account, tenant, invitee_email = self._create_test_workspace_and_accounts(db_session_with_containers)

        # Setup email service to raise exception
        mock_external_service_dependencies["email_service"].send_email.side_effect = Exception("Email service error")

        # Test parameters
        language = "en-US"
        token = "test_token"
        inviter_name = "Test Inviter"
        workspace_name = "Test Workspace"

        # Act: Execute the task (should not raise exception)
        result = send_invite_member_mail_task(
            language=language,
            to=invitee_email,
            token=token,
            inviter_name=inviter_name,
            workspace_name=workspace_name,
        )

        # Assert: Verify exception handling
        assert result is None
        mock_external_service_dependencies["email_service"].send_email.assert_called_once()
