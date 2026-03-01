import datetime
import json
import uuid
from decimal import Decimal
from unittest.mock import patch

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
from services.billing_service import BillingService
from services.retention.conversation.messages_clean_policy import (
    BillingDisabledPolicy,
    BillingSandboxPolicy,
    create_message_clean_policy,
)
from services.retention.conversation.messages_clean_service import MessagesCleanService


class TestMessagesCleanServiceIntegration:
    """Integration tests for MessagesCleanService.run() and _clean_messages_by_time_range()."""

    # Redis cache key prefix from BillingService
    PLAN_CACHE_KEY_PREFIX = BillingService._PLAN_CACHE_KEY_PREFIX  # "tenant_plan:"

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
        # Clear tenant plan cache using BillingService key prefix
        try:
            keys = redis_client.keys(f"{self.PLAN_CACHE_KEY_PREFIX}*")
            if keys:
                redis_client.delete(*keys)
        except Exception:
            pass  # Redis might not be available in some test environments
        yield
        # Clean up after test
        try:
            keys = redis_client.keys(f"{self.PLAN_CACHE_KEY_PREFIX}*")
            if keys:
                redis_client.delete(*keys)
        except Exception:
            pass

    @pytest.fixture
    def mock_whitelist(self):
        """Mock whitelist to return empty list by default."""
        with patch(
            "services.retention.conversation.messages_clean_policy.BillingService.get_expired_subscription_cleanup_whitelist"
        ) as mock:
            mock.return_value = []
            yield mock

    @pytest.fixture
    def mock_billing_enabled(self):
        """Mock BILLING_ENABLED to be True."""
        with patch("services.retention.conversation.messages_clean_policy.dify_config.BILLING_ENABLED", True):
            yield

    @pytest.fixture
    def mock_billing_disabled(self):
        """Mock BILLING_ENABLED to be False."""
        with patch("services.retention.conversation.messages_clean_policy.dify_config.BILLING_ENABLED", False):
            yield

    def _create_account_and_tenant(self, plan: str = CloudPlan.SANDBOX):
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
            plan=str(plan),
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
            score=0.9,
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

    def test_billing_disabled_deletes_all_messages_in_time_range(
        self, db_session_with_containers, mock_billing_disabled
    ):
        """Test that BillingDisabledPolicy deletes all messages within time range regardless of tenant plan."""
        # Arrange - Create tenant with messages (plan doesn't matter for billing disabled)
        account, tenant = self._create_account_and_tenant(plan=CloudPlan.SANDBOX)
        app = self._create_app(tenant, account)
        conv = self._create_conversation(app)

        # Create messages: in-range (should be deleted) and out-of-range (should be kept)
        in_range_date = datetime.datetime(2024, 1, 15, 12, 0, 0)
        out_of_range_date = datetime.datetime(2024, 1, 25, 12, 0, 0)

        in_range_msg = self._create_message(app, conv, created_at=in_range_date, with_relations=True)
        in_range_msg_id = in_range_msg.id

        out_of_range_msg = self._create_message(app, conv, created_at=out_of_range_date, with_relations=True)
        out_of_range_msg_id = out_of_range_msg.id

        # Act - create_message_clean_policy should return BillingDisabledPolicy
        policy = create_message_clean_policy()

        assert isinstance(policy, BillingDisabledPolicy)

        service = MessagesCleanService.from_time_range(
            policy=policy,
            start_from=datetime.datetime(2024, 1, 10, 0, 0, 0),
            end_before=datetime.datetime(2024, 1, 20, 0, 0, 0),
            batch_size=100,
        )
        stats = service.run()

        # Assert
        assert stats["total_messages"] == 1  # Only in-range message fetched
        assert stats["filtered_messages"] == 1
        assert stats["total_deleted"] == 1

        # In-range message deleted
        assert db.session.query(Message).where(Message.id == in_range_msg_id).count() == 0
        # Out-of-range message kept
        assert db.session.query(Message).where(Message.id == out_of_range_msg_id).count() == 1

        # Related records of in-range message deleted
        assert db.session.query(MessageFeedback).where(MessageFeedback.message_id == in_range_msg_id).count() == 0
        assert db.session.query(MessageAnnotation).where(MessageAnnotation.message_id == in_range_msg_id).count() == 0
        # Related records of out-of-range message kept
        assert db.session.query(MessageFeedback).where(MessageFeedback.message_id == out_of_range_msg_id).count() == 1

    def test_no_messages_returns_empty_stats(self, db_session_with_containers, mock_billing_enabled, mock_whitelist):
        """Test cleaning when there are no messages to delete (B1)."""
        # Arrange
        end_before = datetime.datetime.now() - datetime.timedelta(days=30)
        start_from = datetime.datetime.now() - datetime.timedelta(days=60)

        with patch("services.billing_service.BillingService.get_plan_bulk") as mock_billing:
            mock_billing.return_value = {}

            # Act
            policy = create_message_clean_policy(graceful_period_days=21)
            service = MessagesCleanService.from_time_range(
                policy=policy,
                start_from=start_from,
                end_before=end_before,
                batch_size=100,
            )
            stats = service.run()

        # Assert - loop runs once to check, finds nothing
        assert stats["batches"] == 1
        assert stats["total_messages"] == 0
        assert stats["filtered_messages"] == 0
        assert stats["total_deleted"] == 0

    def test_mixed_sandbox_and_paid_tenants(self, db_session_with_containers, mock_billing_enabled, mock_whitelist):
        """Test cleaning with mixed sandbox and paid tenants (B2)."""
        # Arrange - Create sandbox tenants with expired messages
        sandbox_tenants = []
        sandbox_message_ids = []
        for i in range(2):
            account, tenant = self._create_account_and_tenant(plan=CloudPlan.SANDBOX)
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
            account, tenant = self._create_account_and_tenant(plan=CloudPlan.PROFESSIONAL)
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

        with patch("services.billing_service.BillingService.get_plan_bulk") as mock_billing:
            mock_billing.return_value = plan_map

            # Act
            end_before = datetime.datetime.now() - datetime.timedelta(days=30)
            policy = create_message_clean_policy(graceful_period_days=7)

            assert isinstance(policy, BillingSandboxPolicy)

            service = MessagesCleanService.from_time_range(
                policy=policy,
                start_from=datetime.datetime.now() - datetime.timedelta(days=60),
                end_before=end_before,
                batch_size=100,
            )
            stats = service.run()

        # Assert
        assert stats["total_messages"] == 10  # 2 sandbox * 3 + 2 paid * 2
        assert stats["filtered_messages"] == 6  # 2 sandbox tenants * 3 messages
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

    def test_cursor_pagination_multiple_batches(self, db_session_with_containers, mock_billing_enabled, mock_whitelist):
        """Test cursor pagination works correctly across multiple batches (B3)."""
        # Arrange - Create sandbox tenant with messages that will span multiple batches
        account, tenant = self._create_account_and_tenant(plan=CloudPlan.SANDBOX)
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

        with patch("services.billing_service.BillingService.get_plan_bulk") as mock_billing:
            mock_billing.return_value = {
                tenant.id: {
                    "plan": CloudPlan.SANDBOX,
                    "expiration_date": -1,  # No previous subscription
                }
            }

            # Act - Use small batch size to trigger multiple batches
            end_before = datetime.datetime.now() - datetime.timedelta(days=30)
            policy = create_message_clean_policy(graceful_period_days=21)
            service = MessagesCleanService.from_time_range(
                policy=policy,
                start_from=datetime.datetime.now() - datetime.timedelta(days=60),
                end_before=end_before,
                batch_size=3,  # Small batch size to test pagination
            )
            stats = service.run()

        # 5 batches for 10 messages with batch_size=3, the last batch is empty
        assert stats["batches"] == 5
        assert stats["total_messages"] == 10
        assert stats["filtered_messages"] == 10
        assert stats["total_deleted"] == 10

        # All messages should be deleted
        assert db.session.query(Message).where(Message.id.in_(message_ids)).count() == 0

    def test_dry_run_does_not_delete(self, db_session_with_containers, mock_billing_enabled, mock_whitelist):
        """Test dry_run mode does not delete messages (B4)."""
        # Arrange
        account, tenant = self._create_account_and_tenant(plan=CloudPlan.SANDBOX)
        app = self._create_app(tenant, account)
        conv = self._create_conversation(app)

        # Create expired messages
        expired_date = datetime.datetime.now() - datetime.timedelta(days=35)
        message_ids = []
        for i in range(3):
            msg = self._create_message(app, conv, created_at=expired_date - datetime.timedelta(hours=i))
            message_ids.append(msg.id)

        with patch("services.billing_service.BillingService.get_plan_bulk") as mock_billing:
            mock_billing.return_value = {
                tenant.id: {
                    "plan": CloudPlan.SANDBOX,
                    "expiration_date": -1,  # No previous subscription
                }
            }

            # Act
            end_before = datetime.datetime.now() - datetime.timedelta(days=30)
            policy = create_message_clean_policy(graceful_period_days=21)
            service = MessagesCleanService.from_time_range(
                policy=policy,
                start_from=datetime.datetime.now() - datetime.timedelta(days=60),
                end_before=end_before,
                batch_size=100,
                dry_run=True,  # Dry run mode
            )
            stats = service.run()

        # Assert
        assert stats["total_messages"] == 3
        assert stats["filtered_messages"] == 3  # Messages identified
        assert stats["total_deleted"] == 0  # But NOT deleted

        # All messages should still exist
        assert db.session.query(Message).where(Message.id.in_(message_ids)).count() == 3
        # Related records should also still exist
        assert db.session.query(MessageFeedback).where(MessageFeedback.message_id.in_(message_ids)).count() == 3

    def test_partial_plan_data_safe_default(self, db_session_with_containers, mock_billing_enabled, mock_whitelist):
        """Test when billing returns partial data, unknown tenants are preserved (B5)."""
        # Arrange - Create 3 tenants
        tenants_data = []
        for i in range(3):
            account, tenant = self._create_account_and_tenant(plan=CloudPlan.SANDBOX)
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

        # Mock billing service to return partial data
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

        with patch("services.billing_service.BillingService.get_plan_bulk") as mock_billing:
            mock_billing.return_value = partial_plan_map

            # Act
            end_before = datetime.datetime.now() - datetime.timedelta(days=30)
            policy = create_message_clean_policy(graceful_period_days=21)
            service = MessagesCleanService.from_time_range(
                policy=policy,
                start_from=datetime.datetime.now() - datetime.timedelta(days=60),
                end_before=end_before,
                batch_size=100,
            )
            stats = service.run()

        # Assert - Only tenant[0]'s message should be deleted
        assert stats["total_messages"] == 3  # 3 tenants * 1 message
        assert stats["filtered_messages"] == 1
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

    def test_empty_plan_data_skips_deletion(self, db_session_with_containers, mock_billing_enabled, mock_whitelist):
        """Test when billing returns empty data, skip deletion entirely (B6)."""
        # Arrange
        account, tenant = self._create_account_and_tenant(plan=CloudPlan.SANDBOX)
        app = self._create_app(tenant, account)
        conv = self._create_conversation(app)

        expired_date = datetime.datetime.now() - datetime.timedelta(days=35)
        msg = self._create_message(app, conv, created_at=expired_date)
        msg_id = msg.id
        db.session.commit()

        # Mock billing service to return empty data (simulating failure/no data scenario)
        with patch("services.billing_service.BillingService.get_plan_bulk") as mock_billing:
            mock_billing.return_value = {}  # Empty response, tenant plan unknown

            # Act - Should not raise exception, just skip deletion
            end_before = datetime.datetime.now() - datetime.timedelta(days=30)
            policy = create_message_clean_policy(graceful_period_days=21)
            service = MessagesCleanService.from_time_range(
                policy=policy,
                start_from=datetime.datetime.now() - datetime.timedelta(days=60),
                end_before=end_before,
                batch_size=100,
            )
            stats = service.run()

        # Assert - No messages should be deleted when plan is unknown
        assert stats["total_messages"] == 1
        assert stats["filtered_messages"] == 0  # Cannot determine sandbox messages
        assert stats["total_deleted"] == 0

        # Message should still exist (safe default - don't delete if plan is unknown)
        assert db.session.query(Message).where(Message.id == msg_id).count() == 1

    def test_time_range_boundary_behavior(self, db_session_with_containers, mock_billing_enabled, mock_whitelist):
        """Test that messages are correctly filtered by [start_from, end_before) time range (B7)."""
        # Arrange
        account, tenant = self._create_account_and_tenant(plan=CloudPlan.SANDBOX)
        app = self._create_app(tenant, account)
        conv = self._create_conversation(app)

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

        db.session.commit()

        # Mock billing service
        with patch("services.billing_service.BillingService.get_plan_bulk") as mock_billing:
            mock_billing.return_value = {
                tenant.id: {
                    "plan": CloudPlan.SANDBOX,
                    "expiration_date": -1,  # No previous subscription
                }
            }

            # Act - Clean with specific time range [2024-01-10, 2024-01-20)
            policy = create_message_clean_policy(graceful_period_days=21)
            service = MessagesCleanService.from_time_range(
                policy=policy,
                start_from=datetime.datetime(2024, 1, 10, 12, 0, 0),
                end_before=datetime.datetime(2024, 1, 20, 12, 0, 0),
                batch_size=100,
            )
            stats = service.run()

        # Assert - Only messages in [start_from, end_before) should be deleted
        assert stats["total_messages"] == 2  # Only in-range messages fetched
        assert stats["filtered_messages"] == 2  # msg_at_start and msg_in_range
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

    def test_grace_period_scenarios(self, db_session_with_containers, mock_billing_enabled, mock_whitelist):
        """Test cleaning with different graceful period scenarios (B8)."""
        # Arrange - Create 5 different tenants with different plan and expiration scenarios
        now_timestamp = int(datetime.datetime.now(datetime.UTC).timestamp())
        graceful_period = 8  # Use 8 days for this test

        # Scenario 1: Sandbox plan with expiration within graceful period (5 days ago)
        # Should NOT be deleted
        account1, tenant1 = self._create_account_and_tenant(plan=CloudPlan.SANDBOX)
        app1 = self._create_app(tenant1, account1)
        conv1 = self._create_conversation(app1)
        expired_date = datetime.datetime.now() - datetime.timedelta(days=35)
        msg1 = self._create_message(app1, conv1, created_at=expired_date, with_relations=False)
        msg1_id = msg1.id
        expired_5_days_ago = now_timestamp - (5 * 24 * 60 * 60)  # Within grace period

        # Scenario 2: Sandbox plan with expiration beyond graceful period (10 days ago)
        # Should be deleted
        account2, tenant2 = self._create_account_and_tenant(plan=CloudPlan.SANDBOX)
        app2 = self._create_app(tenant2, account2)
        conv2 = self._create_conversation(app2)
        msg2 = self._create_message(app2, conv2, created_at=expired_date, with_relations=False)
        msg2_id = msg2.id
        expired_10_days_ago = now_timestamp - (10 * 24 * 60 * 60)  # Beyond grace period

        # Scenario 3: Sandbox plan with expiration_date = -1 (no previous subscription)
        # Should be deleted
        account3, tenant3 = self._create_account_and_tenant(plan=CloudPlan.SANDBOX)
        app3 = self._create_app(tenant3, account3)
        conv3 = self._create_conversation(app3)
        msg3 = self._create_message(app3, conv3, created_at=expired_date, with_relations=False)
        msg3_id = msg3.id

        # Scenario 4: Non-sandbox plan (professional) with no expiration (future date)
        # Should NOT be deleted
        account4, tenant4 = self._create_account_and_tenant(plan=CloudPlan.PROFESSIONAL)
        app4 = self._create_app(tenant4, account4)
        conv4 = self._create_conversation(app4)
        msg4 = self._create_message(app4, conv4, created_at=expired_date, with_relations=False)
        msg4_id = msg4.id
        future_expiration = now_timestamp + (365 * 24 * 60 * 60)  # Active for 1 year

        # Scenario 5: Sandbox plan with expiration exactly at grace period boundary (8 days ago)
        # Should NOT be deleted (boundary is exclusive: > graceful_period)
        account5, tenant5 = self._create_account_and_tenant(plan=CloudPlan.SANDBOX)
        app5 = self._create_app(tenant5, account5)
        conv5 = self._create_conversation(app5)
        msg5 = self._create_message(app5, conv5, created_at=expired_date, with_relations=False)
        msg5_id = msg5.id
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

        with patch("services.billing_service.BillingService.get_plan_bulk") as mock_billing:
            mock_billing.return_value = plan_map

            # Act
            end_before = datetime.datetime.now() - datetime.timedelta(days=30)
            policy = create_message_clean_policy(
                graceful_period_days=graceful_period,
                current_timestamp=now_timestamp,  # Use fixed timestamp for deterministic behavior
            )
            service = MessagesCleanService.from_time_range(
                policy=policy,
                start_from=datetime.datetime.now() - datetime.timedelta(days=60),
                end_before=end_before,
                batch_size=100,
            )
            stats = service.run()

        # Assert - Only messages from scenario 2 and 3 should be deleted
        assert stats["total_messages"] == 5  # 5 tenants * 1 message
        assert stats["filtered_messages"] == 2
        assert stats["total_deleted"] == 2

        # Verify each scenario using saved IDs
        assert db.session.query(Message).where(Message.id == msg1_id).count() == 1  # Within grace, kept
        assert db.session.query(Message).where(Message.id == msg2_id).count() == 0  # Beyond grace, deleted
        assert db.session.query(Message).where(Message.id == msg3_id).count() == 0  # No subscription, deleted
        assert db.session.query(Message).where(Message.id == msg4_id).count() == 1  # Professional plan, kept
        assert db.session.query(Message).where(Message.id == msg5_id).count() == 1  # At boundary, kept

    def test_tenant_whitelist(self, db_session_with_containers, mock_billing_enabled, mock_whitelist):
        """Test that whitelisted tenants' messages are not deleted (B9)."""
        # Arrange - Create 3 sandbox tenants with expired messages
        tenants_data = []
        for i in range(3):
            account, tenant = self._create_account_and_tenant(plan=CloudPlan.SANDBOX)
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
                "expiration_date": -1,
            },
            tenants_data[1]["tenant"].id: {
                "plan": CloudPlan.SANDBOX,
                "expiration_date": -1,
            },
            tenants_data[2]["tenant"].id: {
                "plan": CloudPlan.SANDBOX,
                "expiration_date": -1,
            },
        }

        # Setup whitelist - tenant0 and tenant1 are whitelisted, tenant2 is not
        whitelist = [tenants_data[0]["tenant"].id, tenants_data[1]["tenant"].id]
        mock_whitelist.return_value = whitelist

        with patch("services.billing_service.BillingService.get_plan_bulk") as mock_billing:
            mock_billing.return_value = plan_map

            # Act
            end_before = datetime.datetime.now() - datetime.timedelta(days=30)
            policy = create_message_clean_policy(graceful_period_days=21)
            service = MessagesCleanService.from_time_range(
                policy=policy,
                start_from=datetime.datetime.now() - datetime.timedelta(days=60),
                end_before=end_before,
                batch_size=100,
            )
            stats = service.run()

        # Assert - Only tenant2's message should be deleted (not whitelisted)
        assert stats["total_messages"] == 3  # 3 tenants * 1 message
        assert stats["filtered_messages"] == 1
        assert stats["total_deleted"] == 1

        # Verify tenant0's message still exists (whitelisted)
        assert db.session.query(Message).where(Message.id == tenants_data[0]["message_id"]).count() == 1

        # Verify tenant1's message still exists (whitelisted)
        assert db.session.query(Message).where(Message.id == tenants_data[1]["message_id"]).count() == 1

        # Verify tenant2's message was deleted (not whitelisted)
        assert db.session.query(Message).where(Message.id == tenants_data[2]["message_id"]).count() == 0

    def test_from_days_cleans_old_messages(self, db_session_with_containers, mock_billing_enabled, mock_whitelist):
        """Test from_days correctly cleans messages older than N days (B11)."""
        # Arrange
        account, tenant = self._create_account_and_tenant(plan=CloudPlan.SANDBOX)
        app = self._create_app(tenant, account)
        conv = self._create_conversation(app)

        # Create old messages (should be deleted - older than 30 days)
        old_date = datetime.datetime.now() - datetime.timedelta(days=45)
        old_msg_ids = []
        for i in range(3):
            msg = self._create_message(
                app, conv, created_at=old_date - datetime.timedelta(hours=i), with_relations=False
            )
            old_msg_ids.append(msg.id)

        # Create recent messages (should be kept - newer than 30 days)
        recent_date = datetime.datetime.now() - datetime.timedelta(days=15)
        recent_msg_ids = []
        for i in range(2):
            msg = self._create_message(
                app, conv, created_at=recent_date - datetime.timedelta(hours=i), with_relations=False
            )
            recent_msg_ids.append(msg.id)

        db.session.commit()

        with patch("services.billing_service.BillingService.get_plan_bulk") as mock_billing:
            mock_billing.return_value = {
                tenant.id: {
                    "plan": CloudPlan.SANDBOX,
                    "expiration_date": -1,
                }
            }

            # Act - Use from_days to clean messages older than 30 days
            policy = create_message_clean_policy(graceful_period_days=21)
            service = MessagesCleanService.from_days(
                policy=policy,
                days=30,
                batch_size=100,
            )
            stats = service.run()

        # Assert
        assert stats["total_messages"] == 3  # Only old messages in range
        assert stats["filtered_messages"] == 3  # Only old messages
        assert stats["total_deleted"] == 3

        # Old messages deleted
        assert db.session.query(Message).where(Message.id.in_(old_msg_ids)).count() == 0
        # Recent messages kept
        assert db.session.query(Message).where(Message.id.in_(recent_msg_ids)).count() == 2

    def test_whitelist_precedence_over_grace_period(
        self, db_session_with_containers, mock_billing_enabled, mock_whitelist
    ):
        """Test that whitelist takes precedence over grace period logic."""
        # Arrange - Create 2 sandbox tenants
        now_timestamp = int(datetime.datetime.now(datetime.UTC).timestamp())

        # Tenant1: whitelisted, expired beyond grace period
        account1, tenant1 = self._create_account_and_tenant(plan=CloudPlan.SANDBOX)
        app1 = self._create_app(tenant1, account1)
        conv1 = self._create_conversation(app1)
        expired_date = datetime.datetime.now() - datetime.timedelta(days=35)
        msg1 = self._create_message(app1, conv1, created_at=expired_date, with_relations=False)
        expired_30_days_ago = now_timestamp - (30 * 24 * 60 * 60)  # Well beyond 21-day grace

        # Tenant2: not whitelisted, within grace period
        account2, tenant2 = self._create_account_and_tenant(plan=CloudPlan.SANDBOX)
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

        with patch("services.billing_service.BillingService.get_plan_bulk") as mock_billing:
            mock_billing.return_value = plan_map

            # Act
            end_before = datetime.datetime.now() - datetime.timedelta(days=30)
            policy = create_message_clean_policy(graceful_period_days=21)
            service = MessagesCleanService.from_time_range(
                policy=policy,
                start_from=datetime.datetime.now() - datetime.timedelta(days=60),
                end_before=end_before,
                batch_size=100,
            )
            stats = service.run()

        # Assert - No messages should be deleted
        # tenant1: whitelisted (protected even though beyond grace period)
        # tenant2: within grace period (not eligible for deletion)
        assert stats["total_messages"] == 2  # 2 tenants * 1 message
        assert stats["filtered_messages"] == 0
        assert stats["total_deleted"] == 0

        # Verify both messages still exist
        assert db.session.query(Message).where(Message.id == msg1.id).count() == 1  # Whitelisted
        assert db.session.query(Message).where(Message.id == msg2.id).count() == 1  # Within grace period

    def test_empty_whitelist_deletes_eligible_messages(
        self, db_session_with_containers, mock_billing_enabled, mock_whitelist
    ):
        """Test that empty whitelist behaves as no whitelist (all eligible messages deleted)."""
        # Arrange - Create sandbox tenant with expired messages
        account, tenant = self._create_account_and_tenant(plan=CloudPlan.SANDBOX)
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
                "expiration_date": -1,
            }
        }

        # Setup empty whitelist (default behavior from fixture)
        mock_whitelist.return_value = []

        with patch("services.billing_service.BillingService.get_plan_bulk") as mock_billing:
            mock_billing.return_value = plan_map

            # Act
            end_before = datetime.datetime.now() - datetime.timedelta(days=30)
            policy = create_message_clean_policy(graceful_period_days=21)
            service = MessagesCleanService.from_time_range(
                policy=policy,
                start_from=datetime.datetime.now() - datetime.timedelta(days=60),
                end_before=end_before,
                batch_size=100,
            )
            stats = service.run()

        # Assert - All messages should be deleted (no whitelist protection)
        assert stats["total_messages"] == 3
        assert stats["filtered_messages"] == 3
        assert stats["total_deleted"] == 3

        # Verify all messages were deleted
        assert db.session.query(Message).where(Message.id.in_(msg_ids)).count() == 0
