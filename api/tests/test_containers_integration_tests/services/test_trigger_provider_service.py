from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from constants import HIDDEN_VALUE, UNKNOWN_VALUE
from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.entities import Subscription as TriggerSubscriptionEntity
from extensions.ext_database import db
from models.provider_ids import TriggerProviderID
from models.trigger import TriggerSubscription
from services.trigger.trigger_provider_service import TriggerProviderService


class TestTriggerProviderService:
    """Integration tests for TriggerProviderService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.trigger.trigger_provider_service.TriggerManager") as mock_trigger_manager,
            patch("services.trigger.trigger_provider_service.redis_client") as mock_redis_client,
            patch("services.trigger.trigger_provider_service.delete_cache_for_subscription") as mock_delete_cache,
            patch("services.account_service.FeatureService") as mock_account_feature_service,
        ):
            # Setup default mock returns
            mock_provider_controller = MagicMock()
            mock_provider_controller.get_credential_schema_config.return_value = MagicMock()
            mock_provider_controller.get_properties_schema.return_value = MagicMock()
            mock_trigger_manager.get_trigger_provider.return_value = mock_provider_controller

            # Mock redis lock
            mock_lock = MagicMock()
            mock_lock.__enter__ = MagicMock(return_value=None)
            mock_lock.__exit__ = MagicMock(return_value=None)
            mock_redis_client.lock.return_value = mock_lock

            # Setup account feature service mock
            mock_account_feature_service.get_system_features.return_value.is_allow_register = True

            yield {
                "trigger_manager": mock_trigger_manager,
                "redis_client": mock_redis_client,
                "delete_cache": mock_delete_cache,
                "provider_controller": mock_provider_controller,
                "account_feature_service": mock_account_feature_service,
            }

    def _create_test_account_and_tenant(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Helper method to create a test account and tenant for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies

        Returns:
            tuple: (account, tenant) - Created account and tenant instances
        """
        fake = Faker()

        from services.account_service import AccountService, TenantService

        # Setup mocks for account creation
        mock_external_service_dependencies[
            "account_feature_service"
        ].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies[
            "trigger_manager"
        ].get_trigger_provider.return_value = mock_external_service_dependencies["provider_controller"]

        # Create account and tenant
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        return account, tenant

    def _create_test_subscription(
        self,
        db_session_with_containers,
        tenant_id,
        user_id,
        provider_id,
        credential_type,
        credentials,
        mock_external_service_dependencies,
    ):
        """
        Helper method to create a test trigger subscription.

        Args:
            db_session_with_containers: Database session
            tenant_id: Tenant ID
            user_id: User ID
            provider_id: Provider ID
            credential_type: Credential type
            credentials: Credentials dict
            mock_external_service_dependencies: Mock dependencies

        Returns:
            TriggerSubscription: Created subscription instance
        """
        fake = Faker()
        from core.helper.provider_cache import NoOpProviderCredentialCache
        from core.helper.provider_encryption import create_provider_encrypter

        # Use mock provider controller to encrypt credentials
        provider_controller = mock_external_service_dependencies["provider_controller"]

        # Create encrypter for credentials
        credential_encrypter, _ = create_provider_encrypter(
            tenant_id=tenant_id,
            config=provider_controller.get_credential_schema_config(credential_type),
            cache=NoOpProviderCredentialCache(),
        )

        subscription = TriggerSubscription(
            name=fake.word(),
            tenant_id=tenant_id,
            user_id=user_id,
            provider_id=str(provider_id),
            endpoint_id=fake.uuid4(),
            parameters={"param1": "value1"},
            properties={"prop1": "value1"},
            credentials=dict(credential_encrypter.encrypt(credentials)),
            credential_type=credential_type.value,
            credential_expires_at=-1,
            expires_at=-1,
        )

        db.session.add(subscription)
        db.session.commit()
        db.session.refresh(subscription)

        return subscription

    def test_rebuild_trigger_subscription_success_with_merged_credentials(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful rebuild with credential merging (HIDDEN_VALUE handling).

        This test verifies:
        - Credentials are properly merged (HIDDEN_VALUE replaced with existing values)
        - Single transaction wraps all operations
        - Merged credentials are used for subscribe and update
        - Database state is correctly updated
        """
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        provider_id = TriggerProviderID("test_org/test_plugin/test_provider")
        credential_type = CredentialType.API_KEY

        # Create initial subscription with credentials
        original_credentials = {"api_key": "original-secret-key", "api_secret": "original-secret"}
        subscription = self._create_test_subscription(
            db_session_with_containers,
            tenant.id,
            account.id,
            provider_id,
            credential_type,
            original_credentials,
            mock_external_service_dependencies,
        )

        # Prepare new credentials with HIDDEN_VALUE for api_key (should keep original)
        # and new value for api_secret (should update)
        new_credentials = {
            "api_key": HIDDEN_VALUE,  # Should be replaced with original
            "api_secret": "new-secret-value",  # Should be updated
        }

        # Mock subscribe_trigger to return a new subscription entity
        new_subscription_entity = TriggerSubscriptionEntity(
            endpoint=subscription.endpoint_id,
            parameters={"param1": "value1"},
            properties={"prop1": "new_prop_value"},
            expires_at=1234567890,
        )
        mock_external_service_dependencies["trigger_manager"].subscribe_trigger.return_value = new_subscription_entity

        # Mock unsubscribe_trigger
        mock_external_service_dependencies["trigger_manager"].unsubscribe_trigger.return_value = MagicMock()

        # Execute rebuild
        TriggerProviderService.rebuild_trigger_subscription(
            tenant_id=tenant.id,
            provider_id=provider_id,
            subscription_id=subscription.id,
            credentials=new_credentials,
            parameters={"param1": "updated_value"},
            name="updated_name",
        )

        # Verify unsubscribe was called with decrypted original credentials
        mock_external_service_dependencies["trigger_manager"].unsubscribe_trigger.assert_called_once()
        unsubscribe_call_args = mock_external_service_dependencies["trigger_manager"].unsubscribe_trigger.call_args
        assert unsubscribe_call_args.kwargs["tenant_id"] == tenant.id
        assert unsubscribe_call_args.kwargs["provider_id"] == provider_id
        assert unsubscribe_call_args.kwargs["credential_type"] == credential_type

        # Verify subscribe was called with merged credentials (api_key from original, api_secret new)
        mock_external_service_dependencies["trigger_manager"].subscribe_trigger.assert_called_once()
        subscribe_call_args = mock_external_service_dependencies["trigger_manager"].subscribe_trigger.call_args
        subscribe_credentials = subscribe_call_args.kwargs["credentials"]
        assert subscribe_credentials["api_key"] == original_credentials["api_key"]  # Merged from original
        assert subscribe_credentials["api_secret"] == "new-secret-value"  # New value

        # Verify database state was updated
        db.session.refresh(subscription)
        assert subscription.name == "updated_name"
        assert subscription.parameters == {"param1": "updated_value"}

        # Verify credentials in DB were updated with merged values (decrypt to check)
        from core.helper.provider_cache import NoOpProviderCredentialCache
        from core.helper.provider_encryption import create_provider_encrypter

        # Use mock provider controller to decrypt credentials
        provider_controller = mock_external_service_dependencies["provider_controller"]
        credential_encrypter, _ = create_provider_encrypter(
            tenant_id=tenant.id,
            config=provider_controller.get_credential_schema_config(credential_type),
            cache=NoOpProviderCredentialCache(),
        )
        decrypted_db_credentials = dict(credential_encrypter.decrypt(subscription.credentials))
        assert decrypted_db_credentials["api_key"] == original_credentials["api_key"]
        assert decrypted_db_credentials["api_secret"] == "new-secret-value"

        # Verify cache was cleared
        mock_external_service_dependencies["delete_cache"].assert_called_once_with(
            tenant_id=tenant.id,
            provider_id=subscription.provider_id,
            subscription_id=subscription.id,
        )

    def test_rebuild_trigger_subscription_with_all_new_credentials(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test rebuild when all credentials are new (no HIDDEN_VALUE).

        This test verifies:
        - All new credentials are used when no HIDDEN_VALUE is present
        - Merged credentials contain only new values
        """
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        provider_id = TriggerProviderID("test_org/test_plugin/test_provider")
        credential_type = CredentialType.API_KEY

        # Create initial subscription
        original_credentials = {"api_key": "original-key", "api_secret": "original-secret"}
        subscription = self._create_test_subscription(
            db_session_with_containers,
            tenant.id,
            account.id,
            provider_id,
            credential_type,
            original_credentials,
            mock_external_service_dependencies,
        )

        # All new credentials (no HIDDEN_VALUE)
        new_credentials = {
            "api_key": "completely-new-key",
            "api_secret": "completely-new-secret",
        }

        new_subscription_entity = TriggerSubscriptionEntity(
            endpoint=subscription.endpoint_id,
            parameters={},
            properties={},
            expires_at=-1,
        )
        mock_external_service_dependencies["trigger_manager"].subscribe_trigger.return_value = new_subscription_entity
        mock_external_service_dependencies["trigger_manager"].unsubscribe_trigger.return_value = MagicMock()

        # Execute rebuild
        TriggerProviderService.rebuild_trigger_subscription(
            tenant_id=tenant.id,
            provider_id=provider_id,
            subscription_id=subscription.id,
            credentials=new_credentials,
            parameters={},
        )

        # Verify subscribe was called with all new credentials
        subscribe_call_args = mock_external_service_dependencies["trigger_manager"].subscribe_trigger.call_args
        subscribe_credentials = subscribe_call_args.kwargs["credentials"]
        assert subscribe_credentials["api_key"] == "completely-new-key"
        assert subscribe_credentials["api_secret"] == "completely-new-secret"

    def test_rebuild_trigger_subscription_with_all_hidden_values(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test rebuild when all credentials are HIDDEN_VALUE (preserve all existing).

        This test verifies:
        - All HIDDEN_VALUE credentials are replaced with existing values
        - Original credentials are preserved
        """
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        provider_id = TriggerProviderID("test_org/test_plugin/test_provider")
        credential_type = CredentialType.API_KEY

        original_credentials = {"api_key": "original-key", "api_secret": "original-secret"}
        subscription = self._create_test_subscription(
            db_session_with_containers,
            tenant.id,
            account.id,
            provider_id,
            credential_type,
            original_credentials,
            mock_external_service_dependencies,
        )

        # All HIDDEN_VALUE (should preserve all original)
        new_credentials = {
            "api_key": HIDDEN_VALUE,
            "api_secret": HIDDEN_VALUE,
        }

        new_subscription_entity = TriggerSubscriptionEntity(
            endpoint=subscription.endpoint_id,
            parameters={},
            properties={},
            expires_at=-1,
        )
        mock_external_service_dependencies["trigger_manager"].subscribe_trigger.return_value = new_subscription_entity
        mock_external_service_dependencies["trigger_manager"].unsubscribe_trigger.return_value = MagicMock()

        # Execute rebuild
        TriggerProviderService.rebuild_trigger_subscription(
            tenant_id=tenant.id,
            provider_id=provider_id,
            subscription_id=subscription.id,
            credentials=new_credentials,
            parameters={},
        )

        # Verify subscribe was called with all original credentials
        subscribe_call_args = mock_external_service_dependencies["trigger_manager"].subscribe_trigger.call_args
        subscribe_credentials = subscribe_call_args.kwargs["credentials"]
        assert subscribe_credentials["api_key"] == original_credentials["api_key"]
        assert subscribe_credentials["api_secret"] == original_credentials["api_secret"]

    def test_rebuild_trigger_subscription_with_missing_key_uses_unknown_value(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test rebuild when HIDDEN_VALUE is used for a key that doesn't exist in original.

        This test verifies:
        - UNKNOWN_VALUE is used when HIDDEN_VALUE key doesn't exist in original credentials
        """
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        provider_id = TriggerProviderID("test_org/test_plugin/test_provider")
        credential_type = CredentialType.API_KEY

        # Original has only api_key
        original_credentials = {"api_key": "original-key"}
        subscription = self._create_test_subscription(
            db_session_with_containers,
            tenant.id,
            account.id,
            provider_id,
            credential_type,
            original_credentials,
            mock_external_service_dependencies,
        )

        # HIDDEN_VALUE for non-existent key should use UNKNOWN_VALUE
        new_credentials = {
            "api_key": HIDDEN_VALUE,
            "non_existent_key": HIDDEN_VALUE,  # This key doesn't exist in original
        }

        new_subscription_entity = TriggerSubscriptionEntity(
            endpoint=subscription.endpoint_id,
            parameters={},
            properties={},
            expires_at=-1,
        )
        mock_external_service_dependencies["trigger_manager"].subscribe_trigger.return_value = new_subscription_entity
        mock_external_service_dependencies["trigger_manager"].unsubscribe_trigger.return_value = MagicMock()

        # Execute rebuild
        TriggerProviderService.rebuild_trigger_subscription(
            tenant_id=tenant.id,
            provider_id=provider_id,
            subscription_id=subscription.id,
            credentials=new_credentials,
            parameters={},
        )

        # Verify subscribe was called with original api_key and UNKNOWN_VALUE for missing key
        subscribe_call_args = mock_external_service_dependencies["trigger_manager"].subscribe_trigger.call_args
        subscribe_credentials = subscribe_call_args.kwargs["credentials"]
        assert subscribe_credentials["api_key"] == original_credentials["api_key"]
        assert subscribe_credentials["non_existent_key"] == UNKNOWN_VALUE

    def test_rebuild_trigger_subscription_rollback_on_error(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test that transaction is rolled back on error.

        This test verifies:
        - Database transaction is rolled back when an error occurs
        - Original subscription state is preserved
        """
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        provider_id = TriggerProviderID("test_org/test_plugin/test_provider")
        credential_type = CredentialType.API_KEY

        original_credentials = {"api_key": "original-key"}
        subscription = self._create_test_subscription(
            db_session_with_containers,
            tenant.id,
            account.id,
            provider_id,
            credential_type,
            original_credentials,
            mock_external_service_dependencies,
        )

        original_name = subscription.name
        original_parameters = subscription.parameters.copy()

        # Make subscribe_trigger raise an error
        mock_external_service_dependencies["trigger_manager"].subscribe_trigger.side_effect = ValueError(
            "Subscribe failed"
        )
        mock_external_service_dependencies["trigger_manager"].unsubscribe_trigger.return_value = MagicMock()

        # Execute rebuild and expect error
        with pytest.raises(ValueError, match="Subscribe failed"):
            TriggerProviderService.rebuild_trigger_subscription(
                tenant_id=tenant.id,
                provider_id=provider_id,
                subscription_id=subscription.id,
                credentials={"api_key": "new-key"},
                parameters={},
            )

        # Verify subscription state was not changed (rolled back)
        db.session.refresh(subscription)
        assert subscription.name == original_name
        assert subscription.parameters == original_parameters

    def test_rebuild_trigger_subscription_subscription_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test error when subscription is not found.

        This test verifies:
        - Proper error is raised when subscription doesn't exist
        """
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        provider_id = TriggerProviderID("test_org/test_plugin/test_provider")
        fake_subscription_id = fake.uuid4()

        with pytest.raises(ValueError, match="not found"):
            TriggerProviderService.rebuild_trigger_subscription(
                tenant_id=tenant.id,
                provider_id=provider_id,
                subscription_id=fake_subscription_id,
                credentials={},
                parameters={},
            )

    def test_rebuild_trigger_subscription_name_uniqueness_check(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test that name uniqueness is checked when updating name.

        This test verifies:
        - Error is raised when new name conflicts with existing subscription
        """
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        provider_id = TriggerProviderID("test_org/test_plugin/test_provider")
        credential_type = CredentialType.API_KEY

        # Create first subscription
        subscription1 = self._create_test_subscription(
            db_session_with_containers,
            tenant.id,
            account.id,
            provider_id,
            credential_type,
            {"api_key": "key1"},
            mock_external_service_dependencies,
        )

        # Create second subscription with different name
        subscription2 = self._create_test_subscription(
            db_session_with_containers,
            tenant.id,
            account.id,
            provider_id,
            credential_type,
            {"api_key": "key2"},
            mock_external_service_dependencies,
        )

        new_subscription_entity = TriggerSubscriptionEntity(
            endpoint=subscription2.endpoint_id,
            parameters={},
            properties={},
            expires_at=-1,
        )
        mock_external_service_dependencies["trigger_manager"].subscribe_trigger.return_value = new_subscription_entity
        mock_external_service_dependencies["trigger_manager"].unsubscribe_trigger.return_value = MagicMock()

        # Try to rename subscription2 to subscription1's name (should fail)
        with pytest.raises(ValueError, match="already exists"):
            TriggerProviderService.rebuild_trigger_subscription(
                tenant_id=tenant.id,
                provider_id=provider_id,
                subscription_id=subscription2.id,
                credentials={"api_key": "new-key"},
                parameters={},
                name=subscription1.name,  # Conflicting name
            )
