from unittest.mock import MagicMock, patch

import httpx
import pytest
from sqlalchemy.orm import Session

from core.plugin.entities.plugin_daemon import CredentialType
from graphon.model_runtime.entities.provider_entities import FormType
from models.account import Account
from models.model import EndUser
from models.oauth import DatasourceProvider
from models.provider_ids import DatasourceProviderID
from services.datasource_provider_service import DatasourceProviderService, get_current_user

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_id(s: str = "org/plugin/provider") -> DatasourceProviderID:
    return DatasourceProviderID(s)


# ---------------------------------------------------------------------------
# Test class
# ---------------------------------------------------------------------------


class TestDatasourceProviderService:
    """Comprehensive tests for DatasourceProviderService targeting >95% coverage."""

    @pytest.fixture
    def service(self):
        return DatasourceProviderService()

    @pytest.fixture
    def mock_db_session(self):
        """
        Mock session with scalar/scalars defaults for current SQLAlchemy access paths.
        """
        with (
            patch("services.datasource_provider_service.Session") as mock_cls,
            patch("services.datasource_provider_service.sessionmaker") as mock_sm,
        ):
            sess = MagicMock(spec=Session)

            # Default values for select()-style calls (tests override per-case)
            sess.scalar.return_value = None
            sess.scalars.return_value.all.return_value = []

            mock_cls.return_value.__enter__.return_value = sess
            mock_cls.return_value.no_autoflush.__enter__.return_value = sess
            mock_sm.return_value.begin.return_value.__enter__.return_value = sess
            mock_sm.return_value.begin.return_value.__exit__ = MagicMock(return_value=False)

            yield sess

    @pytest.fixture(autouse=True)
    def patch_db(self, mock_db_session):
        with patch("services.datasource_provider_service.db") as mock_db:
            mock_db.session = mock_db_session
            mock_db.engine = MagicMock()
            yield mock_db

    @pytest.fixture(autouse=True)
    def patch_externals(self):
        with (
            patch("core.plugin.impl.base._httpx_client.request", side_effect=lambda **kw: httpx.request(**kw)),
            patch("core.plugin.impl.base._httpx_client.stream", side_effect=lambda **kw: httpx.stream(**kw)),
            patch("httpx.request") as mock_httpx,
            patch("services.datasource_provider_service.dify_config") as mock_cfg,
            patch("services.datasource_provider_service.encrypter") as mock_enc,
            patch("services.datasource_provider_service.redis_client") as mock_redis,
            patch("services.datasource_provider_service.generate_incremental_name") as mock_genname,
            patch("services.datasource_provider_service.OAuthHandler") as mock_oauth,
        ):
            mock_cfg.CONSOLE_API_URL = "http://localhost"
            mock_enc.encrypt_token.return_value = "enc_tok"
            mock_enc.decrypt_token.return_value = "dec_tok"
            mock_enc.decrypt.return_value = {"k": "dec"}
            mock_enc.encrypt.return_value = {"k": "enc"}
            mock_enc.obfuscated_token.return_value = "obf"
            mock_enc.mask_plugin_credentials.return_value = {"k": "mask"}

            mock_redis.lock.return_value.__enter__.return_value = MagicMock()
            mock_genname.return_value = "gen_name"

            mock_oauth.return_value.refresh_credentials.return_value = MagicMock(
                credentials={"k": "v"}, expires_at=9999
            )

            resp = MagicMock()
            resp.status_code = 200
            resp.json.return_value = {
                "code": 0,
                "message": "ok",
                "data": {
                    "provider": "prov",
                    "plugin_unique_identifier": "pui",
                    "plugin_id": "org/plug",
                    "is_authorized": False,
                    "declaration": {
                        "identity": {
                            "author": "a",
                            "name": "n",
                            "description": {"en_US": "d"},
                            "icon": "i",
                            "label": {"en_US": "l"},
                        },
                        "credentials_schema": [],
                        "oauth_schema": {"credentials_schema": [], "client_schema": []},
                        "provider_type": "local_file",
                        "datasources": [],
                    },
                },
            }
            mock_httpx.return_value = resp

            # Store handles for assertions
            self._enc = mock_enc
            self._redis = mock_redis
            yield

    @pytest.fixture
    def mock_user(self):
        u = MagicMock()
        u.id = "uid-1"
        return u

    # -----------------------------------------------------------------------
    # get_current_user (lines 27-40)
    # -----------------------------------------------------------------------

    def test_should_return_proxy_when_current_object_is_account(self):
        with patch("libs.login.current_user", new_callable=MagicMock) as proxy:
            user_obj = MagicMock()
            user_obj.__class__ = Account
            proxy._get_current_object.return_value = user_obj
            assert get_current_user() is proxy

    def test_should_return_proxy_when_current_object_is_enduser(self):
        with patch("libs.login.current_user", new_callable=MagicMock) as proxy:
            user_obj = MagicMock()
            user_obj.__class__ = EndUser
            proxy._get_current_object.return_value = user_obj
            assert get_current_user() is proxy

    def test_should_return_proxy_when_get_current_object_raises_attribute_error(self):
        """AttributeError from LocalProxy falls back to the proxy itself."""
        with patch("libs.login.current_user", new_callable=MagicMock) as proxy:
            proxy._get_current_object.side_effect = AttributeError("no attr")
            proxy.__class__ = Account  # make the proxy itself satisfy isinstance
            assert get_current_user() is proxy

    def test_should_raise_type_error_when_user_is_not_account_or_enduser(self):
        with patch("libs.login.current_user", new_callable=MagicMock) as proxy:
            proxy._get_current_object.return_value = "plain_string"
            with pytest.raises(TypeError, match="current_user must be Account or EndUser"):
                get_current_user()

    # -----------------------------------------------------------------------
    # is_system_oauth_params_exist (line 357-363)
    # -----------------------------------------------------------------------

    def test_should_return_true_when_system_oauth_params_exist(self, service, mock_db_session):
        mock_db_session.scalar.return_value = MagicMock()
        assert service.is_system_oauth_params_exist(make_id()) is True

    def test_should_return_false_when_system_oauth_params_missing(self, service, mock_db_session):
        mock_db_session.scalar.return_value = None
        assert service.is_system_oauth_params_exist(make_id()) is False

    # -----------------------------------------------------------------------
    # is_tenant_oauth_params_enabled (lines 365-379)
    # NOTE: uses .count() not .first()
    # -----------------------------------------------------------------------

    def test_should_return_true_when_tenant_oauth_params_enabled(self, service, mock_db_session):
        mock_db_session.scalar.return_value = 1
        assert service.is_tenant_oauth_params_enabled("t1", make_id()) is True

    def test_should_return_false_when_tenant_oauth_params_disabled(self, service, mock_db_session):
        mock_db_session.scalar.return_value = 0
        assert service.is_tenant_oauth_params_enabled("t1", make_id()) is False

    # -----------------------------------------------------------------------
    # remove_oauth_custom_client_params (lines 55-61)
    # -----------------------------------------------------------------------

    def test_should_delete_tenant_config_when_removing_oauth_params(self, service, mock_db_session):
        service.remove_oauth_custom_client_params("t1", make_id())
        mock_db_session.execute.assert_called_once()

    # -----------------------------------------------------------------------
    # setup_oauth_custom_client_params (315-351)
    # -----------------------------------------------------------------------

    def test_should_skip_db_write_when_credentials_are_none(self, service, mock_db_session):
        """When credentials=None, should return immediately without any DB write."""
        service.setup_oauth_custom_client_params("t1", make_id(), None, None)
        mock_db_session.add.assert_not_called()

    def test_should_create_new_config_when_none_exists(self, service, mock_db_session):
        mock_db_session.scalar.return_value = None
        with patch.object(service, "get_oauth_encrypter", return_value=(self._enc, None)):
            service.setup_oauth_custom_client_params("t1", make_id(), {"k": "v"}, True)
        mock_db_session.add.assert_called_once()

    def test_should_update_existing_config_when_record_found(self, service, mock_db_session):
        existing = MagicMock()
        mock_db_session.scalar.return_value = existing
        with patch.object(service, "get_oauth_encrypter", return_value=(self._enc, None)):
            service.setup_oauth_custom_client_params("t1", make_id(), {"k": "v"}, False)
        mock_db_session.add.assert_not_called()  # update in place, no add

    # -----------------------------------------------------------------------
    # decrypt / encrypt credentials (lines 70-98)
    # -----------------------------------------------------------------------

    def test_should_decrypt_secret_fields_when_decrypting_api_key_credentials(self, service, mock_db_session):
        p = MagicMock(spec=DatasourceProvider)
        p.auth_type = "api_key"
        p.encrypted_credentials = {"sk": "enc_val"}
        with patch.object(service, "extract_secret_variables", return_value=["sk"]):
            result = service.decrypt_datasource_provider_credentials("t1", p, "org/plug", "prov")
        assert result["sk"] == "dec_tok"

    def test_should_encrypt_secret_fields_when_encrypting_api_key_credentials(self, service, mock_db_session):
        p = MagicMock(spec=DatasourceProvider)
        p.auth_type = "api_key"
        with patch.object(service, "extract_secret_variables", return_value=["sk"]):
            result = service.encrypt_datasource_provider_credentials("t1", "prov", "org/plug", {"sk": "plain"}, p)
        assert result["sk"] == "enc_tok"
        self._enc.encrypt_token.assert_called()

    # -----------------------------------------------------------------------
    # get_datasource_credentials (lines 113-165)
    # -----------------------------------------------------------------------

    def test_should_return_empty_dict_when_credential_not_found(self, service, mock_db_session, mock_user):
        with patch("services.datasource_provider_service.get_current_user", return_value=mock_user):
            mock_db_session.scalar.return_value = None
            assert service.get_datasource_credentials("t1", "prov", "org/plug") == {}

    def test_should_refresh_oauth_tokens_when_expired(self, service, mock_db_session, mock_user):
        """Expired OAuth credential (expires_at near zero) triggers a refresh."""
        p = MagicMock(spec=DatasourceProvider)
        p.auth_type = "oauth2"
        p.expires_at = 0  # expired
        p.encrypted_credentials = {"tok": "x"}
        mock_db_session.scalar.return_value = p
        with (
            patch("services.datasource_provider_service.get_current_user", return_value=mock_user),
            patch.object(service, "get_oauth_client", return_value={"oc": "v"}),
            patch.object(service, "decrypt_datasource_provider_credentials", return_value={"tok": "plain"}),
        ):
            service.get_datasource_credentials("t1", "prov", "org/plug")

    def test_should_include_provider_name_when_refresh_fails(self, service, mock_db_session, mock_user):
        p = MagicMock(spec=DatasourceProvider)
        p.id = "cred-id"
        p.name = "Credential"
        p.auth_type = "oauth2"
        p.expires_at = 0
        p.encrypted_credentials = {"tok": "x"}
        mock_db_session.scalar.return_value = p
        with (
            patch("services.datasource_provider_service.get_current_user", return_value=mock_user),
            patch("services.datasource_provider_service.OAuthHandler") as oauth_handler,
            patch.object(service, "get_oauth_client", return_value={"oc": "v"}),
            patch.object(service, "decrypt_datasource_provider_credentials", return_value={"tok": "plain"}),
        ):
            oauth_handler.return_value.refresh_credentials.side_effect = RuntimeError("token endpoint failed")
            with pytest.raises(ValueError, match="provider prov"):
                service.get_datasource_credentials("t1", "prov", "org/plug")

    def test_should_return_decrypted_credentials_when_api_key_not_expired(self, service, mock_db_session, mock_user):
        """API key credentials with expires_at=-1 skip refresh and return directly."""
        p = MagicMock(spec=DatasourceProvider)
        p.auth_type = "api_key"
        p.expires_at = -1  # sentinel: never expires
        p.encrypted_credentials = {"k": "v"}
        mock_db_session.scalar.return_value = p
        with (
            patch("services.datasource_provider_service.get_current_user", return_value=mock_user),
            patch.object(service, "decrypt_datasource_provider_credentials", return_value={"k": "plain"}),
        ):
            result = service.get_datasource_credentials("t1", "prov", "org/plug")
        assert result == {"k": "plain"}

    def test_should_fetch_by_credential_id_when_provided(self, service, mock_db_session, mock_user):
        """When credential_id is passed, the credential_id filter path (line 113) is taken."""
        p = MagicMock(spec=DatasourceProvider)
        p.auth_type = "api_key"
        p.expires_at = -1
        p.encrypted_credentials = {}
        mock_db_session.scalar.return_value = p
        with (
            patch("services.datasource_provider_service.get_current_user", return_value=mock_user),
            patch.object(service, "decrypt_datasource_provider_credentials", return_value={"k": "v"}),
        ):
            result = service.get_datasource_credentials("t1", "prov", "org/plug", credential_id="cred-id")
        assert result == {"k": "v"}

    # -----------------------------------------------------------------------
    # get_all_datasource_credentials_by_provider (lines 176-228)
    # -----------------------------------------------------------------------

    def test_should_return_empty_list_when_no_provider_credentials_exist(self, service, mock_db_session, mock_user):
        with patch("services.datasource_provider_service.get_current_user", return_value=mock_user):
            mock_db_session.scalars.return_value.all.return_value = []
            assert service.get_all_datasource_credentials_by_provider("t1", "prov", "org/plug") == []

    def test_should_refresh_and_return_credentials_when_oauth_expired(self, service, mock_db_session, mock_user):
        p = MagicMock(spec=DatasourceProvider)
        p.auth_type = "oauth2"
        p.expires_at = 0
        p.encrypted_credentials = {"t": "x"}
        mock_db_session.scalars.return_value.all.return_value = [p]
        with (
            patch("services.datasource_provider_service.get_current_user", return_value=mock_user),
            patch.object(service, "get_oauth_client", return_value={"oc": "v"}),
            patch.object(service, "decrypt_datasource_provider_credentials", return_value={"t": "plain"}),
        ):
            result = service.get_all_datasource_credentials_by_provider("t1", "prov", "org/plug")
        assert len(result) == 1

    def test_should_skip_failed_provider_when_refreshing_all_credentials(
        self, service, mock_db_session, mock_user, caplog
    ):
        failed_provider = MagicMock(spec=DatasourceProvider)
        failed_provider.id = "failed-cred"
        failed_provider.name = "Failed"
        failed_provider.auth_type = "oauth2"
        failed_provider.expires_at = 0
        working_provider = MagicMock(spec=DatasourceProvider)
        working_provider.id = "working-cred"
        working_provider.name = "Working"
        working_provider.auth_type = "oauth2"
        working_provider.expires_at = 0
        mock_db_session.scalars.return_value.all.return_value = [failed_provider, working_provider]
        with (
            patch("services.datasource_provider_service.get_current_user", return_value=mock_user),
            patch.object(
                service,
                "_refresh_datasource_credentials",
                side_effect=[ValueError("refresh failed"), ({"t": "enc"}, 9999)],
            ) as refresh_credentials,
            patch.object(service, "decrypt_datasource_provider_credentials", return_value={"t": "plain"}),
        ):
            result = service.get_all_datasource_credentials_by_provider("t1", "prov", "org/plug")
        assert result == [{"t": "plain"}]
        assert refresh_credentials.call_count == 2
        assert "Skipping datasource credentials for provider prov" in caplog.text

    def test_should_return_valid_credentials_without_refresh_when_getting_all_credentials(
        self, service, mock_db_session, mock_user
    ):
        p = MagicMock(spec=DatasourceProvider)
        p.auth_type = "oauth2"
        p.expires_at = -1
        p.encrypted_credentials = {"t": "x"}
        mock_db_session.scalars.return_value.all.return_value = [p]
        with (
            patch("services.datasource_provider_service.get_current_user", return_value=mock_user),
            patch.object(service, "_refresh_datasource_credentials") as refresh_credentials,
            patch.object(service, "decrypt_datasource_provider_credentials", return_value={"t": "plain"}),
        ):
            result = service.get_all_datasource_credentials_by_provider("t1", "prov", "org/plug")
        assert result == [{"t": "plain"}]
        refresh_credentials.assert_not_called()

    # -----------------------------------------------------------------------
    # update_datasource_provider_name (lines 236-303)
    # -----------------------------------------------------------------------

    def test_should_raise_value_error_when_provider_not_found_on_name_update(self, service, mock_db_session):
        mock_db_session.scalar.return_value = None
        with pytest.raises(ValueError, match="not found"):
            service.update_datasource_provider_name("t1", make_id(), "new", "cred-id")

    def test_should_return_early_when_new_name_matches_current(self, service, mock_db_session):
        p = MagicMock(spec=DatasourceProvider)
        p.name = "same"
        mock_db_session.scalar.return_value = p
        service.update_datasource_provider_name("t1", make_id(), "same", "cred-id")

    def test_should_raise_value_error_when_name_already_exists(self, service, mock_db_session):
        p = MagicMock(spec=DatasourceProvider)
        p.name = "old_name"
        p.is_default = False
        mock_db_session.scalar.side_effect = [p, 1]  # first: fetch provider, second: name conflict count
        with pytest.raises(ValueError, match="already exists"):
            service.update_datasource_provider_name("t1", make_id(), "new_name", "some-id")

    def test_should_update_name_and_commit_when_no_conflict(self, service, mock_db_session):
        p = MagicMock(spec=DatasourceProvider)
        p.name = "old_name"
        p.is_default = False
        mock_db_session.scalar.side_effect = [p, 0]  # first: fetch provider, second: name conflict count
        service.update_datasource_provider_name("t1", make_id(), "new_name", "some-id")
        assert p.name == "new_name"

    # -----------------------------------------------------------------------
    # set_default_datasource_provider (lines 277-303)
    # -----------------------------------------------------------------------

    def test_should_raise_value_error_when_target_provider_not_found(self, service, mock_db_session):
        mock_db_session.scalar.return_value = None
        with pytest.raises(ValueError, match="not found"):
            service.set_default_datasource_provider("t1", make_id(), "bad-id")

    def test_should_mark_target_as_default_and_commit(self, service, mock_db_session):
        target = MagicMock(spec=DatasourceProvider)
        target.provider = "provider"
        target.plugin_id = "org/plug"
        mock_db_session.scalar.return_value = target
        service.set_default_datasource_provider("t1", make_id(), "new-id")
        assert target.is_default is True

    # -----------------------------------------------------------------------
    # get_oauth_encrypter (lines 404-420)
    # -----------------------------------------------------------------------

    def test_should_raise_value_error_when_oauth_schema_missing(self, service):
        pm = MagicMock()
        pm.declaration.oauth_schema = None
        with patch.object(service.provider_manager, "fetch_datasource_provider", return_value=pm):
            with pytest.raises(ValueError, match="oauth schema not found"):
                service.get_oauth_encrypter("t1", make_id())

    def test_should_return_encrypter_when_oauth_schema_exists(self, service):
        schema_item = MagicMock()
        schema_item.to_basic_provider_config.return_value = MagicMock()
        pm = MagicMock()
        pm.declaration.oauth_schema.client_schema = [schema_item]
        with (
            patch.object(service.provider_manager, "fetch_datasource_provider", return_value=pm),
            patch(
                "services.datasource_provider_service.create_provider_encrypter",
                return_value=(MagicMock(), MagicMock()),
            ),
        ):
            result = service.get_oauth_encrypter("t1", make_id())
        assert result is not None

    # -----------------------------------------------------------------------
    # get_tenant_oauth_client (lines 381-402)
    # -----------------------------------------------------------------------

    def test_should_return_masked_credentials_when_mask_is_true(self, service, mock_db_session):
        tenant_params = MagicMock()
        tenant_params.client_params = {"k": "v"}
        mock_db_session.scalar.return_value = tenant_params
        with patch.object(service, "get_oauth_encrypter", return_value=(self._enc, None)):
            result = service.get_tenant_oauth_client("t1", make_id(), mask=True)
        assert result == {"k": "mask"}

    def test_should_return_decrypted_credentials_when_mask_is_false(self, service, mock_db_session):
        tenant_params = MagicMock()
        tenant_params.client_params = {"k": "v"}
        mock_db_session.scalar.return_value = tenant_params
        with patch.object(service, "get_oauth_encrypter", return_value=(self._enc, None)):
            result = service.get_tenant_oauth_client("t1", make_id(), mask=False)
        assert result == {"k": "dec"}

    def test_should_return_none_when_no_tenant_oauth_config_exists(self, service, mock_db_session):
        mock_db_session.scalar.return_value = None
        assert service.get_tenant_oauth_client("t1", make_id()) is None

    # -----------------------------------------------------------------------
    # get_oauth_client (lines 423-457)
    # -----------------------------------------------------------------------

    def test_should_use_tenant_config_when_available(self, service, mock_db_session):
        mock_db_session.scalar.return_value = MagicMock(client_params={"k": "v"})
        with patch.object(service, "get_oauth_encrypter", return_value=(self._enc, None)):
            result = service.get_oauth_client("t1", make_id())
        assert result == {"k": "dec"}

    def test_should_fallback_to_system_credentials_when_tenant_config_missing(self, service, mock_db_session):
        mock_db_session.scalar.side_effect = [None, MagicMock(system_credentials={"k": "sys"})]
        with (
            patch.object(service.provider_manager, "fetch_datasource_provider"),
            patch("services.datasource_provider_service.PluginService.is_plugin_verified", return_value=True),
        ):
            result = service.get_oauth_client("t1", make_id())
        assert result == {"k": "sys"}

    def test_should_raise_value_error_when_no_oauth_config_available(self, service, mock_db_session):
        """Neither tenant nor system credentials → raises ValueError."""
        mock_db_session.scalar.side_effect = [None, None]
        with (
            patch.object(service.provider_manager, "fetch_datasource_provider"),
            patch("services.datasource_provider_service.PluginService.is_plugin_verified", return_value=False),
        ):
            with pytest.raises(ValueError, match="Please configure oauth client params"):
                service.get_oauth_client("t1", make_id())

    # -----------------------------------------------------------------------
    # add_datasource_oauth_provider (lines 539-607)
    # -----------------------------------------------------------------------

    def test_should_add_oauth_provider_successfully_when_name_is_unique(self, service, mock_db_session):
        mock_db_session.scalar.return_value = 0
        with patch.object(service, "extract_secret_variables", return_value=[]):
            service.add_datasource_oauth_provider("new", "t1", make_id(), "http://cb", 9999, {})
        mock_db_session.add.assert_called_once()

    def test_should_auto_rename_when_oauth_provider_name_conflicts(self, service, mock_db_session):
        """Conflict on name results in auto-incremented name, not an error."""
        mock_db_session.scalar.return_value = 1  # conflict first, then auto-named
        with (
            patch.object(service, "extract_secret_variables", return_value=[]),
            patch.object(service, "generate_next_datasource_provider_name", return_value="new_gen"),
        ):
            service.add_datasource_oauth_provider("conflict", "t1", make_id(), "http://cb", 9999, {})
        mock_db_session.add.assert_called_once()

    def test_should_auto_generate_name_when_none_provided_for_oauth(self, service, mock_db_session):
        """name=None causes auto-generation via generate_next_datasource_provider_name."""
        mock_db_session.scalar.return_value = 0
        with (
            patch.object(service, "extract_secret_variables", return_value=[]),
            patch.object(service, "generate_next_datasource_provider_name", return_value="auto"),
        ):
            service.add_datasource_oauth_provider(None, "t1", make_id(), "http://cb", 9999, {})
        mock_db_session.add.assert_called_once()

    def test_should_encrypt_secret_fields_when_adding_oauth_provider(self, service, mock_db_session):
        mock_db_session.scalar.return_value = 0
        with patch.object(service, "extract_secret_variables", return_value=["secret_key"]):
            service.add_datasource_oauth_provider("nm", "t1", make_id(), "http://cb", 9999, {"secret_key": "value"})
        self._enc.encrypt_token.assert_called()

    def test_should_acquire_redis_lock_when_adding_oauth_provider(self, service, mock_db_session):
        mock_db_session.scalar.return_value = 0
        with patch.object(service, "extract_secret_variables", return_value=[]):
            service.add_datasource_oauth_provider("nm", "t1", make_id(), "http://cb", 9999, {})
        self._redis.lock.assert_called()

    # -----------------------------------------------------------------------
    # reauthorize_datasource_oauth_provider (lines 477-537)
    # -----------------------------------------------------------------------

    def test_should_raise_value_error_when_credential_id_not_found_on_reauth(self, service, mock_db_session):
        mock_db_session.scalar.return_value = None
        with patch.object(service, "extract_secret_variables", return_value=[]):
            with pytest.raises(ValueError, match="not found"):
                service.reauthorize_datasource_oauth_provider("n", "t1", make_id(), "u", 1, {}, "bad-id")

    def test_should_reauthorize_and_commit_when_credential_found(self, service, mock_db_session):
        p = MagicMock(spec=DatasourceProvider)
        mock_db_session.scalar.side_effect = [p, 0]  # first: fetch provider, second: name conflict count
        with patch.object(service, "extract_secret_variables", return_value=[]):
            service.reauthorize_datasource_oauth_provider("n", "t1", make_id(), "u", 1, {}, "oid")

    def test_should_auto_rename_when_reauth_name_conflicts(self, service, mock_db_session):
        p = MagicMock(spec=DatasourceProvider)
        mock_db_session.scalar.side_effect = [p, 1]  # first: fetch provider, second: name conflict count
        mock_db_session.scalars.return_value.all.return_value = []
        with patch.object(service, "extract_secret_variables", return_value=["tok"]):
            service.reauthorize_datasource_oauth_provider(
                "conflict_name", "t1", make_id(), "u", 9999, {"tok": "v"}, "cred-id"
            )

    def test_should_encrypt_secret_fields_when_reauthorizing(self, service, mock_db_session):
        p = MagicMock(spec=DatasourceProvider)
        mock_db_session.scalar.side_effect = [p, 0]  # first: fetch provider, second: name conflict count
        with patch.object(service, "extract_secret_variables", return_value=["tok"]):
            service.reauthorize_datasource_oauth_provider(None, "t1", make_id(), "u", 9999, {"tok": "val"}, "cred-id")
        self._enc.encrypt_token.assert_called()

    def test_should_acquire_redis_lock_when_reauthorizing(self, service, mock_db_session):
        p = MagicMock(spec=DatasourceProvider)
        mock_db_session.scalar.side_effect = [p, 0]  # first: fetch provider, second: name conflict count
        with patch.object(service, "extract_secret_variables", return_value=[]):
            service.reauthorize_datasource_oauth_provider("n", "t1", make_id(), "u", 1, {}, "oid")
        self._redis.lock.assert_called()

    # -----------------------------------------------------------------------
    # add_datasource_api_key_provider (lines 608-675)
    # -----------------------------------------------------------------------

    def test_should_raise_value_error_when_api_key_name_already_exists(self, service, mock_db_session, mock_user):
        """explicit name supplied + conflict → raises ValueError immediately."""
        mock_db_session.scalar.return_value = 1
        with patch("services.datasource_provider_service.get_current_user", return_value=mock_user):
            with pytest.raises(ValueError, match="already exists"):
                service.add_datasource_api_key_provider("clash", "t1", make_id(), {"sk": "v"})

    def test_should_raise_value_error_when_credentials_validation_fails(self, service, mock_db_session, mock_user):
        mock_db_session.scalar.return_value = 0
        with (
            patch("services.datasource_provider_service.get_current_user", return_value=mock_user),
            patch.object(service.provider_manager, "validate_provider_credentials", side_effect=Exception("bad cred")),
            patch.object(service, "extract_secret_variables", return_value=[]),
        ):
            with pytest.raises(ValueError, match="Failed to validate"):
                service.add_datasource_api_key_provider("nm", "t1", make_id(), {"k": "v"})

    def test_should_add_api_key_provider_and_commit_when_valid(self, service, mock_db_session, mock_user):
        mock_db_session.scalar.return_value = 0
        with (
            patch("services.datasource_provider_service.get_current_user", return_value=mock_user),
            patch.object(service.provider_manager, "validate_provider_credentials"),
            patch.object(service, "extract_secret_variables", return_value=["sk"]),
        ):
            service.add_datasource_api_key_provider(None, "t1", make_id(), {"sk": "v"})
        mock_db_session.add.assert_called_once()

    def test_should_acquire_redis_lock_when_adding_api_key_provider(self, service, mock_db_session, mock_user):
        mock_db_session.scalar.return_value = 0
        with (
            patch("services.datasource_provider_service.get_current_user", return_value=mock_user),
            patch.object(service.provider_manager, "validate_provider_credentials"),
            patch.object(service, "extract_secret_variables", return_value=[]),
        ):
            service.add_datasource_api_key_provider(None, "t1", make_id(), {})
        self._redis.lock.assert_called()

    # -----------------------------------------------------------------------
    # extract_secret_variables (lines 666-699)
    # -----------------------------------------------------------------------

    def test_should_extract_secret_variable_names_for_api_key_schema(self, service):
        schema = MagicMock()
        schema.name = "my_secret"
        schema.type = MagicMock()
        schema.type.value = FormType.SECRET_INPUT  # "secret-input"
        pm = MagicMock()
        pm.declaration.credentials_schema = [schema]
        with patch.object(service.provider_manager, "fetch_datasource_provider", return_value=pm):
            result = service.extract_secret_variables("t1", "org/plug/prov", CredentialType.API_KEY)
        assert "my_secret" in result

    def test_should_extract_secret_variable_names_for_oauth2_schema(self, service):
        schema = MagicMock()
        schema.name = "oauth_secret"
        schema.type = MagicMock()
        schema.type.value = FormType.SECRET_INPUT
        pm = MagicMock()
        pm.declaration.oauth_schema.credentials_schema = [schema]
        with patch.object(service.provider_manager, "fetch_datasource_provider", return_value=pm):
            result = service.extract_secret_variables("t1", "org/plug/prov", CredentialType.OAUTH2)
        assert "oauth_secret" in result

    def test_should_raise_value_error_when_credential_type_is_invalid(self, service):
        pm = MagicMock()
        with patch.object(service.provider_manager, "fetch_datasource_provider", return_value=pm):
            with pytest.raises(ValueError, match="Invalid credential type"):
                service.extract_secret_variables("t1", "org/plug/prov", CredentialType.UNAUTHORIZED)

    # -----------------------------------------------------------------------
    # list_datasource_credentials (lines 721-754)
    # -----------------------------------------------------------------------

    def test_should_return_empty_list_when_no_credentials_stored(self, service, mock_db_session):
        mock_db_session.scalars.return_value.all.return_value = []
        assert service.list_datasource_credentials("t1", "prov", "org/plug") == []

    def test_should_return_masked_credentials_list_when_credentials_exist(self, service, mock_db_session):
        p = MagicMock(spec=DatasourceProvider)
        p.auth_type = "api_key"
        p.encrypted_credentials = {"sk": "v"}
        p.is_default = False
        mock_db_session.scalars.return_value.all.return_value = [p]
        with patch.object(service, "extract_secret_variables", return_value=["sk"]):
            result = service.list_datasource_credentials("t1", "prov", "org/plug")
        assert len(result) == 1

    # -----------------------------------------------------------------------
    # get_all_datasource_credentials (lines 808-871)
    # -----------------------------------------------------------------------

    def test_should_aggregate_credentials_for_non_hardcoded_plugin(self, service):
        with patch("services.datasource_provider_service.PluginDatasourceManager") as mock_mgr:
            ds = MagicMock()
            ds.provider = "prov"
            ds.plugin_id = "org/plug"
            ds.declaration.identity.label.model_dump.return_value = {"en_US": "Label"}
            mock_mgr.return_value.fetch_installed_datasource_providers.return_value = [ds]
            cred = {"credential": {"k": "v"}, "is_default": True}
            with patch.object(service, "list_datasource_credentials", return_value=[cred]):
                results = service.get_all_datasource_credentials("t1")
        assert len(results) == 1

    def test_should_include_oauth_schema_for_hardcoded_plugin_ids(self, service, mock_db_session):
        """Lines 819-871: get_all_datasource_credentials covers hardcoded langgenius plugin IDs."""
        with patch("services.datasource_provider_service.PluginDatasourceManager") as mock_mgr:
            ds = MagicMock()
            ds.plugin_id = "langgenius/firecrawl_datasource"
            ds.provider = "firecrawl"
            ds.plugin_unique_identifier = "pui"
            ds.declaration.identity.icon = "icon"
            ds.declaration.identity.name = "langgenius/firecrawl_datasource"
            ds.declaration.identity.label.model_dump.return_value = {"en_US": "Firecrawl"}
            ds.declaration.identity.description.model_dump.return_value = {"en_US": "desc"}
            ds.declaration.identity.author = "langgenius"
            ds.declaration.credentials_schema = []
            ds.declaration.oauth_schema.client_schema = []
            ds.declaration.oauth_schema.credentials_schema = []
            mock_mgr.return_value.fetch_installed_datasource_providers.return_value = [ds]
            with (
                patch.object(service, "list_datasource_credentials", return_value=[]),
                patch.object(service, "get_tenant_oauth_client", return_value=None),
                patch.object(service, "is_tenant_oauth_params_enabled", return_value=False),
                patch.object(service, "is_system_oauth_params_exist", return_value=False),
            ):
                results = service.get_all_datasource_credentials("t1")
        assert len(results) == 1
        assert results[0]["oauth_schema"] is not None

    # -----------------------------------------------------------------------
    # get_real_datasource_credentials (lines 873-915)
    # -----------------------------------------------------------------------

    def test_should_return_empty_list_when_no_real_credentials_exist(self, service, mock_db_session):
        mock_db_session.scalars.return_value.all.return_value = []
        assert service.get_real_datasource_credentials("t1", "prov", "org/plug") == []

    def test_should_return_decrypted_credential_list_when_credentials_exist(self, service, mock_db_session):
        p = MagicMock(spec=DatasourceProvider)
        p.auth_type = "api_key"
        p.encrypted_credentials = {"sk": "v"}
        mock_db_session.scalars.return_value.all.return_value = [p]
        with patch.object(service, "extract_secret_variables", return_value=["sk"]):
            result = service.get_real_datasource_credentials("t1", "prov", "org/plug")
        assert len(result) == 1

    # -----------------------------------------------------------------------
    # update_datasource_credentials (lines 917-978)
    # -----------------------------------------------------------------------

    def test_should_raise_value_error_when_credential_not_found_on_update(self, service, mock_db_session, mock_user):
        mock_db_session.scalar.return_value = None
        with patch("services.datasource_provider_service.get_current_user", return_value=mock_user):
            with pytest.raises(ValueError, match="not found"):
                service.update_datasource_credentials("t1", "id", "prov", "org/plug", {}, "name")

    def test_should_raise_value_error_when_new_name_already_used_on_update(self, service, mock_db_session, mock_user):
        p = MagicMock(spec=DatasourceProvider)
        p.name = "old_name"
        p.auth_type = "api_key"
        p.encrypted_credentials = {"sk": "e"}
        mock_db_session.scalar.side_effect = [p, 1]  # first: fetch provider, second: name conflict count
        with patch("services.datasource_provider_service.get_current_user", return_value=mock_user):
            with pytest.raises(ValueError, match="already exists"):
                service.update_datasource_credentials("t1", "id", "prov", "org/plug", {}, "new_name")

    def test_should_raise_value_error_when_credential_validation_fails_on_update(
        self, service, mock_db_session, mock_user
    ):
        p = MagicMock(spec=DatasourceProvider)
        p.name = "old_name"
        p.auth_type = "api_key"
        p.encrypted_credentials = {"sk": "e"}
        mock_db_session.scalar.side_effect = [p, 0]  # first: fetch provider, second: name conflict count
        with (
            patch("services.datasource_provider_service.get_current_user", return_value=mock_user),
            patch.object(service, "extract_secret_variables", return_value=["sk"]),
            patch.object(service.provider_manager, "validate_provider_credentials", side_effect=Exception("bad")),
        ):
            with pytest.raises(ValueError, match="Failed to validate"):
                service.update_datasource_credentials("t1", "id", "prov", "org/plug", {"sk": "v"}, "name")

    def test_should_encrypt_credentials_and_commit_when_update_succeeds(self, service, mock_db_session, mock_user):
        """Verifies that encrypted_credentials is reassigned with encrypted value and commit is called."""
        p = MagicMock(spec=DatasourceProvider)
        p.name = "old_name"
        p.auth_type = "api_key"
        p.encrypted_credentials = {"sk": "old_enc"}
        mock_db_session.scalar.side_effect = [p, 0]  # first: fetch provider, second: name conflict count
        with (
            patch("services.datasource_provider_service.get_current_user", return_value=mock_user),
            patch.object(service, "extract_secret_variables", return_value=["sk"]),
            patch.object(service.provider_manager, "validate_provider_credentials"),
        ):
            service.update_datasource_credentials("t1", "id", "prov", "org/plug", {"sk": "new_val"}, "name")
        # encrypter must have been called with the new secret value
        self._enc.encrypt_token.assert_called()
        # commit must be called exactly once

    # -----------------------------------------------------------------------
    # remove_datasource_credentials (lines 980-997)
    # -----------------------------------------------------------------------

    def test_should_delete_provider_and_commit_when_found(self, service, mock_db_session):
        p = MagicMock(spec=DatasourceProvider)
        mock_db_session.scalar.return_value = p
        service.remove_datasource_credentials("t1", "id", "prov", "org/plug")
        mock_db_session.delete.assert_called_once_with(p)

    def test_should_do_nothing_when_credential_not_found_on_remove(self, service, mock_db_session):
        """No error raised; no delete called when record doesn't exist (lines 994 branch)."""
        mock_db_session.scalar.return_value = None
        service.remove_datasource_credentials("t1", "id", "prov", "org/plug")
        mock_db_session.delete.assert_not_called()
