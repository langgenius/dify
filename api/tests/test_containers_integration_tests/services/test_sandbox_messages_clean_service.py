"""
Integration tests for SandboxMessagesCleanService using testcontainers.

This module provides comprehensive integration tests for the sandbox message cleanup service
using TestContainers infrastructure with real PostgreSQL and Redis.
"""

import datetime
import json
import uuid
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from enums.cloud_plan import CloudPlan
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.model import (
    App,
    AppAnnotationHitHistory,
    Conversation,
    DatasetRetrieverResource,
    Message,
    MessageAgentThought,
    MessageAnnotation,
    MessageChain,
    MessageFeedback,
    MessageFile,
)
from models.web import SavedMessage
from services.sandbox_messages_clean_service import SandboxMessagesCleanService


class TestSandboxMessagesCleanServiceIntegration:
    """Integration tests for SandboxMessagesCleanService._clean_sandbox_messages_by_time_range."""

    @pytest.fixture(autouse=True)
    def cleanup_database(self, db_session_with_containers):
        """Clean up database before and after each test to ensure isolation."""
        yield
        # Clear all test data in correct order (respecting foreign key constraints)
        db.session.query(DatasetRetrieverResource).delete()
        db.session.query(AppAnnotationHitHistory).delete()
        db.session.query(SavedMessage).delete()
        db.session.query(MessageFile).delete()
        db.session.query(MessageAgentThought).delete()
        db.session.query(MessageChain).delete()
        db.session.query(MessageAnnotation).delete()
        db.session.query(MessageFeedback).delete()
        db.session.query(Message).delete()
        db.session.query(Conversation).delete()
        db.session.query(App).delete()
        db.session.query(TenantAccountJoin).delete()
        db.session.query(Tenant).delete()
        db.session.query(Account).delete()
        db.session.commit()

    @pytest.fixture(autouse=True)
    def cleanup_redis(self):
        """Clean up Redis cache before each test."""
        # Clear tenant plan cache
        try:
            keys = redis_client.keys(f"{SandboxMessagesCleanService.PLAN_CACHE_KEY_PREFIX}*")
            if keys:
                redis_client.delete(*keys)
        except Exception:
            pass  # Redis might not be available in some test environments
        yield
        # Clean up after test
        try:
            keys = redis_client.keys(f"{SandboxMessagesCleanService.PLAN_CACHE_KEY_PREFIX}*")
            if keys:
                redis_client.delete(*keys)
        except Exception:
            pass

    @pytest.fixture(autouse=True)
    def mock_whitelist(self):
        """Mock whitelist to return empty list by default."""
        with patch(
            "services.sandbox_messages_clean_service.BillingService.get_expired_subscription_cleanup_whitelist"
        ) as mock:
            mock.return_value = []
            yield mock

    @pytest.fixture(autouse=True)
    def mock_billing_enabled(self):
        """Mock BILLING_ENABLED to be True for all tests."""
        with patch("services.sandbox_messages_clean_service.dify_config.BILLING_ENABLED", True):
            yield

    def _create_account_and_tenant(self, plan="sandbox"):
        """Helper to create account and tenant."""
        fake = Faker()

        account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status="active",
        )
        db.session.add(account)
        db.session.flush()

        tenant = Tenant(
            name=fake.company(),
            plan=plan,
            status="normal",
        )
        db.session.add(tenant)
        db.session.flush()

        tenant_account_join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
        )
        db.session.add(tenant_account_join)
        db.session.commit()

        return account, tenant

    def _create_app(self, tenant, account):
        """Helper to create an app."""
        fake = Faker()

        app = App(
            tenant_id=tenant.id,
            name=fake.company(),
            description="Test app",
            mode="chat",
            enable_site=True,
            enable_api=True,
            api_rpm=60,
            api_rph=3600,
            is_demo=False,
            is_public=False,
            created_by=account.id,
            updated_by=account.id,
        )
        db.session.add(app)
        db.session.commit()

        return app

    def _create_conversation(self, app):
        """Helper to create a conversation."""
        conversation = Conversation(
            app_id=app.id,
            app_model_config_id=str(uuid.uuid4()),
            model_provider="openai",
            model_id="gpt-3.5-turbo",
            mode="chat",
            name="Test conversation",
            inputs={},
            status="normal",
            from_source="api",
            from_end_user_id=str(uuid.uuid4()),
        )
        db.session.add(conversation)
        db.session.commit()

        return conversation

    def _create_message(self, app, conversation, created_at=None, with_relations=True):
        """Helper to create a message with optional related records."""
        if created_at is None:
            created_at = datetime.datetime.now()

        message = Message(
            app_id=app.id,
            conversation_id=conversation.id,
            model_provider="openai",
            model_id="gpt-3.5-turbo",
            inputs={},
            query="Test query",
            answer="Test answer",
            message=[{"role": "user", "text": "Test message"}],
            message_tokens=10,
            message_unit_price=Decimal("0.001"),
            answer_tokens=20,
            answer_unit_price=Decimal("0.002"),
            total_price=Decimal("0.003"),
            currency="USD",
            from_source="api",
            from_account_id=conversation.from_end_user_id,
            created_at=created_at,
        )
        db.session.add(message)
        db.session.flush()

        if with_relations:
            self._create_message_relations(message)

        db.session.commit()
        return message

    def _create_message_relations(self, message):
        """Helper to create all message-related records."""
        # MessageFeedback
        feedback = MessageFeedback(
            app_id=message.app_id,
            conversation_id=message.conversation_id,
            message_id=message.id,
            rating="like",
            from_source="api",
            from_end_user_id=str(uuid.uuid4()),
        )
        db.session.add(feedback)

        # MessageAnnotation
        annotation = MessageAnnotation(
            app_id=message.app_id,
            conversation_id=message.conversation_id,
            message_id=message.id,
            question="Test question",
            content="Test annotation",
            account_id=message.from_account_id,
        )
        db.session.add(annotation)

        # MessageChain
        chain = MessageChain(
            message_id=message.id,
            type="system",
            input=json.dumps({"test": "input"}),
            output=json.dumps({"test": "output"}),
        )
        db.session.add(chain)
        db.session.flush()

        # MessageFile
        file = MessageFile(
            message_id=message.id,
            type="image",
            transfer_method="local_file",
            url="http://example.com/test.jpg",
            belongs_to="user",
            created_by_role="end_user",
            created_by=str(uuid.uuid4()),
        )
        db.session.add(file)

        # SavedMessage
        saved = SavedMessage(
            app_id=message.app_id,
            message_id=message.id,
            created_by_role="end_user",
            created_by=str(uuid.uuid4()),
        )
        db.session.add(saved)

        db.session.flush()

        # AppAnnotationHitHistory
        hit = AppAnnotationHitHistory(
            app_id=message.app_id,
            annotation_id=annotation.id,
            message_id=message.id,
            source="annotation",
            question="Test question",
            account_id=message.from_account_id,
            annotation_question="Test annotation question",
            annotation_content="Test annotation content",
        )
        db.session.add(hit)

        # DatasetRetrieverResource
        resource = DatasetRetrieverResource(
            message_id=message.id,
            position=1,
            dataset_id=str(uuid.uuid4()),
            dataset_name="Test dataset",
            document_id=str(uuid.uuid4()),
            document_name="Test document",
            data_source_type="upload_file",
            segment_id=str(uuid.uuid4()),
            score=0.9,
            content="Test content",
            hit_count=1,
            word_count=10,
            segment_position=1,
            index_node_hash="test_hash",
            retriever_from="dataset",
            created_by=message.from_account_id,
        )
        db.session.add(resource)

    def test_clean_no_messages_to_delete(self, db_session_with_containers):
        """Test cleaning when there are no messages to delete."""
        # Arrange
        end_before = datetime.datetime.now() - datetime.timedelta(days=30)

        with patch("services.sandbox_messages_clean_service.BillingService.get_plan_bulk") as mock_billing:
            mock_billing.return_value = {}

            # Act
            stats = SandboxMessagesCleanService._clean_sandbox_messages_by_time_range(
                end_before=end_before,
                graceful_period=21,  # Use default graceful period
                batch_size=100,
            )

        # Assert
        # Even with no messages, the loop runs once to check
        assert stats["batches"] == 1
        assert stats["total_messages"] == 0
        assert stats["total_deleted"] == 0

    def test_clean_mixed_sandbox_and_paid_tenants(self, db_session_with_containers):
        """Test cleaning with mixed sandbox and paid tenants, correctly filtering sandbox messages."""
        # Arrange - Create sandbox tenants with expired messages
        sandbox_tenants = []
        sandbox_message_ids = []
        for i in range(2):
            account, tenant = self._create_account_and_tenant(plan="sandbox")
            sandbox_tenants.append(tenant)
            app = self._create_app(tenant, account)
            conv = self._create_conversation(app)

            # Create 3 expired messages per sandbox tenant
            expired_date = datetime.datetime.now() - datetime.timedelta(days=35)
            for j in range(3):
                msg = self._create_message(app, conv, created_at=expired_date - datetime.timedelta(hours=j))
                sandbox_message_ids.append(msg.id)

        # Create paid tenants with expired messages (should NOT be deleted)
        paid_tenants = []
        paid_message_ids = []
        for i in range(2):
            account, tenant = self._create_account_and_tenant(plan="professional")
            paid_tenants.append(tenant)
            app = self._create_app(tenant, account)
            conv = self._create_conversation(app)

            # Create 2 expired messages per paid tenant
            expired_date = datetime.datetime.now() - datetime.timedelta(days=35)
            for j in range(2):
                msg = self._create_message(app, conv, created_at=expired_date - datetime.timedelta(hours=j))
                paid_message_ids.append(msg.id)

        # Mock billing service - return plan and expiration_date
        now_timestamp = int(datetime.datetime.now(datetime.UTC).timestamp())
        expired_15_days_ago = now_timestamp - (15 * 24 * 60 * 60)  # Beyond 7-day grace period

        plan_map = {}
        for tenant in sandbox_tenants:
            plan_map[tenant.id] = {
                "plan": CloudPlan.SANDBOX,
                "expiration_date": expired_15_days_ago,
            }
        for tenant in paid_tenants:
            plan_map[tenant.id] = {
                "plan": CloudPlan.PROFESSIONAL,
                "expiration_date": now_timestamp + (365 * 24 * 60 * 60),  # Active for 1 year
            }

        with patch("services.sandbox_messages_clean_service.BillingService.get_plan_bulk") as mock_billing:
            mock_billing.return_value = plan_map

            # Act
            end_before = datetime.datetime.now() - datetime.timedelta(days=30)
            stats = SandboxMessagesCleanService._clean_sandbox_messages_by_time_range(
                end_before=end_before,
                graceful_period=7,
                batch_size=100,
            )

        # Assert
        assert stats["total_messages"] == 6  # 2 sandbox tenants * 3 messages
        assert stats["total_deleted"] == 6

        # Only sandbox messages should be deleted
        assert db.session.query(Message).where(Message.id.in_(sandbox_message_ids)).count() == 0
        # Paid messages should remain
        assert db.session.query(Message).where(Message.id.in_(paid_message_ids)).count() == 4

        # Related records of sandbox messages should be deleted
        assert db.session.query(MessageFeedback).where(MessageFeedback.message_id.in_(sandbox_message_ids)).count() == 0
        assert (
            db.session.query(MessageAnnotation).where(MessageAnnotation.message_id.in_(sandbox_message_ids)).count()
            == 0
        )

    def test_clean_with_cursor_pagination(self, db_session_with_containers):
        """Test cursor pagination works correctly across multiple batches."""
        # Arrange - Create sandbox tenant with messages that will span multiple batches
        account, tenant = self._create_account_and_tenant(plan="sandbox")
        app = self._create_app(tenant, account)
        conv = self._create_conversation(app)

        # Create 10 expired messages with different timestamps
        base_date = datetime.datetime.now() - datetime.timedelta(days=35)
        message_ids = []
        for i in range(10):
            msg = self._create_message(
                app,
                conv,
                created_at=base_date + datetime.timedelta(hours=i),
                with_relations=False,  # Skip relations for speed
            )
            message_ids.append(msg.id)

        with patch("services.sandbox_messages_clean_service.BillingService.get_plan_bulk") as mock_billing:
            mock_billing.return_value = {
                tenant.id: {
                    "plan": CloudPlan.SANDBOX,
                    "expiration_date": -1,  # No previous subscription
                }
            }

            # Act - Use small batch size to trigger multiple batches
            end_before = datetime.datetime.now() - datetime.timedelta(days=30)
            stats = SandboxMessagesCleanService._clean_sandbox_messages_by_time_range(
                end_before=end_before,
                graceful_period=21,  # Use default graceful period
                batch_size=3,  # Small batch size to test pagination
            )

        # 5 batches for 10 messages with batch_size=3, the last batch is empty
        assert stats["batches"] == 5
        assert stats["total_messages"] == 10
        assert stats["total_deleted"] == 10

        # All messages should be deleted
        assert db.session.query(Message).where(Message.id.in_(message_ids)).count() == 0

    def test_clean_with_dry_run(self, db_session_with_containers):
        """Test dry_run mode does not delete messages."""
        # Arrange
        account, tenant = self._create_account_and_tenant(plan="sandbox")
        app = self._create_app(tenant, account)
        conv = self._create_conversation(app)

        # Create expired messages
        expired_date = datetime.datetime.now() - datetime.timedelta(days=35)
        message_ids = []
        for i in range(3):
            msg = self._create_message(app, conv, created_at=expired_date - datetime.timedelta(hours=i))
            message_ids.append(msg.id)

        with patch("services.sandbox_messages_clean_service.BillingService.get_plan_bulk") as mock_billing:
            mock_billing.return_value = {
                tenant.id: {
                    "plan": CloudPlan.SANDBOX,
                    "expiration_date": -1,  # No previous subscription
                }
            }

            # Act
            end_before = datetime.datetime.now() - datetime.timedelta(days=30)
            stats = SandboxMessagesCleanService._clean_sandbox_messages_by_time_range(
                end_before=end_before,
                graceful_period=21,  # Use default graceful period
                batch_size=100,
                dry_run=True,  # Dry run mode
            )

        # Assert
        assert stats["total_messages"] == 3  # Messages identified
        assert stats["total_deleted"] == 0  # But NOT deleted

        # All messages should still exist
        assert db.session.query(Message).where(Message.id.in_(message_ids)).count() == 3
        # Related records should also still exist
        assert db.session.query(MessageFeedback).where(MessageFeedback.message_id.in_(message_ids)).count() == 3

    def test_clean_with_billing_partial_exception_some_known_plans(self, db_session_with_containers):
        """Test when billing service fails but returns partial data, only delete known sandbox messages."""
        # Arrange - Create 3 tenants
        tenants_data = []
        for i in range(3):
            account, tenant = self._create_account_and_tenant(plan="sandbox")
            app = self._create_app(tenant, account)
            conv = self._create_conversation(app)

            expired_date = datetime.datetime.now() - datetime.timedelta(days=35)
            msg = self._create_message(app, conv, created_at=expired_date)

            tenants_data.append(
                {
                    "tenant": tenant,
                    "message_id": msg.id,
                }
            )

        # Mock billing service to return partial data with new structure
        now_timestamp = int(datetime.datetime.now(datetime.UTC).timestamp())

        # Only tenant[0] is confirmed as sandbox, tenant[1] is professional, tenant[2] is missing
        partial_plan_map = {
            tenants_data[0]["tenant"].id: {
                "plan": CloudPlan.SANDBOX,
                "expiration_date": -1,  # No previous subscription
            },
            tenants_data[1]["tenant"].id: {
                "plan": CloudPlan.PROFESSIONAL,
                "expiration_date": now_timestamp + (365 * 24 * 60 * 60),  # Active for 1 year
            },
            # tenants_data[2] is missing from response
        }

        with patch("services.sandbox_messages_clean_service.BillingService.get_plan_bulk") as mock_billing:
            mock_billing.return_value = partial_plan_map

            # Act
            end_before = datetime.datetime.now() - datetime.timedelta(days=30)
            stats = SandboxMessagesCleanService._clean_sandbox_messages_by_time_range(
                end_before=end_before,
                graceful_period=21,  # Use default graceful period
                batch_size=100,
            )

        # Assert - Only tenant[0]'s message should be deleted
        assert stats["total_messages"] == 1
        assert stats["total_deleted"] == 1

        # Check which messages were deleted
        assert (
            db.session.query(Message).where(Message.id == tenants_data[0]["message_id"]).count() == 0
        )  # Sandbox tenant's message deleted

        assert (
            db.session.query(Message).where(Message.id == tenants_data[1]["message_id"]).count() == 1
        )  # Professional tenant's message preserved

        assert (
            db.session.query(Message).where(Message.id == tenants_data[2]["message_id"]).count() == 1
        )  # Unknown tenant's message preserved (safe default)

    def test_clean_with_billing_exception_no_data(self, db_session_with_containers):
        """Test when billing service returns empty data, skip deletion for that batch."""
        # Arrange
        account, tenant = self._create_account_and_tenant(plan="sandbox")
        app = self._create_app(tenant, account)
        conv = self._create_conversation(app)

        expired_date = datetime.datetime.now() - datetime.timedelta(days=35)
        msg_id = None
        msg = self._create_message(app, conv, created_at=expired_date)
        msg_id = msg.id  # Store ID before any operations
        db.session.commit()

        # Mock billing service to return empty data (simulating failure/no data scenario)
        with patch("services.sandbox_messages_clean_service.BillingService.get_plan_bulk") as mock_billing:
            mock_billing.return_value = {}  # Empty response, tenant plan unknown

            # Act - Should not raise exception, just skip deletion
            end_before = datetime.datetime.now() - datetime.timedelta(days=30)
            stats = SandboxMessagesCleanService._clean_sandbox_messages_by_time_range(
                end_before=end_before,
                graceful_period=21,  # Use default graceful period
                batch_size=100,
            )

        # Assert - No messages should be deleted when plan is unknown
        assert stats["total_messages"] == 0  # Cannot determine sandbox messages
        assert stats["total_deleted"] == 0

        # Message should still exist (safe default - don't delete if plan is unknown)
        assert db.session.query(Message).where(Message.id == msg_id).count() == 1

    def test_redis_cache_for_tenant_plans(self, db_session_with_containers):
        """Test that tenant plans are cached in Redis and reused."""
        # Arrange
        account, tenant = self._create_account_and_tenant(plan="sandbox")
        app = self._create_app(tenant, account)
        conv = self._create_conversation(app)

        # Create messages in two batches (to test cache reuse)
        expired_date = datetime.datetime.now() - datetime.timedelta(days=35)
        batch1_msgs = []
        for i in range(2):
            msg = self._create_message(
                app, conv, created_at=expired_date + datetime.timedelta(hours=i), with_relations=False
            )
            batch1_msgs.append(msg.id)

        batch2_msgs = []
        for i in range(2):
            msg = self._create_message(
                app, conv, created_at=expired_date + datetime.timedelta(hours=10 + i), with_relations=False
            )
            batch2_msgs.append(msg.id)

        # Mock billing service with new structure
        mock_get_plan_bulk = MagicMock(
            return_value={
                tenant.id: {
                    "plan": CloudPlan.SANDBOX,
                    "expiration_date": -1,  # No previous subscription
                }
            }
        )

        with patch("services.sandbox_messages_clean_service.BillingService.get_plan_bulk", mock_get_plan_bulk):
            # Act - First call
            end_before = datetime.datetime.now() - datetime.timedelta(days=30)
            stats1 = SandboxMessagesCleanService._clean_sandbox_messages_by_time_range(
                end_before=end_before,
                graceful_period=21,  # Use default graceful period
                batch_size=2,  # Process 2 messages per batch
            )

            # Check billing service was called (cache miss)
            assert mock_get_plan_bulk.call_count == 1
            first_call_count = mock_get_plan_bulk.call_count

            # Verify Redis cache was populated
            cache_key = f"{SandboxMessagesCleanService.PLAN_CACHE_KEY_PREFIX}{tenant.id}"
            cached_plan = redis_client.get(cache_key)
            assert cached_plan is not None
            cached_plan_data = json.loads(cached_plan.decode("utf-8"))
            assert cached_plan_data["plan"] == CloudPlan.SANDBOX
            assert cached_plan_data["expiration_date"] == -1

            # Act - Second call with same tenant (should use cache)
            # Create more messages for the same tenant
            batch3_msgs = []
            for i in range(2):
                msg = self._create_message(
                    app, conv, created_at=expired_date + datetime.timedelta(hours=20 + i), with_relations=False
                )
                batch3_msgs.append(msg.id)

            stats2 = SandboxMessagesCleanService._clean_sandbox_messages_by_time_range(
                end_before=end_before,
                graceful_period=21,  # Use default graceful period
                batch_size=2,
            )

            # Assert - Billing service should not be called again (cache hit)
            # The call count should be the same
            assert mock_get_plan_bulk.call_count == first_call_count  # Same tenant, should use cache

        # Verify all messages were deleted
        total_expected = len(batch1_msgs) + len(batch2_msgs) + len(batch3_msgs)
        assert stats1["total_deleted"] + stats2["total_deleted"] == total_expected

    def test_time_range_filtering(self, db_session_with_containers):
        """Test that messages are correctly filtered by [start_from, end_before) time range."""
        # Arrange
        account, tenant = self._create_account_and_tenant(plan="sandbox")
        app = self._create_app(tenant, account)
        conv = self._create_conversation(app)

        base_date = datetime.datetime(2024, 1, 15, 12, 0, 0)

        # Create messages: before range, in range, after range
        msg_before = self._create_message(
            app,
            conv,
            created_at=datetime.datetime(2024, 1, 1, 12, 0, 0),  # Before start_from
            with_relations=False,
        )
        msg_before_id = msg_before.id

        msg_at_start = self._create_message(
            app,
            conv,
            created_at=datetime.datetime(2024, 1, 10, 12, 0, 0),  # At start_from (inclusive)
            with_relations=False,
        )
        msg_at_start_id = msg_at_start.id

        msg_in_range = self._create_message(
            app,
            conv,
            created_at=datetime.datetime(2024, 1, 15, 12, 0, 0),  # In range
            with_relations=False,
        )
        msg_in_range_id = msg_in_range.id

        msg_at_end = self._create_message(
            app,
            conv,
            created_at=datetime.datetime(2024, 1, 20, 12, 0, 0),  # At end_before (exclusive)
            with_relations=False,
        )
        msg_at_end_id = msg_at_end.id

        msg_after = self._create_message(
            app,
            conv,
            created_at=datetime.datetime(2024, 1, 25, 12, 0, 0),  # After end_before
            with_relations=False,
        )
        msg_after_id = msg_after.id

        db.session.commit()  # Commit all messages

        # Mock billing service with new structure
        with patch("services.sandbox_messages_clean_service.BillingService.get_plan_bulk") as mock_billing:
            mock_billing.return_value = {
                tenant.id: {
                    "plan": CloudPlan.SANDBOX,
                    "expiration_date": -1,  # No previous subscription
                }
            }

            # Act - Clean with specific time range [2024-01-10, 2024-01-20)
            stats = SandboxMessagesCleanService._clean_sandbox_messages_by_time_range(
                start_from=datetime.datetime(2024, 1, 10, 12, 0, 0),
                end_before=datetime.datetime(2024, 1, 20, 12, 0, 0),
                graceful_period=21,  # Use default graceful period
                batch_size=100,
            )

        # Assert - Only messages in [start_from, end_before) should be deleted
        assert stats["total_messages"] == 2  # msg_at_start and msg_in_range
        assert stats["total_deleted"] == 2

        # Verify specific messages using stored IDs
        # Before range, kept
        assert db.session.query(Message).where(Message.id == msg_before_id).count() == 1
        # At start (inclusive), deleted
        assert db.session.query(Message).where(Message.id == msg_at_start_id).count() == 0
        # In range, deleted
        assert db.session.query(Message).where(Message.id == msg_in_range_id).count() == 0
        # At end (exclusive), kept
        assert db.session.query(Message).where(Message.id == msg_at_end_id).count() == 1
        # After range, kept
        assert db.session.query(Message).where(Message.id == msg_after_id).count() == 1

    def test_clean_with_graceful_period_scenarios(self, db_session_with_containers):
        """Test cleaning with different graceful period scenarios."""
        # Arrange - Create 5 different tenants with different plan and expiration scenarios
        now_timestamp = int(datetime.datetime.now(datetime.UTC).timestamp())
        graceful_period = 8  # Use 8 days for this test to validate boundary conditions

        # Scenario 1: Sandbox plan with expiration within graceful period (5 days ago)
        # Should NOT be deleted
        account1, tenant1 = self._create_account_and_tenant(plan="sandbox")
        app1 = self._create_app(tenant1, account1)
        conv1 = self._create_conversation(app1)
        expired_date = datetime.datetime.now() - datetime.timedelta(days=35)
        msg1 = self._create_message(app1, conv1, created_at=expired_date, with_relations=False)
        msg1_id = msg1.id  # Save ID before potential deletion
        expired_5_days_ago = now_timestamp - (5 * 24 * 60 * 60)  # Within grace period

        # Scenario 2: Sandbox plan with expiration beyond graceful period (10 days ago)
        # Should be deleted
        account2, tenant2 = self._create_account_and_tenant(plan="sandbox")
        app2 = self._create_app(tenant2, account2)
        conv2 = self._create_conversation(app2)
        msg2 = self._create_message(app2, conv2, created_at=expired_date, with_relations=False)
        msg2_id = msg2.id  # Save ID before potential deletion
        expired_10_days_ago = now_timestamp - (10 * 24 * 60 * 60)  # Beyond grace period

        # Scenario 3: Sandbox plan with expiration_date = -1 (no previous subscription)
        # Should be deleted
        account3, tenant3 = self._create_account_and_tenant(plan="sandbox")
        app3 = self._create_app(tenant3, account3)
        conv3 = self._create_conversation(app3)
        msg3 = self._create_message(app3, conv3, created_at=expired_date, with_relations=False)
        msg3_id = msg3.id  # Save ID before potential deletion

        # Scenario 4: Non-sandbox plan (professional) with no expiration (future date)
        # Should NOT be deleted
        account4, tenant4 = self._create_account_and_tenant(plan="professional")
        app4 = self._create_app(tenant4, account4)
        conv4 = self._create_conversation(app4)
        msg4 = self._create_message(app4, conv4, created_at=expired_date, with_relations=False)
        msg4_id = msg4.id  # Save ID before potential deletion
        future_expiration = now_timestamp + (365 * 24 * 60 * 60)  # Active for 1 year

        # Scenario 5: Sandbox plan with expiration exactly at grace period boundary (8 days ago)
        # Should NOT be deleted (boundary is exclusive: > graceful_period)
        account5, tenant5 = self._create_account_and_tenant(plan="sandbox")
        app5 = self._create_app(tenant5, account5)
        conv5 = self._create_conversation(app5)
        msg5 = self._create_message(app5, conv5, created_at=expired_date, with_relations=False)
        msg5_id = msg5.id  # Save ID before potential deletion
        expired_exactly_8_days_ago = now_timestamp - (8 * 24 * 60 * 60)  # Exactly at boundary

        db.session.commit()

        # Mock billing service with all scenarios
        plan_map = {
            tenant1.id: {
                "plan": CloudPlan.SANDBOX,
                "expiration_date": expired_5_days_ago,
            },
            tenant2.id: {
                "plan": CloudPlan.SANDBOX,
                "expiration_date": expired_10_days_ago,
            },
            tenant3.id: {
                "plan": CloudPlan.SANDBOX,
                "expiration_date": -1,
            },
            tenant4.id: {
                "plan": CloudPlan.PROFESSIONAL,
                "expiration_date": future_expiration,
            },
            tenant5.id: {
                "plan": CloudPlan.SANDBOX,
                "expiration_date": expired_exactly_8_days_ago,
            },
        }

        with patch("services.sandbox_messages_clean_service.BillingService.get_plan_bulk") as mock_billing:
            mock_billing.return_value = plan_map

            # Act
            end_before = datetime.datetime.now() - datetime.timedelta(days=30)

            # Mock datetime.now() to use the same timestamp as test setup
            # This ensures deterministic behavior for boundary conditions (scenario 5)
            with patch("services.sandbox_messages_clean_service.datetime") as mock_datetime:
                mock_datetime.datetime.now.return_value = datetime.datetime.fromtimestamp(
                    now_timestamp, tz=datetime.UTC
                )
                mock_datetime.timedelta = datetime.timedelta  # Keep original timedelta

                stats = SandboxMessagesCleanService._clean_sandbox_messages_by_time_range(
                    end_before=end_before,
                    graceful_period=graceful_period,
                    batch_size=100,
                )

        # Assert - Only messages from scenario 2 and 3 should be deleted
        assert stats["total_messages"] == 2
        assert stats["total_deleted"] == 2

        # Verify each scenario using saved IDs
        assert db.session.query(Message).where(Message.id == msg1_id).count() == 1  # Within grace, kept
        assert db.session.query(Message).where(Message.id == msg2_id).count() == 0  # Beyond grace, deleted
        assert db.session.query(Message).where(Message.id == msg3_id).count() == 0  # No subscription, deleted
        assert db.session.query(Message).where(Message.id == msg4_id).count() == 1  # Professional plan, kept
        assert db.session.query(Message).where(Message.id == msg5_id).count() == 1  # At boundary, kept

    def test_clean_with_tenant_whitelist(self, db_session_with_containers, mock_whitelist):
        """Test that whitelisted tenants' messages are not deleted even if they are sandbox and expired."""
        # Arrange - Create 3 sandbox tenants with expired messages
        tenants_data = []
        for i in range(3):
            account, tenant = self._create_account_and_tenant(plan="sandbox")
            app = self._create_app(tenant, account)
            conv = self._create_conversation(app)

            expired_date = datetime.datetime.now() - datetime.timedelta(days=35)
            msg = self._create_message(app, conv, created_at=expired_date, with_relations=False)

            tenants_data.append(
                {
                    "tenant": tenant,
                    "message_id": msg.id,
                }
            )

        # Mock billing service - all tenants are sandbox with no subscription
        plan_map = {
            tenants_data[0]["tenant"].id: {
                "plan": CloudPlan.SANDBOX,
                "expiration_date": -1,  # No previous subscription
            },
            tenants_data[1]["tenant"].id: {
                "plan": CloudPlan.SANDBOX,
                "expiration_date": -1,  # No previous subscription
            },
            tenants_data[2]["tenant"].id: {
                "plan": CloudPlan.SANDBOX,
                "expiration_date": -1,  # No previous subscription
            },
        }

        # Setup whitelist - tenant0 and tenant1 are whitelisted, tenant2 is not
        whitelist = [tenants_data[0]["tenant"].id, tenants_data[1]["tenant"].id]
        mock_whitelist.return_value = whitelist

        with patch("services.sandbox_messages_clean_service.BillingService.get_plan_bulk") as mock_billing:
            mock_billing.return_value = plan_map

            # Act
            end_before = datetime.datetime.now() - datetime.timedelta(days=30)
            stats = SandboxMessagesCleanService._clean_sandbox_messages_by_time_range(
                end_before=end_before,
                graceful_period=21,  # Use default graceful period
                batch_size=100,
            )

        # Assert - Only tenant2's message should be deleted (not whitelisted)
        assert stats["total_messages"] == 1
        assert stats["total_deleted"] == 1

        # Verify tenant0's message still exists (whitelisted)
        assert db.session.query(Message).where(Message.id == tenants_data[0]["message_id"]).count() == 1

        # Verify tenant1's message still exists (whitelisted)
        assert db.session.query(Message).where(Message.id == tenants_data[1]["message_id"]).count() == 1

        # Verify tenant2's message was deleted (not whitelisted)
        assert db.session.query(Message).where(Message.id == tenants_data[2]["message_id"]).count() == 0

    def test_clean_with_whitelist_and_grace_period(self, db_session_with_containers, mock_whitelist):
        """Test that whitelist takes precedence over grace period logic."""
        # Arrange - Create 2 sandbox tenants
        now_timestamp = int(datetime.datetime.now(datetime.UTC).timestamp())

        # Tenant1: whitelisted, expired beyond grace period
        account1, tenant1 = self._create_account_and_tenant(plan="sandbox")
        app1 = self._create_app(tenant1, account1)
        conv1 = self._create_conversation(app1)
        expired_date = datetime.datetime.now() - datetime.timedelta(days=35)
        msg1 = self._create_message(app1, conv1, created_at=expired_date, with_relations=False)
        expired_30_days_ago = now_timestamp - (30 * 24 * 60 * 60)  # Well beyond 21-day grace

        # Tenant2: not whitelisted, within grace period
        account2, tenant2 = self._create_account_and_tenant(plan="sandbox")
        app2 = self._create_app(tenant2, account2)
        conv2 = self._create_conversation(app2)
        msg2 = self._create_message(app2, conv2, created_at=expired_date, with_relations=False)
        expired_10_days_ago = now_timestamp - (10 * 24 * 60 * 60)  # Within 21-day grace

        # Mock billing service
        plan_map = {
            tenant1.id: {
                "plan": CloudPlan.SANDBOX,
                "expiration_date": expired_30_days_ago,  # Beyond grace period
            },
            tenant2.id: {
                "plan": CloudPlan.SANDBOX,
                "expiration_date": expired_10_days_ago,  # Within grace period
            },
        }

        # Setup whitelist - only tenant1 is whitelisted
        whitelist = [tenant1.id]
        mock_whitelist.return_value = whitelist

        with patch("services.sandbox_messages_clean_service.BillingService.get_plan_bulk") as mock_billing:
            mock_billing.return_value = plan_map

            # Act
            end_before = datetime.datetime.now() - datetime.timedelta(days=30)
            stats = SandboxMessagesCleanService._clean_sandbox_messages_by_time_range(
                end_before=end_before,
                graceful_period=21,  # Use default graceful period
                batch_size=100,
            )

        # Assert - No messages should be deleted
        # tenant1: whitelisted (would be deleted based on grace period, but protected by whitelist)
        # tenant2: within grace period (not eligible for deletion)
        assert stats["total_messages"] == 0
        assert stats["total_deleted"] == 0

        # Verify both messages still exist
        assert db.session.query(Message).where(Message.id == msg1.id).count() == 1  # Whitelisted
        assert db.session.query(Message).where(Message.id == msg2.id).count() == 1  # Within grace period

    def test_clean_with_empty_whitelist(self, db_session_with_containers, mock_whitelist):
        """Test that empty whitelist behaves as no whitelist (all eligible messages are deleted)."""
        # Arrange - Create sandbox tenant with expired messages
        account, tenant = self._create_account_and_tenant(plan="sandbox")
        app = self._create_app(tenant, account)
        conv = self._create_conversation(app)

        expired_date = datetime.datetime.now() - datetime.timedelta(days=35)
        msg_ids = []
        for i in range(3):
            msg = self._create_message(app, conv, created_at=expired_date - datetime.timedelta(hours=i))
            msg_ids.append(msg.id)

        # Mock billing service
        plan_map = {
            tenant.id: {
                "plan": CloudPlan.SANDBOX,
                "expiration_date": -1,  # No previous subscription
            }
        }

        # Setup empty whitelist (default behavior from fixture)
        mock_whitelist.return_value = []

        with patch("services.sandbox_messages_clean_service.BillingService.get_plan_bulk") as mock_billing:
            mock_billing.return_value = plan_map

            # Act
            end_before = datetime.datetime.now() - datetime.timedelta(days=30)
            stats = SandboxMessagesCleanService._clean_sandbox_messages_by_time_range(
                end_before=end_before,
                graceful_period=21,  # Use default graceful period
                batch_size=100,
            )

        # Assert - All messages should be deleted (no whitelist protection)
        assert stats["total_messages"] == 3
        assert stats["total_deleted"] == 3

        # Verify all messages were deleted
        assert db.session.query(Message).where(Message.id.in_(msg_ids)).count() == 0
