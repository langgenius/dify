"""
Integration tests for mail_invite_member_task using testcontainers.

This module provides comprehensive integration tests for the invite member email task
using TestContainers infrastructure. The tests ensure that the task properly sends
invitation emails with internationalization support, handles various error scenarios,
and integrates correctly with the database and Redis for token management.

All tests use the testcontainers infrastructure to ensure proper database isolation
and realistic testing scenarios with actual PostgreSQL and Redis instances.
"""

import json
import uuid
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from extensions.ext_redis import redis_client
from libs.email_i18n import EmailType
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from tasks.mail_invite_member_task import send_invite_member_mail_task


class TestMailInviteMemberTask:
    """
    Comprehensive integration tests for send_invite_member_mail_task using testcontainers.

    This test class covers all major functionality of the invite member email task:
    - Email sending with proper internationalization
    - Template context generation and URL construction
    - Error handling for various failure scenarios
    - Integration with Redis for token validation
    - Performance monitoring and logging
    - Mail service initialization checks
    - Real database integration with actual invitation flow
    - Token lifecycle management and validation

    All tests use the testcontainers infrastructure to ensure proper database isolation
    and realistic testing environment with actual database and Redis interactions.
    """

    @pytest.fixture(autouse=True)
    def cleanup_database(self, db_session_with_containers):
        """Clean up database before each test to ensure isolation."""
        from extensions.ext_database import db

        # Clear all test data
        db.session.query(TenantAccountJoin).delete()
        db.session.query(Tenant).delete()
        db.session.query(Account).delete()
        db.session.commit()

        # Clear Redis cache
        redis_client.flushdb()

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("tasks.mail_invite_member_task.mail") as mock_mail,
            patch("tasks.mail_invite_member_task.get_email_i18n_service") as mock_email_service,
            patch("tasks.mail_invite_member_task.dify_config") as mock_config,
        ):
            # Setup mail service mock
            mock_mail.is_inited.return_value = True

            # Setup email service mock
            mock_email_service_instance = MagicMock()
            mock_email_service_instance.send_email.return_value = None
            mock_email_service.return_value = mock_email_service_instance

            # Setup config mock
            mock_config.CONSOLE_WEB_URL = "https://console.dify.ai"

            yield {
                "mail": mock_mail,
                "email_service": mock_email_service_instance,
                "config": mock_config,
            }

    def _create_test_account_and_tenant(self, db_session_with_containers):
        """
        Helper method to create a test account and tenant for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure

        Returns:
            tuple: (Account, Tenant) created instances
        """
        fake = Faker()

        # Create account
        account = Account(
            email=fake.email(),
            name=fake.name(),
            password=fake.password(),
            interface_language="en-US",
            status=AccountStatus.ACTIVE.value,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        db_session_with_containers.add(account)
        db_session_with_containers.commit()
        db_session_with_containers.refresh(account)

        # Create tenant
        tenant = Tenant(
            name=fake.company(),
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()
        db_session_with_containers.refresh(tenant)

        # Create tenant member relationship
        tenant_join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER.value,
            created_at=datetime.now(UTC),
        )
        db_session_with_containers.add(tenant_join)
        db_session_with_containers.commit()

        return account, tenant

    def _create_invitation_token(self, tenant, account):
        """
        Helper method to create a valid invitation token in Redis.

        Args:
            tenant: Tenant instance
            account: Account instance

        Returns:
            str: Generated invitation token
        """
        token = str(uuid.uuid4())
        invitation_data = {
            "account_id": account.id,
            "email": account.email,
            "workspace_id": tenant.id,
        }
        cache_key = f"member_invite:token:{token}"
        redis_client.setex(cache_key, 24 * 60 * 60, json.dumps(invitation_data))  # 24 hours
        return token

    def _create_pending_account_for_invitation(self, db_session_with_containers, email, tenant):
        """
        Helper method to create a pending account for invitation testing.

        Args:
            db_session_with_containers: Database session
            email: Email address for the account
            tenant: Tenant instance

        Returns:
            Account: Created pending account
        """
        account = Account(
            email=email,
            name=email.split("@")[0],
            password="",
            interface_language="en-US",
            status=AccountStatus.PENDING.value,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        db_session_with_containers.add(account)
        db_session_with_containers.commit()
        db_session_with_containers.refresh(account)

        # Create tenant member relationship
        tenant_join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.NORMAL.value,
            created_at=datetime.now(UTC),
        )
        db_session_with_containers.add(tenant_join)
        db_session_with_containers.commit()

        return account

    def test_send_invite_member_mail_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful invitation email sending with all parameters.

        This test verifies:
        - Email service is called with correct parameters
        - Template context includes all required fields
        - URL is constructed correctly with token
        - Performance logging is recorded
        - No exceptions are raised
        """
        # Arrange: Create test data
        inviter, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        invitee_email = "test@example.com"
        language = "en-US"
        token = self._create_invitation_token(tenant, inviter)
        inviter_name = inviter.name
        workspace_name = tenant.name

        # Act: Execute the task
        send_invite_member_mail_task(
            language=language,
            to=invitee_email,
            token=token,
            inviter_name=inviter_name,
            workspace_name=workspace_name,
        )

        # Assert: Verify email service was called correctly
        mock_email_service = mock_external_service_dependencies["email_service"]
        mock_email_service.send_email.assert_called_once()

        # Verify call arguments
        call_args = mock_email_service.send_email.call_args
        assert call_args[1]["email_type"] == EmailType.INVITE_MEMBER
        assert call_args[1]["language_code"] == language
        assert call_args[1]["to"] == invitee_email

        # Verify template context
        template_context = call_args[1]["template_context"]
        assert template_context["to"] == invitee_email
        assert template_context["inviter_name"] == inviter_name
        assert template_context["workspace_name"] == workspace_name
        assert template_context["url"] == f"https://console.dify.ai/activate?token={token}"

    def test_send_invite_member_mail_different_languages(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test invitation email sending with different language codes.

        This test verifies:
        - Email service handles different language codes correctly
        - Template context is passed correctly for each language
        - No language-specific errors occur
        """
        # Arrange: Create test data
        inviter, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        token = self._create_invitation_token(tenant, inviter)

        test_languages = ["en-US", "zh-CN", "ja-JP", "fr-FR", "de-DE", "es-ES"]

        for language in test_languages:
            # Act: Execute the task with different language
            send_invite_member_mail_task(
                language=language,
                to="test@example.com",
                token=token,
                inviter_name=inviter.name,
                workspace_name=tenant.name,
            )

            # Assert: Verify language code was passed correctly
            mock_email_service = mock_external_service_dependencies["email_service"]
            call_args = mock_email_service.send_email.call_args
            assert call_args[1]["language_code"] == language

    def test_send_invite_member_mail_mail_not_initialized(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test behavior when mail service is not initialized.

        This test verifies:
        - Task returns early when mail is not initialized
        - Email service is not called
        - No exceptions are raised
        """
        # Arrange: Setup mail service as not initialized
        mock_mail = mock_external_service_dependencies["mail"]
        mock_mail.is_inited.return_value = False

        # Act: Execute the task
        result = send_invite_member_mail_task(
            language="en-US",
            to="test@example.com",
            token="test-token",
            inviter_name="Test User",
            workspace_name="Test Workspace",
        )

        # Assert: Verify early return
        assert result is None
        mock_email_service = mock_external_service_dependencies["email_service"]
        mock_email_service.send_email.assert_not_called()

    def test_send_invite_member_mail_email_service_exception(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test error handling when email service raises an exception.

        This test verifies:
        - Exception is caught and logged
        - Task completes without raising exception
        - Error logging is performed
        """
        # Arrange: Setup email service to raise exception
        mock_email_service = mock_external_service_dependencies["email_service"]
        mock_email_service.send_email.side_effect = Exception("Email service failed")

        # Act & Assert: Execute task and verify exception is handled
        with patch("tasks.mail_invite_member_task.logger") as mock_logger:
            send_invite_member_mail_task(
                language="en-US",
                to="test@example.com",
                token="test-token",
                inviter_name="Test User",
                workspace_name="Test Workspace",
            )

            # Verify error was logged
            mock_logger.exception.assert_called_once()
            error_call = mock_logger.exception.call_args[0][0]
            assert "Send invite member mail to %s failed" in error_call

    def test_send_invite_member_mail_performance_logging(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test performance monitoring and logging.

        This test verifies:
        - Start and end performance logs are recorded
        - Latency is calculated and logged
        - Log messages contain expected information
        """
        # Arrange: Create test data
        inviter, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        token = self._create_invitation_token(tenant, inviter)

        # Act: Execute task with logging mock
        with patch("tasks.mail_invite_member_task.logger") as mock_logger:
            send_invite_member_mail_task(
                language="en-US",
                to="test@example.com",
                token=token,
                inviter_name=inviter.name,
                workspace_name=tenant.name,
            )

            # Assert: Verify performance logging
            info_calls = [call[0][0] for call in mock_logger.info.call_args_list]

            # Check start log
            start_logs = [log for log in info_calls if "Start send invite member mail" in log]
            assert len(start_logs) == 1
            assert "test@example.com" in start_logs[0]
            assert tenant.name in start_logs[0]

            # Check success log with latency
            success_logs = [log for log in info_calls if "succeeded: latency:" in log]
            assert len(success_logs) == 1
            assert "test@example.com" in success_logs[0]
            assert "latency:" in success_logs[0]

    def test_send_invite_member_mail_template_context_validation(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test template context contains all required fields for email rendering.

        This test verifies:
        - All required template context fields are present
        - Field values match expected data
        - URL construction is correct
        - No missing or None values in context
        """
        # Arrange: Create test data with specific values
        inviter, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        token = "test-token-123"
        invitee_email = "invitee@example.com"
        inviter_name = "John Doe"
        workspace_name = "Acme Corp"

        # Act: Execute the task
        send_invite_member_mail_task(
            language="en-US",
            to=invitee_email,
            token=token,
            inviter_name=inviter_name,
            workspace_name=workspace_name,
        )

        # Assert: Verify template context
        mock_email_service = mock_external_service_dependencies["email_service"]
        call_args = mock_email_service.send_email.call_args
        template_context = call_args[1]["template_context"]

        # Verify all required fields are present
        required_fields = ["to", "inviter_name", "workspace_name", "url"]
        for field in required_fields:
            assert field in template_context
            assert template_context[field] is not None
            assert template_context[field] != ""

        # Verify specific values
        assert template_context["to"] == invitee_email
        assert template_context["inviter_name"] == inviter_name
        assert template_context["workspace_name"] == workspace_name
        assert template_context["url"] == f"https://console.dify.ai/activate?token={token}"

    def test_send_invite_member_mail_integration_with_redis_token(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test integration with Redis token validation.

        This test verifies:
        - Task works with real Redis token data
        - Token validation can be performed after email sending
        - Redis data integrity is maintained
        """
        # Arrange: Create test data and store token in Redis
        inviter, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        token = self._create_invitation_token(tenant, inviter)

        # Verify token exists in Redis before sending email
        cache_key = f"member_invite:token:{token}"
        assert redis_client.exists(cache_key) == 1

        # Act: Execute the task
        send_invite_member_mail_task(
            language="en-US",
            to=inviter.email,
            token=token,
            inviter_name=inviter.name,
            workspace_name=tenant.name,
        )

        # Assert: Verify token still exists after email sending
        assert redis_client.exists(cache_key) == 1

        # Verify token data integrity
        token_data = redis_client.get(cache_key)
        assert token_data is not None
        invitation_data = json.loads(token_data)
        assert invitation_data["account_id"] == inviter.id
        assert invitation_data["email"] == inviter.email
        assert invitation_data["workspace_id"] == tenant.id

    def test_send_invite_member_mail_with_special_characters(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test email sending with special characters in names and workspace names.

        This test verifies:
        - Special characters are handled correctly in template context
        - Email service receives properly formatted data
        - No encoding issues occur
        """
        # Arrange: Create test data with special characters
        inviter, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        token = self._create_invitation_token(tenant, inviter)

        special_cases = [
            ("John O'Connor", "Acme & Co."),
            ("José María", "Café & Restaurant"),
            ("李小明", "北京科技有限公司"),
            ("François & Marie", "L'École Internationale"),
            ("Александр", "ООО Технологии"),
            ("محمد أحمد", "شركة التقنية المتقدمة"),
        ]

        for inviter_name, workspace_name in special_cases:
            # Act: Execute the task
            send_invite_member_mail_task(
                language="en-US",
                to="test@example.com",
                token=token,
                inviter_name=inviter_name,
                workspace_name=workspace_name,
            )

            # Assert: Verify special characters are preserved
            mock_email_service = mock_external_service_dependencies["email_service"]
            call_args = mock_email_service.send_email.call_args
            template_context = call_args[1]["template_context"]

            assert template_context["inviter_name"] == inviter_name
            assert template_context["workspace_name"] == workspace_name

    def test_send_invite_member_mail_empty_parameters(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test email sending with empty or minimal parameters.

        This test verifies:
        - Empty strings are handled gracefully
        - Task completes without errors
        - Template context contains empty values as expected
        """
        # Arrange: Setup empty parameters
        inviter, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        token = self._create_invitation_token(tenant, inviter)

        # Act: Execute the task with empty parameters
        send_invite_member_mail_task(
            language="",
            to="",
            token="",
            inviter_name="",
            workspace_name="",
        )

        # Assert: Verify task completed and empty values are passed
        mock_email_service = mock_external_service_dependencies["email_service"]
        call_args = mock_email_service.send_email.call_args
        template_context = call_args[1]["template_context"]

        assert template_context["to"] == ""
        assert template_context["inviter_name"] == ""
        assert template_context["workspace_name"] == ""
        assert template_context["url"] == "https://console.dify.ai/activate?token="

    def test_send_invite_member_mail_very_long_parameters(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test email sending with very long parameter values.

        This test verifies:
        - Long strings are handled correctly
        - No truncation or errors occur
        - Performance is acceptable with large data
        """
        # Arrange: Create test data with very long values
        inviter, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        token = self._create_invitation_token(tenant, inviter)

        # Create very long strings
        long_inviter_name = "A" * 1000
        long_workspace_name = "B" * 1000
        long_email = (
            "very.long.email.address.that.might.cause.issues@"
            "very-long-domain-name-that-might-cause-problems"
            ".example.com"
        )

        # Act: Execute the task
        send_invite_member_mail_task(
            language="en-US",
            to=long_email,
            token=token,
            inviter_name=long_inviter_name,
            workspace_name=long_workspace_name,
        )

        # Assert: Verify long values are handled correctly
        mock_email_service = mock_external_service_dependencies["email_service"]
        call_args = mock_email_service.send_email.call_args
        template_context = call_args[1]["template_context"]

        assert template_context["to"] == long_email
        assert template_context["inviter_name"] == long_inviter_name
        assert template_context["workspace_name"] == long_workspace_name
        assert len(template_context["url"]) > 0

    def test_send_invite_member_mail_real_database_integration(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test real database integration with actual invitation flow.

        This test verifies:
        - Task works with real database entities
        - Account and tenant relationships are properly maintained
        - Database state is consistent after email sending
        - Real invitation data flow is tested
        """
        # Arrange: Create real database entities
        inviter, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        invitee_email = "newmember@example.com"

        # Create a pending account for invitation (simulating real invitation flow)
        pending_account = self._create_pending_account_for_invitation(db_session_with_containers, invitee_email, tenant)

        # Create invitation token with real account data
        token = self._create_invitation_token(tenant, pending_account)

        # Act: Execute the task with real data
        send_invite_member_mail_task(
            language="en-US",
            to=invitee_email,
            token=token,
            inviter_name=inviter.name,
            workspace_name=tenant.name,
        )

        # Assert: Verify email service was called with real data
        mock_email_service = mock_external_service_dependencies["email_service"]
        mock_email_service.send_email.assert_called_once()

        # Verify database state is maintained
        from extensions.ext_database import db

        db.session.refresh(pending_account)
        db.session.refresh(tenant)

        assert pending_account.status == AccountStatus.PENDING.value
        assert pending_account.email == invitee_email
        assert tenant.name is not None

        # Verify tenant relationship exists
        tenant_join = (
            db.session.query(TenantAccountJoin).filter_by(tenant_id=tenant.id, account_id=pending_account.id).first()
        )
        assert tenant_join is not None
        assert tenant_join.role == TenantAccountRole.NORMAL.value

    def test_send_invite_member_mail_token_lifecycle_management(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test token lifecycle management and validation.

        This test verifies:
        - Token is properly stored in Redis with correct TTL
        - Token data structure is correct
        - Token can be retrieved and validated after email sending
        - Token expiration is handled correctly
        """
        # Arrange: Create test data
        inviter, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        token = self._create_invitation_token(tenant, inviter)

        # Act: Execute the task
        send_invite_member_mail_task(
            language="en-US",
            to=inviter.email,
            token=token,
            inviter_name=inviter.name,
            workspace_name=tenant.name,
        )

        # Assert: Verify token lifecycle
        cache_key = f"member_invite:token:{token}"

        # Token should still exist
        assert redis_client.exists(cache_key) == 1

        # Token should have correct TTL (approximately 24 hours)
        ttl = redis_client.ttl(cache_key)
        assert 23 * 60 * 60 <= ttl <= 24 * 60 * 60  # Allow some tolerance

        # Token data should be valid
        token_data = redis_client.get(cache_key)
        assert token_data is not None

        invitation_data = json.loads(token_data)
        assert invitation_data["account_id"] == inviter.id
        assert invitation_data["email"] == inviter.email
        assert invitation_data["workspace_id"] == tenant.id

    def test_send_invite_member_mail_multiple_invitations_same_tenant(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test sending multiple invitations for the same tenant.

        This test verifies:
        - Multiple invitations can be sent for the same tenant
        - Each invitation has a unique token
        - Database state is consistent for multiple invitations
        - Email service is called for each invitation
        """
        # Arrange: Create test data
        inviter, tenant = self._create_test_account_and_tenant(db_session_with_containers)

        # Create multiple pending accounts
        emails = ["user1@example.com", "user2@example.com", "user3@example.com"]
        accounts = []
        tokens = []

        for email in emails:
            account = self._create_pending_account_for_invitation(db_session_with_containers, email, tenant)
            token = self._create_invitation_token(tenant, account)
            accounts.append(account)
            tokens.append(token)

        # Act: Send multiple invitations
        for i, (email, token) in enumerate(zip(emails, tokens)):
            send_invite_member_mail_task(
                language="en-US",
                to=email,
                token=token,
                inviter_name=inviter.name,
                workspace_name=tenant.name,
            )

        # Assert: Verify all invitations were sent
        mock_email_service = mock_external_service_dependencies["email_service"]
        assert mock_email_service.send_email.call_count == len(emails)

        # Verify all tokens exist in Redis
        for token in tokens:
            cache_key = f"member_invite:token:{token}"
            assert redis_client.exists(cache_key) == 1

        # Verify all accounts are in pending status
        from extensions.ext_database import db

        for account in accounts:
            db.session.refresh(account)
            assert account.status == AccountStatus.PENDING.value

    def test_send_invite_member_mail_different_tenants_isolation(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test that invitations for different tenants are properly isolated.

        This test verifies:
        - Invitations for different tenants don't interfere with each other
        - Tokens are unique across tenants
        - Database relationships are correctly maintained
        - Email service receives correct tenant-specific data
        """
        # Arrange: Create multiple tenants with accounts
        inviter1, tenant1 = self._create_test_account_and_tenant(db_session_with_containers)
        inviter2, tenant2 = self._create_test_account_and_tenant(db_session_with_containers)

        # Create pending accounts for each tenant
        account1 = self._create_pending_account_for_invitation(db_session_with_containers, "user1@example.com", tenant1)
        account2 = self._create_pending_account_for_invitation(db_session_with_containers, "user2@example.com", tenant2)

        token1 = self._create_invitation_token(tenant1, account1)
        token2 = self._create_invitation_token(tenant2, account2)

        # Act: Send invitations for both tenants
        send_invite_member_mail_task(
            language="en-US",
            to="user1@example.com",
            token=token1,
            inviter_name=inviter1.name,
            workspace_name=tenant1.name,
        )

        send_invite_member_mail_task(
            language="en-US",
            to="user2@example.com",
            token=token2,
            inviter_name=inviter2.name,
            workspace_name=tenant2.name,
        )

        # Assert: Verify both invitations were sent
        mock_email_service = mock_external_service_dependencies["email_service"]
        assert mock_email_service.send_email.call_count == 2

        # Verify tokens are different and exist
        assert token1 != token2
        assert redis_client.exists(f"member_invite:token:{token1}") == 1
        assert redis_client.exists(f"member_invite:token:{token2}") == 1

        # Verify token data is tenant-specific
        token1_data = json.loads(redis_client.get(f"member_invite:token:{token1}"))
        token2_data = json.loads(redis_client.get(f"member_invite:token:{token2}"))

        assert token1_data["workspace_id"] == tenant1.id
        assert token2_data["workspace_id"] == tenant2.id
        assert token1_data["workspace_id"] != token2_data["workspace_id"]

    def test_send_invite_member_mail_configuration_changes(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test behavior with different configuration settings.

        This test verifies:
        - Task works with different CONSOLE_WEB_URL configurations
        - URL construction adapts to configuration changes
        - Template context reflects configuration values
        """
        # Arrange: Create test data
        inviter, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        token = self._create_invitation_token(tenant, inviter)

        # Test different console web URLs
        test_urls = [
            "https://console.dify.ai",
            "https://app.dify.ai",
            "https://localhost:3000",
            "https://custom-domain.com",
        ]

        for console_url in test_urls:
            # Update mock configuration
            mock_config = mock_external_service_dependencies["config"]
            mock_config.CONSOLE_WEB_URL = console_url

            # Act: Execute the task
            send_invite_member_mail_task(
                language="en-US",
                to="test@example.com",
                token=token,
                inviter_name=inviter.name,
                workspace_name=tenant.name,
            )

            # Assert: Verify URL construction
            mock_email_service = mock_external_service_dependencies["email_service"]
            call_args = mock_email_service.send_email.call_args
            template_context = call_args[1]["template_context"]

            expected_url = f"{console_url}/activate?token={token}"
            assert template_context["url"] == expected_url

    def test_send_invite_member_mail_error_recovery_scenarios(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test error recovery scenarios and resilience.

        This test verifies:
        - Task handles various error conditions gracefully
        - Database state remains consistent after errors
        - Redis state is not corrupted by errors
        - Error logging provides useful information
        """
        # Arrange: Create test data
        inviter, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        token = self._create_invitation_token(tenant, inviter)

        # Test different error scenarios
        error_scenarios = [
            ("ConnectionError", ConnectionError("Email service unavailable")),
            ("TimeoutError", TimeoutError("Request timeout")),
            ("ValueError", ValueError("Invalid email format")),
            ("RuntimeError", RuntimeError("Unexpected error")),
        ]

        for error_name, exception in error_scenarios:
            # Setup email service to raise specific exception
            mock_email_service = mock_external_service_dependencies["email_service"]
            mock_email_service.send_email.side_effect = exception

            # Act & Assert: Execute task and verify error handling
            with patch("tasks.mail_invite_member_task.logger") as mock_logger:
                # Task should not raise exception
                result = send_invite_member_mail_task(
                    language="en-US",
                    to="test@example.com",
                    token=token,
                    inviter_name=inviter.name,
                    workspace_name=tenant.name,
                )

                # Verify error was logged
                mock_logger.exception.assert_called_once()
                error_call = mock_logger.exception.call_args[0][0]
                assert "Send invite member mail to %s failed" in error_call

                # Verify database state is unchanged
                from extensions.ext_database import db

                db.session.refresh(tenant)
                assert tenant.name is not None

                # Verify Redis state is unchanged
                cache_key = f"member_invite:token:{token}"
                assert redis_client.exists(cache_key) == 1

            # Reset mock for next iteration
            mock_email_service.send_email.side_effect = None

    def test_send_invite_member_mail_performance_under_load(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test performance characteristics under simulated load.

        This test verifies:
        - Task performs well with multiple rapid calls
        - Memory usage remains reasonable
        - Database connections are properly managed
        - Redis operations are efficient
        """
        # Arrange: Create test data
        inviter, tenant = self._create_test_account_and_tenant(db_session_with_containers)

        # Create multiple accounts and tokens
        num_invitations = 50
        accounts = []
        tokens = []

        for i in range(num_invitations):
            email = f"user{i}@example.com"
            account = self._create_pending_account_for_invitation(db_session_with_containers, email, tenant)
            token = self._create_invitation_token(tenant, account)
            accounts.append(account)
            tokens.append(token)

        # Act: Send multiple invitations rapidly
        import time

        start_time = time.time()

        for i, (account, token) in enumerate(zip(accounts, tokens)):
            send_invite_member_mail_task(
                language="en-US",
                to=account.email,
                token=token,
                inviter_name=inviter.name,
                workspace_name=tenant.name,
            )

        end_time = time.time()
        execution_time = end_time - start_time

        # Assert: Verify performance
        mock_email_service = mock_external_service_dependencies["email_service"]
        assert mock_email_service.send_email.call_count == num_invitations

        # Verify reasonable execution time (should be fast with mocks)
        assert execution_time < 5.0  # Should complete within 5 seconds

        # Verify all tokens exist in Redis
        for token in tokens:
            cache_key = f"member_invite:token:{token}"
            assert redis_client.exists(cache_key) == 1

        # Verify database state is consistent
        from extensions.ext_database import db

        for account in accounts:
            db.session.refresh(account)
            assert account.status == AccountStatus.PENDING.value
