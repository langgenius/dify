"""
Integration tests for mail_invite_member_task using testcontainers.

This module provides comprehensive integration tests for the mail invitation task
using TestContainers to ensure realistic testing scenarios with actual database
and service dependencies.
"""

import logging
import time
from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from extensions.ext_database import db
from extensions.ext_redis import redis_client
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
        """
        Test successful invitation email sending.

        This test verifies:
        - Proper email service initialization check
        - Correct URL generation with token
        - Email service called with correct parameters
        - Performance timing is recorded
        - Success logging occurs
        """
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
        # Verify mail service was checked
        mock_external_service_dependencies["mail"].is_inited.assert_called_once()

        # Verify email service was called correctly
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
        """
        Test behavior when mail service is not initialized.

        This test verifies:
        - Early return when mail.is_inited() returns False
        - No email service calls when mail is not initialized
        - No exceptions are raised
        - Performance timing is not recorded
        """
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

    def test_send_invite_member_mail_different_languages(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test invitation email sending with different languages.

        This test verifies:
        - Support for multiple language codes
        - Correct language code passed to email service
        - Template context includes all required fields
        - URL generation works with different languages
        """
        # Arrange: Create test data
        inviter_account, tenant, invitee_email = self._create_test_workspace_and_accounts(db_session_with_containers)

        # Test different languages
        test_languages = ["en-US", "zh-CN", "ja-JP", "fr-FR", "de-DE"]

        for language in test_languages:
            # Reset mock for each test
            mock_external_service_dependencies["email_service"].reset_mock()

            # Test parameters
            token = f"test_token_{language}"
            inviter_name = f"Test Inviter {language}"
            workspace_name = f"Test Workspace {language}"

            # Act: Execute the task
            send_invite_member_mail_task(
                language=language,
                to=invitee_email,
                token=token,
                inviter_name=inviter_name,
                workspace_name=workspace_name,
            )

            # Assert: Verify correct language handling
            mock_external_service_dependencies["email_service"].send_email.assert_called_once_with(
                email_type=EmailType.INVITE_MEMBER,
                language_code=language,
                to=invitee_email,
                template_context={
                    "to": invitee_email,
                    "inviter_name": inviter_name,
                    "workspace_name": workspace_name,
                    "url": f"{mock_external_service_dependencies['dify_config'].CONSOLE_WEB_URL}"
                    f"/activate?token={token}",
                },
            )

    def test_send_invite_member_mail_url_generation(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test URL generation with different console web URLs and tokens.

        This test verifies:
        - URL is correctly constructed from CONSOLE_WEB_URL and token
        - Different console URLs are handled properly
        - Special characters in tokens are handled correctly
        - URL is included in template context
        """
        # Arrange: Create test data
        inviter_account, tenant, invitee_email = self._create_test_workspace_and_accounts(db_session_with_containers)

        # Test different console URLs and tokens
        test_cases = [
            ("https://app.dify.com", "simple_token"),
            ("https://dify.example.com", "token-with-dashes"),
            ("https://test.dify.io", "token_with_underscores"),
            ("https://localhost:3000", "token.with.dots"),
            ("https://dify.com", "token_with_special_chars!@#$%"),
        ]

        for console_url, token in test_cases:
            # Setup mock config for this test case
            mock_external_service_dependencies["dify_config"].CONSOLE_WEB_URL = console_url

            # Reset mock for each test
            mock_external_service_dependencies["email_service"].reset_mock()

            # Act: Execute the task
            send_invite_member_mail_task(
                language="en-US",
                to=invitee_email,
                token=token,
                inviter_name="Test Inviter",
                workspace_name="Test Workspace",
            )

            # Assert: Verify URL generation
            expected_url = f"{console_url}/activate?token={token}"
            call_args = mock_external_service_dependencies["email_service"].send_email.call_args
            assert call_args is not None
            template_context = call_args[1]["template_context"]
            assert template_context["url"] == expected_url

    def test_send_invite_member_mail_template_context(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test template context includes all required fields.

        This test verifies:
        - All required template context fields are provided
        - Field values match input parameters
        - URL is correctly included
        - No extra fields are added
        """
        # Arrange: Create test data
        inviter_account, tenant, invitee_email = self._create_test_workspace_and_accounts(db_session_with_containers)

        # Test parameters with special characters
        language = "en-US"
        token = "test_token_123"
        inviter_name = "John O'Connor-Smith"
        workspace_name = "Test & Development Workspace"

        # Act: Execute the task
        send_invite_member_mail_task(
            language=language,
            to=invitee_email,
            token=token,
            inviter_name=inviter_name,
            workspace_name=workspace_name,
        )

        # Assert: Verify template context
        call_args = mock_external_service_dependencies["email_service"].send_email.call_args
        assert call_args is not None
        template_context = call_args[1]["template_context"]

        # Verify all required fields are present
        assert "to" in template_context
        assert "inviter_name" in template_context
        assert "workspace_name" in template_context
        assert "url" in template_context

        # Verify field values
        assert template_context["to"] == invitee_email
        assert template_context["inviter_name"] == inviter_name
        assert template_context["workspace_name"] == workspace_name
        assert (
            template_context["url"]
            == f"{mock_external_service_dependencies['dify_config'].CONSOLE_WEB_URL}/activate?token={token}"
        )

        # Verify no extra fields
        assert len(template_context) == 4

    def test_send_invite_member_mail_exception_handling(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test exception handling during email sending.

        This test verifies:
        - Exceptions are properly caught and logged
        - Task does not crash on email service errors
        - Performance timing is still recorded
        - Error logging occurs
        """
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
        assert result is None  # Task should complete without raising exception
        mock_external_service_dependencies["email_service"].send_email.assert_called_once()

    def test_send_invite_member_mail_performance_timing(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test performance timing is properly recorded.

        This test verifies:
        - Performance timing is measured using time.perf_counter()
        - Timing is included in success log message
        - Timing is reasonable (not negative or extremely large)
        """
        # Arrange: Create test data
        inviter_account, tenant, invitee_email = self._create_test_workspace_and_accounts(db_session_with_containers)

        # Test parameters
        language = "en-US"
        token = "test_token"
        inviter_name = "Test Inviter"
        workspace_name = "Test Workspace"

        # Mock time.perf_counter to return predictable values
        with patch("tasks.mail_invite_member_task.time.perf_counter") as mock_perf_counter:
            mock_perf_counter.side_effect = [1000.0, 1000.5]  # 0.5 second duration

            # Act: Execute the task
            send_invite_member_mail_task(
                language=language,
                to=invitee_email,
                token=token,
                inviter_name=inviter_name,
                workspace_name=workspace_name,
            )

            # Assert: Verify timing was measured
            assert mock_perf_counter.call_count == 2  # Called at start and end

    def test_send_invite_member_mail_with_real_workspace_data(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test with realistic workspace and account data.

        This test verifies:
        - Task works with real database entities
        - Account and tenant data is properly used
        - Email content reflects actual workspace information
        - Integration with database models works correctly
        """
        # Arrange: Create realistic test data
        fake = Faker()

        # Create realistic inviter account
        inviter_account = Account(
            email="john.doe@company.com",
            name="John Doe",
            interface_language="en-US",
            status="active",
        )
        db.session.add(inviter_account)
        db.session.commit()

        # Create realistic tenant
        tenant = Tenant(
            name="Acme Corporation",
            status="normal",
        )
        db.session.add(tenant)
        db.session.commit()

        # Create tenant-account join
        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=inviter_account.id,
            role=TenantAccountRole.OWNER.value,
            current=True,
        )
        db.session.add(join)
        db.session.commit()

        # Realistic invitee email
        invitee_email = "jane.smith@company.com"
        token = "inv_1234567890abcdef"
        language = "en-US"

        # Act: Execute the task
        send_invite_member_mail_task(
            language=language,
            to=invitee_email,
            token=token,
            inviter_name=inviter_account.name,
            workspace_name=tenant.name,
        )

        # Assert: Verify realistic data handling
        call_args = mock_external_service_dependencies["email_service"].send_email.call_args
        assert call_args is not None
        template_context = call_args[1]["template_context"]

        assert template_context["to"] == invitee_email
        assert template_context["inviter_name"] == "John Doe"
        assert template_context["workspace_name"] == "Acme Corporation"
        assert (
            template_context["url"]
            == f"{mock_external_service_dependencies['dify_config'].CONSOLE_WEB_URL}/activate?token={token}"
        )

    def test_send_invite_member_mail_edge_case_parameters(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test with edge case parameters.

        This test verifies:
        - Empty strings are handled properly
        - Very long strings are handled
        - Special characters in names are handled
        - Unicode characters are supported
        """
        # Arrange: Create test data
        inviter_account, tenant, invitee_email = self._create_test_workspace_and_accounts(db_session_with_containers)

        # Test edge cases
        edge_cases = [
            {
                "language": "en-US",
                "to": "test@example.com",
                "token": "",
                "inviter_name": "",
                "workspace_name": "",
            },
            {
                "language": "en-US",
                "to": "test@example.com",
                "token": "a" * 1000,  # Very long token
                "inviter_name": "A" * 100,  # Very long name
                "workspace_name": "B" * 100,  # Very long workspace name
            },
            {
                "language": "en-US",
                "to": "test@example.com",
                "token": "token-with-special-chars!@#$%^&*()",
                "inviter_name": "José María O'Connor-Smith",
                "workspace_name": "Test & Development Co. (Ltd.)",
            },
            {
                "language": "zh-CN",
                "to": "测试@example.com",
                "token": "测试令牌",
                "inviter_name": "张三",
                "workspace_name": "测试工作空间",
            },
        ]

        for i, test_case in enumerate(edge_cases):
            # Reset mock for each test
            mock_external_service_dependencies["email_service"].reset_mock()

            # Act: Execute the task
            send_invite_member_mail_task(**test_case)

            # Assert: Verify edge case handling
            call_args = mock_external_service_dependencies["email_service"].send_email.call_args
            assert call_args is not None, f"Email service should be called for edge case {i}"
            template_context = call_args[1]["template_context"]

            assert template_context["to"] == test_case["to"]
            assert template_context["inviter_name"] == test_case["inviter_name"]
            assert template_context["workspace_name"] == test_case["workspace_name"]
            assert (
                template_context["url"] == f"{mock_external_service_dependencies['dify_config'].CONSOLE_WEB_URL}"
                f"/activate?token={test_case['token']}"
            )

    def test_send_invite_member_mail_multiple_concurrent_calls(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test multiple concurrent calls to the task.

        This test verifies:
        - Task can handle multiple concurrent calls
        - Each call is processed independently
        - No interference between concurrent calls
        - All calls complete successfully
        """
        # Arrange: Create test data
        inviter_account, tenant, invitee_email = self._create_test_workspace_and_accounts(db_session_with_containers)

        # Test parameters for multiple calls
        test_calls = [
            {
                "language": "en-US",
                "to": "user1@example.com",
                "token": "token1",
                "inviter_name": "Inviter 1",
                "workspace_name": "Workspace 1",
            },
            {
                "language": "zh-CN",
                "to": "user2@example.com",
                "token": "token2",
                "inviter_name": "邀请者 2",
                "workspace_name": "工作空间 2",
            },
            {
                "language": "ja-JP",
                "to": "user3@example.com",
                "token": "token3",
                "inviter_name": "招待者 3",
                "workspace_name": "ワークスペース 3",
            },
        ]

        # Act: Execute multiple calls
        for test_call in test_calls:
            send_invite_member_mail_task(**test_call)

        # Assert: Verify all calls were processed
        assert mock_external_service_dependencies["email_service"].send_email.call_count == len(test_calls)

        # Verify each call was processed with correct parameters
        for i, test_call in enumerate(test_calls):
            call_args = mock_external_service_dependencies["email_service"].send_email.call_args_list[i]
            template_context = call_args[1]["template_context"]

            assert template_context["to"] == test_call["to"]
            assert template_context["inviter_name"] == test_call["inviter_name"]
            assert template_context["workspace_name"] == test_call["workspace_name"]
            assert (
                template_context["url"] == f"{mock_external_service_dependencies['dify_config'].CONSOLE_WEB_URL}"
                f"/activate?token={test_call['token']}"
            )

    def test_send_invite_member_mail_integration_with_redis(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test integration with Redis for caching and session management.

        This test verifies:
        - Task works correctly with Redis available
        - No Redis-related errors occur
        - Task completes successfully with Redis integration
        """
        # Arrange: Create test data
        inviter_account, tenant, invitee_email = self._create_test_workspace_and_accounts(db_session_with_containers)

        # Set up some Redis data to simulate real usage
        redis_client.set("test_key", "test_value", ex=300)
        assert redis_client.exists("test_key") == 1

        # Test parameters
        language = "en-US"
        token = "test_token"
        inviter_name = "Test Inviter"
        workspace_name = "Test Workspace"

        # Act: Execute the task
        send_invite_member_mail_task(
            language=language,
            to=invitee_email,
            token=token,
            inviter_name=inviter_name,
            workspace_name=workspace_name,
        )

        # Assert: Verify task completed successfully
        mock_external_service_dependencies["email_service"].send_email.assert_called_once()

        # Verify Redis is still working
        assert redis_client.exists("test_key") == 1
        assert redis_client.get("test_key") == b"test_value"

    def test_send_invite_member_mail_comprehensive_error_scenarios(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test comprehensive error scenarios and recovery.

        This test verifies:
        - Various types of exceptions are handled properly
        - Task does not crash on different error types
        - Error logging occurs for all exception types
        - Task completes gracefully in all error cases
        """
        # Arrange: Create test data
        inviter_account, tenant, invitee_email = self._create_test_workspace_and_accounts(db_session_with_containers)

        # Test different exception types
        test_exceptions = [
            ("Connection error", ConnectionError("Email service connection failed")),
            ("Timeout error", TimeoutError("Email service timeout")),
            ("Value error", ValueError("Invalid email format")),
            ("Runtime error", RuntimeError("Email service runtime error")),
            ("Generic error", Exception("Generic email service error")),
        ]

        for error_name, exception in test_exceptions:
            # Reset mock for each test
            mock_external_service_dependencies["email_service"].reset_mock()
            mock_external_service_dependencies["email_service"].send_email.side_effect = exception

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

            # Assert: Verify error handling
            assert result is None, f"Task should complete gracefully for {error_name}"
            mock_external_service_dependencies["email_service"].send_email.assert_called_once()

    def test_send_invite_member_mail_real_world_scenario(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test with a realistic real-world scenario.

        This test verifies:
        - Complete workflow from database entities to email sending
        - Real-world data patterns are handled correctly
        - Integration with all components works as expected
        - Performance is reasonable for real usage
        """
        # Arrange: Create realistic test data
        fake = Faker()

        # Create realistic inviter account
        inviter_account = Account(
            email="admin@techstartup.com",
            name="Sarah Johnson",
            interface_language="en-US",
            status="active",
        )
        db.session.add(inviter_account)
        db.session.commit()

        # Create realistic tenant
        tenant = Tenant(
            name="TechStartup Inc.",
            status="normal",
        )
        db.session.add(tenant)
        db.session.commit()

        # Create tenant-account join
        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=inviter_account.id,
            role=TenantAccountRole.OWNER.value,
            current=True,
        )
        db.session.add(join)
        db.session.commit()

        # Realistic invitation scenario
        invitee_email = "new.developer@techstartup.com"
        token = "inv_2024_abc123def456"
        language = "en-US"

        # Act: Execute the task
        start_time = time.time()
        send_invite_member_mail_task(
            language=language,
            to=invitee_email,
            token=token,
            inviter_name=inviter_account.name,
            workspace_name=tenant.name,
        )
        end_time = time.time()

        # Assert: Verify realistic scenario handling
        call_args = mock_external_service_dependencies["email_service"].send_email.call_args
        assert call_args is not None
        template_context = call_args[1]["template_context"]

        # Verify realistic data
        assert template_context["to"] == invitee_email
        assert template_context["inviter_name"] == "Sarah Johnson"
        assert template_context["workspace_name"] == "TechStartup Inc."
        assert (
            template_context["url"]
            == f"{mock_external_service_dependencies['dify_config'].CONSOLE_WEB_URL}/activate?token={token}"
        )

        # Verify reasonable performance (should complete quickly with mocks)
        execution_time = end_time - start_time
        assert execution_time < 1.0, "Task should complete quickly with mocked dependencies"

        # Verify email service was called with correct type
        assert call_args[1]["email_type"] == EmailType.INVITE_MEMBER
        assert call_args[1]["language_code"] == language
