from collections.abc import Iterator
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import httpx
import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from core.plugin.entities.plugin_daemon import CredentialType
from graphon.model_runtime.entities.provider_entities import FormType
from models.account import Account
from models.base import TypeBase
from models.model import EndUser
from models.oauth import DatasourceOauthParamConfig, DatasourceOauthTenantParamConfig, DatasourceProvider
from models.provider_ids import DatasourceProviderID
from services import datasource_provider_service as service_module
from services.datasource_provider_service import DatasourceProviderService, get_current_user

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_id(s: str = "org/plugin/provider") -> DatasourceProviderID:
    return DatasourceProviderID(s)


def make_provider(
    *,
    credential_id: str = "cred-id",
    tenant_id: str = "t1",
    name: str = "name",
    provider: str = "prov",
    plugin_id: str = "org/plug",
    auth_type: str = "api_key",
    encrypted_credentials: dict[str, object] | None = None,
    is_default: bool = False,
    expires_at: int = -1,
) -> DatasourceProvider:
    datasource_provider = DatasourceProvider(
        tenant_id=tenant_id,
        name=name,
        provider=provider,
        plugin_id=plugin_id,
        auth_type=auth_type,
        encrypted_credentials=encrypted_credentials or {},
        is_default=is_default,
        expires_at=expires_at,
    )
    datasource_provider.id = credential_id
    return datasource_provider


def persist(session: Session, *models: TypeBase) -> None:
    session.add_all(models)
    session.commit()


# ---------------------------------------------------------------------------
# Test class
# ---------------------------------------------------------------------------


class TestDatasourceProviderService:
    """Comprehensive tests for DatasourceProviderService targeting >95% coverage."""

    @pytest.fixture
    def service(self):
        return DatasourceProviderService()

    @pytest.fixture
    def sqlite_session(self, sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> Iterator[Session]:
        """Provide the service with an isolated SQLite-backed session and engine."""
        tables = [
            TypeBase.metadata.tables[model.__tablename__]
            for model in (DatasourceOauthParamConfig, DatasourceOauthTenantParamConfig, DatasourceProvider)
        ]
        TypeBase.metadata.create_all(sqlite_engine, tables=tables)
        session_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
        with session_factory() as session:
            monkeypatch.setattr(service_module, "db", SimpleNamespace(engine=sqlite_engine, session=session))
            yield session

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

    def test_should_return_true_when_system_oauth_params_exist(self, service, sqlite_session):
        persist(
            sqlite_session,
            DatasourceOauthParamConfig(
                plugin_id="org/plugin",
                provider="provider",
                system_credentials={"client_id": "configured"},
            ),
        )
        assert service.is_system_oauth_params_exist(make_id()) is True

    def test_should_return_false_when_system_oauth_params_missing(self, service, sqlite_session):
        assert service.is_system_oauth_params_exist(make_id()) is False

    # -----------------------------------------------------------------------
    # is_tenant_oauth_params_enabled (lines 365-379)
    # NOTE: uses .count() not .first()
    # -----------------------------------------------------------------------

    def test_should_return_true_when_tenant_oauth_params_enabled(self, service, sqlite_session):
        persist(
            sqlite_session,
            DatasourceOauthTenantParamConfig(
                tenant_id="t1",
                plugin_id="org/plugin",
                provider="provider",
                enabled=True,
            ),
        )
        assert service.is_tenant_oauth_params_enabled("t1", make_id(), session=sqlite_session) is True

    def test_should_return_false_when_tenant_oauth_params_disabled(self, service, sqlite_session):
        persist(
            sqlite_session,
            DatasourceOauthTenantParamConfig(
                tenant_id="t1",
                plugin_id="org/plugin",
                provider="provider",
                enabled=False,
            ),
        )
        assert service.is_tenant_oauth_params_enabled("t1", make_id(), session=sqlite_session) is False

    # -----------------------------------------------------------------------
    # remove_oauth_custom_client_params (lines 55-61)
    # -----------------------------------------------------------------------

    def test_should_delete_tenant_config_when_removing_oauth_params(self, service, sqlite_session):
        config = DatasourceOauthTenantParamConfig(
            tenant_id="t1",
            plugin_id="org/plugin",
            provider="provider",
            enabled=True,
        )
        persist(sqlite_session, config)
        config_id = config.id
        service.remove_oauth_custom_client_params("t1", make_id())
        sqlite_session.expire_all()
        assert sqlite_session.get(DatasourceOauthTenantParamConfig, config_id) is None

    # -----------------------------------------------------------------------
    # setup_oauth_custom_client_params (315-351)
    # -----------------------------------------------------------------------

    def test_should_skip_db_write_when_credentials_are_none(self, service, sqlite_session):
        """When credentials=None, should return immediately without any DB write."""
        service.setup_oauth_custom_client_params("t1", make_id(), None, None)
        assert sqlite_session.scalars(select(DatasourceOauthTenantParamConfig)).all() == []

    def test_should_create_new_config_when_none_exists(self, service, sqlite_session):
        with patch.object(service, "get_oauth_encrypter", return_value=(self._enc, None)):
            service.setup_oauth_custom_client_params("t1", make_id(), {"k": "v"}, True)
        sqlite_session.expire_all()
        config = sqlite_session.scalar(select(DatasourceOauthTenantParamConfig))
        assert config is not None
        assert config.tenant_id == "t1"
        assert config.enabled is True
        assert config.client_params == {"k": "enc"}

    def test_should_update_existing_config_when_record_found(self, service, sqlite_session):
        existing = DatasourceOauthTenantParamConfig(
            tenant_id="t1",
            plugin_id="org/plugin",
            provider="provider",
            client_params={"k": "old"},
            enabled=True,
        )
        persist(sqlite_session, existing)
        with patch.object(service, "get_oauth_encrypter", return_value=(self._enc, None)):
            service.setup_oauth_custom_client_params("t1", make_id(), {"k": "v"}, False)
        sqlite_session.refresh(existing)
        assert existing.client_params == {"k": "enc"}
        assert existing.enabled is False

    # -----------------------------------------------------------------------
    # decrypt / encrypt credentials (lines 70-98)
    # -----------------------------------------------------------------------

    def test_should_decrypt_secret_fields_when_decrypting_api_key_credentials(self, service, sqlite_session):
        p = make_provider(encrypted_credentials={"sk": "enc_val"})
        with patch.object(service, "extract_secret_variables", return_value=["sk"]):
            result = service.decrypt_datasource_provider_credentials("t1", p, "org/plug", "prov")
        assert result["sk"] == "dec_tok"

    def test_should_encrypt_secret_fields_when_encrypting_api_key_credentials(self, service, sqlite_session):
        p = make_provider()
        with patch.object(service, "extract_secret_variables", return_value=["sk"]):
            result = service.encrypt_datasource_provider_credentials("t1", "prov", "org/plug", {"sk": "plain"}, p)
        assert result["sk"] == "enc_tok"
        self._enc.encrypt_token.assert_called()

    # -----------------------------------------------------------------------
    # get_datasource_credentials (lines 113-165)
    # -----------------------------------------------------------------------

    def test_should_return_empty_dict_when_credential_not_found(self, service, sqlite_session, mock_user):
        with patch("services.datasource_provider_service.get_current_user", return_value=mock_user):
            assert service.get_datasource_credentials("t1", "prov", "org/plug") == {}

    def test_should_refresh_oauth_tokens_when_expired(self, service, sqlite_session, mock_user):
        """Expired OAuth credential (expires_at near zero) triggers a refresh."""
        p = make_provider(auth_type="oauth2", expires_at=0, encrypted_credentials={"tok": "x"})
        persist(sqlite_session, p)
        with (
            patch("services.datasource_provider_service.get_current_user", return_value=mock_user),
            patch.object(service, "get_oauth_client", return_value={"oc": "v"}),
            patch.object(service, "decrypt_datasource_provider_credentials", return_value={"tok": "plain"}),
        ):
            service.get_datasource_credentials("t1", "prov", "org/plug")
        sqlite_session.expire_all()
        assert sqlite_session.get(DatasourceProvider, p.id).expires_at == 9999

    def test_should_include_provider_name_when_refresh_fails(self, service, sqlite_session, mock_user):
        p = make_provider(
            name="Credential",
            auth_type="oauth2",
            expires_at=0,
            encrypted_credentials={"tok": "x"},
        )
        persist(sqlite_session, p)
        with (
            patch("services.datasource_provider_service.get_current_user", return_value=mock_user),
            patch("services.datasource_provider_service.OAuthHandler") as oauth_handler,
            patch.object(service, "get_oauth_client", return_value={"oc": "v"}),
            patch.object(service, "decrypt_datasource_provider_credentials", return_value={"tok": "plain"}),
        ):
            oauth_handler.return_value.refresh_credentials.side_effect = RuntimeError("token endpoint failed")
            with pytest.raises(ValueError, match="provider prov"):
                service.get_datasource_credentials("t1", "prov", "org/plug")

    def test_should_return_decrypted_credentials_when_api_key_not_expired(self, service, sqlite_session, mock_user):
        """API key credentials with expires_at=-1 skip refresh and return directly."""
        p = make_provider(encrypted_credentials={"k": "v"})
        persist(sqlite_session, p)
        with (
            patch("services.datasource_provider_service.get_current_user", return_value=mock_user),
            patch.object(service, "decrypt_datasource_provider_credentials", return_value={"k": "plain"}),
        ):
            result = service.get_datasource_credentials("t1", "prov", "org/plug")
        assert result == {"k": "plain"}

    def test_should_fetch_by_credential_id_when_provided(self, service, sqlite_session, mock_user):
        """When credential_id is passed, the credential_id filter path (line 113) is taken."""
        p = make_provider(credential_id="cred-id", provider="other-provider", plugin_id="other-plugin")
        persist(sqlite_session, p)
        with (
            patch("services.datasource_provider_service.get_current_user", return_value=mock_user),
            patch.object(service, "decrypt_datasource_provider_credentials", return_value={"k": "v"}),
        ):
            result = service.get_datasource_credentials("t1", "prov", "org/plug", credential_id="cred-id")
        assert result == {"k": "v"}

    # -----------------------------------------------------------------------
    # get_all_datasource_credentials_by_provider (lines 176-228)
    # -----------------------------------------------------------------------

    def test_should_return_empty_list_when_no_provider_credentials_exist(self, service, sqlite_session, mock_user):
        with patch("services.datasource_provider_service.get_current_user", return_value=mock_user):
            assert service.get_all_datasource_credentials_by_provider("t1", "prov", "org/plug") == []

    def test_should_refresh_and_return_credentials_when_oauth_expired(self, service, sqlite_session, mock_user):
        p = make_provider(auth_type="oauth2", expires_at=0, encrypted_credentials={"t": "x"})
        persist(sqlite_session, p)
        with (
            patch("services.datasource_provider_service.get_current_user", return_value=mock_user),
            patch.object(service, "get_oauth_client", return_value={"oc": "v"}),
            patch.object(service, "decrypt_datasource_provider_credentials", return_value={"t": "plain"}),
        ):
            result = service.get_all_datasource_credentials_by_provider("t1", "prov", "org/plug")
        assert len(result) == 1

    def test_should_skip_failed_provider_when_refreshing_all_credentials(
        self, service, sqlite_session, mock_user, caplog
    ):
        failed_provider = make_provider(
            credential_id="failed-cred",
            name="Failed",
            auth_type="oauth2",
            expires_at=0,
        )
        working_provider = make_provider(
            credential_id="working-cred",
            name="Working",
            auth_type="oauth2",
            expires_at=0,
        )
        persist(sqlite_session, failed_provider, working_provider)
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
        self, service, sqlite_session, mock_user
    ):
        p = make_provider(auth_type="oauth2", encrypted_credentials={"t": "x"})
        persist(sqlite_session, p)
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

    def test_should_raise_value_error_when_provider_not_found_on_name_update(self, service, sqlite_session):
        with pytest.raises(ValueError, match="not found"):
            service.update_datasource_provider_name("t1", make_id(), "new", "cred-id")

    def test_should_return_early_when_new_name_matches_current(self, service, sqlite_session):
        p = make_provider(
            credential_id="cred-id",
            name="same",
            provider="provider",
            plugin_id="org/plugin",
        )
        persist(sqlite_session, p)
        service.update_datasource_provider_name("t1", make_id(), "same", "cred-id")
        sqlite_session.expire_all()
        assert sqlite_session.get(DatasourceProvider, p.id).name == "same"

    def test_should_raise_value_error_when_name_already_exists(self, service, sqlite_session):
        p = make_provider(
            credential_id="some-id",
            name="old_name",
            provider="provider",
            plugin_id="org/plugin",
        )
        conflict = make_provider(
            credential_id="conflict-id",
            name="new_name",
            provider="provider",
            plugin_id="org/plugin",
        )
        persist(sqlite_session, p, conflict)
        with pytest.raises(ValueError, match="already exists"):
            service.update_datasource_provider_name("t1", make_id(), "new_name", "some-id")

    def test_should_update_name_and_commit_when_no_conflict(self, service, sqlite_session):
        p = make_provider(
            credential_id="some-id",
            name="old_name",
            provider="provider",
            plugin_id="org/plugin",
        )
        persist(sqlite_session, p)
        service.update_datasource_provider_name("t1", make_id(), "new_name", "some-id")
        sqlite_session.expire_all()
        assert sqlite_session.get(DatasourceProvider, p.id).name == "new_name"

    # -----------------------------------------------------------------------
    # set_default_datasource_provider (lines 277-303)
    # -----------------------------------------------------------------------

    def test_should_raise_value_error_when_target_provider_not_found(self, service, sqlite_session):
        with pytest.raises(ValueError, match="not found"):
            service.set_default_datasource_provider("t1", make_id(), "bad-id")

    def test_should_mark_target_as_default_and_commit(self, service, sqlite_session):
        current_default = make_provider(
            credential_id="old-id",
            name="old",
            provider="provider",
            plugin_id="org/plugin",
            is_default=True,
        )
        target = make_provider(
            credential_id="new-id",
            name="new",
            provider="provider",
            plugin_id="org/plugin",
        )
        persist(sqlite_session, current_default, target)
        service.set_default_datasource_provider("t1", make_id(), "new-id")
        sqlite_session.expire_all()
        assert sqlite_session.get(DatasourceProvider, current_default.id).is_default is False
        assert sqlite_session.get(DatasourceProvider, target.id).is_default is True

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

    def test_should_return_masked_credentials_when_mask_is_true(self, service, sqlite_session):
        tenant_params = DatasourceOauthTenantParamConfig(
            tenant_id="t1",
            plugin_id="org/plugin",
            provider="provider",
            client_params={"k": "v"},
        )
        persist(sqlite_session, tenant_params)
        with patch.object(service, "get_oauth_encrypter", return_value=(self._enc, None)):
            result = service.get_tenant_oauth_client("t1", make_id(), mask=True, session=sqlite_session)
        assert result == {"k": "mask"}

    def test_should_return_decrypted_credentials_when_mask_is_false(self, service, sqlite_session):
        tenant_params = DatasourceOauthTenantParamConfig(
            tenant_id="t1",
            plugin_id="org/plugin",
            provider="provider",
            client_params={"k": "v"},
        )
        persist(sqlite_session, tenant_params)
        with patch.object(service, "get_oauth_encrypter", return_value=(self._enc, None)):
            result = service.get_tenant_oauth_client("t1", make_id(), mask=False, session=sqlite_session)
        assert result == {"k": "dec"}

    def test_should_return_none_when_no_tenant_oauth_config_exists(self, service, sqlite_session):
        assert service.get_tenant_oauth_client("t1", make_id(), session=sqlite_session) is None

    # -----------------------------------------------------------------------
    # get_oauth_client (lines 423-457)
    # -----------------------------------------------------------------------

    def test_should_use_tenant_config_when_available(self, service, sqlite_session):
        persist(
            sqlite_session,
            DatasourceOauthTenantParamConfig(
                tenant_id="t1",
                plugin_id="org/plugin",
                provider="provider",
                client_params={"k": "v"},
                enabled=True,
            ),
        )
        with patch.object(service, "get_oauth_encrypter", return_value=(self._enc, None)):
            result = service.get_oauth_client("t1", make_id())
        assert result == {"k": "dec"}

    def test_should_fallback_to_system_credentials_when_tenant_config_missing(self, service, sqlite_session):
        persist(
            sqlite_session,
            DatasourceOauthParamConfig(
                plugin_id="org/plugin",
                provider="provider",
                system_credentials={"k": "sys"},
            ),
        )
        with (
            patch.object(service.provider_manager, "fetch_datasource_provider"),
            patch("services.datasource_provider_service.PluginService.is_plugin_verified", return_value=True),
        ):
            result = service.get_oauth_client("t1", make_id())
        assert result == {"k": "sys"}

    def test_should_raise_value_error_when_no_oauth_config_available(self, service, sqlite_session):
        """Neither tenant nor system credentials → raises ValueError."""
        with (
            patch.object(service.provider_manager, "fetch_datasource_provider"),
            patch("services.datasource_provider_service.PluginService.is_plugin_verified", return_value=False),
        ):
            with pytest.raises(ValueError, match="Please configure oauth client params"):
                service.get_oauth_client("t1", make_id())

    # -----------------------------------------------------------------------
    # add_datasource_oauth_provider (lines 539-607)
    # -----------------------------------------------------------------------

    def test_should_add_oauth_provider_successfully_when_name_is_unique(self, service, sqlite_session):
        with patch.object(service, "extract_secret_variables", return_value=[]):
            service.add_datasource_oauth_provider("new", "t1", make_id(), "http://cb", 9999, {})
        sqlite_session.expire_all()
        provider = sqlite_session.scalar(select(DatasourceProvider))
        assert provider is not None
        assert provider.name == "new"
        assert provider.auth_type == CredentialType.OAUTH2.value

    def test_should_auto_rename_when_oauth_provider_name_conflicts(self, service, sqlite_session):
        """Conflict on name results in auto-incremented name, not an error."""
        persist(
            sqlite_session,
            make_provider(
                name="conflict",
                provider="provider",
                plugin_id="org/plugin",
                auth_type=CredentialType.OAUTH2.value,
            ),
        )
        with (
            patch.object(service, "extract_secret_variables", return_value=[]),
        ):
            service.add_datasource_oauth_provider("conflict", "t1", make_id(), "http://cb", 9999, {})
        sqlite_session.expire_all()
        names = set(sqlite_session.scalars(select(DatasourceProvider.name)).all())
        assert names == {"conflict", "gen_name"}

    def test_should_auto_generate_name_when_none_provided_for_oauth(self, service, sqlite_session):
        """name=None causes auto-generation via generate_next_datasource_provider_name."""
        with (
            patch.object(service, "extract_secret_variables", return_value=[]),
            patch.object(service, "generate_next_datasource_provider_name", return_value="auto"),
        ):
            service.add_datasource_oauth_provider(None, "t1", make_id(), "http://cb", 9999, {})
        sqlite_session.expire_all()
        assert sqlite_session.scalar(select(DatasourceProvider.name)) == "auto"

    def test_should_encrypt_secret_fields_when_adding_oauth_provider(self, service, sqlite_session):
        with patch.object(service, "extract_secret_variables", return_value=["secret_key"]):
            service.add_datasource_oauth_provider("nm", "t1", make_id(), "http://cb", 9999, {"secret_key": "value"})
        self._enc.encrypt_token.assert_called()
        sqlite_session.expire_all()
        provider = sqlite_session.scalar(select(DatasourceProvider))
        assert provider.encrypted_credentials == {"secret_key": "enc_tok"}

    def test_should_acquire_redis_lock_when_adding_oauth_provider(self, service, sqlite_session):
        with patch.object(service, "extract_secret_variables", return_value=[]):
            service.add_datasource_oauth_provider("nm", "t1", make_id(), "http://cb", 9999, {})
        self._redis.lock.assert_called()

    # -----------------------------------------------------------------------
    # reauthorize_datasource_oauth_provider (lines 477-537)
    # -----------------------------------------------------------------------

    def test_should_raise_value_error_when_credential_id_not_found_on_reauth(self, service, sqlite_session):
        with patch.object(service, "extract_secret_variables", return_value=[]):
            with pytest.raises(ValueError, match="not found"):
                service.reauthorize_datasource_oauth_provider("n", "t1", make_id(), "u", 1, {}, "bad-id")

    def test_should_reauthorize_and_commit_when_credential_found(self, service, sqlite_session):
        p = make_provider(
            credential_id="oid",
            provider="provider",
            plugin_id="org/plugin",
            auth_type=CredentialType.OAUTH2.value,
        )
        persist(sqlite_session, p)
        with patch.object(service, "extract_secret_variables", return_value=[]):
            service.reauthorize_datasource_oauth_provider("n", "t1", make_id(), "u", 1, {}, "oid")
        sqlite_session.expire_all()
        updated = sqlite_session.get(DatasourceProvider, p.id)
        assert updated.expires_at == 1
        assert updated.avatar_url == "u"

    def test_should_auto_rename_when_reauth_name_conflicts(self, service, sqlite_session):
        p = make_provider(
            credential_id="cred-id",
            name="original",
            provider="provider",
            plugin_id="org/plugin",
            auth_type=CredentialType.OAUTH2.value,
        )
        conflict = make_provider(
            credential_id="conflict-id",
            name="conflict_name",
            provider="provider",
            plugin_id="org/plugin",
            auth_type=CredentialType.OAUTH2.value,
        )
        persist(sqlite_session, p, conflict)
        with patch.object(service, "extract_secret_variables", return_value=["tok"]):
            service.reauthorize_datasource_oauth_provider(
                "conflict_name", "t1", make_id(), "u", 9999, {"tok": "v"}, "cred-id"
            )
        sqlite_session.expire_all()
        assert sqlite_session.get(DatasourceProvider, p.id).encrypted_credentials == {"tok": "enc_tok"}

    def test_should_encrypt_secret_fields_when_reauthorizing(self, service, sqlite_session):
        p = make_provider(
            credential_id="cred-id",
            provider="provider",
            plugin_id="org/plugin",
            auth_type=CredentialType.OAUTH2.value,
        )
        persist(sqlite_session, p)
        with patch.object(service, "extract_secret_variables", return_value=["tok"]):
            service.reauthorize_datasource_oauth_provider(None, "t1", make_id(), "u", 9999, {"tok": "val"}, "cred-id")
        self._enc.encrypt_token.assert_called()
        sqlite_session.expire_all()
        assert sqlite_session.get(DatasourceProvider, p.id).encrypted_credentials == {"tok": "enc_tok"}

    def test_should_acquire_redis_lock_when_reauthorizing(self, service, sqlite_session):
        p = make_provider(
            credential_id="oid",
            provider="provider",
            plugin_id="org/plugin",
            auth_type=CredentialType.OAUTH2.value,
        )
        persist(sqlite_session, p)
        with patch.object(service, "extract_secret_variables", return_value=[]):
            service.reauthorize_datasource_oauth_provider("n", "t1", make_id(), "u", 1, {}, "oid")
        self._redis.lock.assert_called()

    # -----------------------------------------------------------------------
    # add_datasource_api_key_provider (lines 608-675)
    # -----------------------------------------------------------------------

    def test_should_raise_value_error_when_api_key_name_already_exists(self, service, sqlite_session, mock_user):
        """explicit name supplied + conflict → raises ValueError immediately."""
        persist(
            sqlite_session,
            make_provider(name="clash", provider="provider", plugin_id="org/plugin"),
        )
        with patch("services.datasource_provider_service.get_current_user", return_value=mock_user):
            with pytest.raises(ValueError, match="already exists"):
                service.add_datasource_api_key_provider("clash", "t1", make_id(), {"sk": "v"})

    def test_should_raise_value_error_when_credentials_validation_fails(self, service, sqlite_session, mock_user):
        with (
            patch("services.datasource_provider_service.get_current_user", return_value=mock_user),
            patch.object(service.provider_manager, "validate_provider_credentials", side_effect=Exception("bad cred")),
            patch.object(service, "extract_secret_variables", return_value=[]),
        ):
            with pytest.raises(ValueError, match="Failed to validate"):
                service.add_datasource_api_key_provider("nm", "t1", make_id(), {"k": "v"})

    def test_should_add_api_key_provider_and_commit_when_valid(self, service, sqlite_session, mock_user):
        with (
            patch("services.datasource_provider_service.get_current_user", return_value=mock_user),
            patch.object(service.provider_manager, "validate_provider_credentials"),
            patch.object(service, "extract_secret_variables", return_value=["sk"]),
        ):
            service.add_datasource_api_key_provider(None, "t1", make_id(), {"sk": "v"})
        sqlite_session.expire_all()
        provider = sqlite_session.scalar(select(DatasourceProvider))
        assert provider is not None
        assert provider.encrypted_credentials == {"sk": "enc_tok"}

    def test_should_acquire_redis_lock_when_adding_api_key_provider(self, service, sqlite_session, mock_user):
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

    def test_should_return_empty_list_when_no_credentials_stored(self, service, sqlite_session):
        assert service.list_datasource_credentials("t1", "prov", "org/plug", session=sqlite_session) == []

    def test_should_return_masked_credentials_list_when_credentials_exist(self, service, sqlite_session):
        p = make_provider(encrypted_credentials={"sk": "v"})
        persist(sqlite_session, p)
        with patch.object(service, "extract_secret_variables", return_value=["sk"]):
            result = service.list_datasource_credentials("t1", "prov", "org/plug", session=sqlite_session)
        assert len(result) == 1
        assert result[0]["credential"] == {"sk": "obf"}

    # -----------------------------------------------------------------------
    # get_all_datasource_credentials (lines 808-871)
    # -----------------------------------------------------------------------

    def test_should_aggregate_credentials_for_non_hardcoded_plugin(self, service, sqlite_session):
        with patch("services.datasource_provider_service.PluginDatasourceManager") as mock_mgr:
            ds = MagicMock()
            ds.provider = "prov"
            ds.plugin_id = "org/plug"
            ds.declaration.identity.label.model_dump.return_value = {"en_US": "Label"}
            mock_mgr.return_value.fetch_installed_datasource_providers.return_value = [ds]
            cred = {"credential": {"k": "v"}, "is_default": True}
            with patch.object(service, "list_datasource_credentials", return_value=[cred]):
                results = service.get_all_datasource_credentials("t1", session=sqlite_session)
        assert len(results) == 1

    def test_should_include_oauth_schema_for_hardcoded_plugin_ids(self, service, sqlite_session):
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
                results = service.get_all_datasource_credentials("t1", session=sqlite_session)
        assert len(results) == 1
        assert results[0]["oauth_schema"] is not None

    # -----------------------------------------------------------------------
    # get_real_datasource_credentials (lines 873-915)
    # -----------------------------------------------------------------------

    def test_should_return_empty_list_when_no_real_credentials_exist(self, service, sqlite_session):
        assert service.get_real_datasource_credentials("t1", "prov", "org/plug", session=sqlite_session) == []

    def test_should_return_decrypted_credential_list_when_credentials_exist(self, service, sqlite_session):
        p = make_provider(encrypted_credentials={"sk": "v"})
        persist(sqlite_session, p)
        with patch.object(service, "extract_secret_variables", return_value=["sk"]):
            result = service.get_real_datasource_credentials("t1", "prov", "org/plug", session=sqlite_session)
        assert len(result) == 1
        assert result[0]["credentials"] == {"sk": "dec_tok"}

    # -----------------------------------------------------------------------
    # update_datasource_credentials (lines 917-978)
    # -----------------------------------------------------------------------

    def test_should_raise_value_error_when_credential_not_found_on_update(self, service, sqlite_session, mock_user):
        with patch("services.datasource_provider_service.get_current_user", return_value=mock_user):
            with pytest.raises(ValueError, match="not found"):
                service.update_datasource_credentials("t1", "id", "prov", "org/plug", {}, "name")

    def test_should_raise_value_error_when_new_name_already_used_on_update(self, service, sqlite_session, mock_user):
        p = make_provider(credential_id="id", name="old_name", encrypted_credentials={"sk": "e"})
        conflict = make_provider(credential_id="conflict-id", name="new_name")
        persist(sqlite_session, p, conflict)
        with patch("services.datasource_provider_service.get_current_user", return_value=mock_user):
            with pytest.raises(ValueError, match="already exists"):
                service.update_datasource_credentials("t1", "id", "prov", "org/plug", {}, "new_name")

    def test_should_raise_value_error_when_credential_validation_fails_on_update(
        self, service, sqlite_session, mock_user
    ):
        p = make_provider(credential_id="id", name="old_name", encrypted_credentials={"sk": "e"})
        persist(sqlite_session, p)
        with (
            patch("services.datasource_provider_service.get_current_user", return_value=mock_user),
            patch.object(service, "extract_secret_variables", return_value=["sk"]),
            patch.object(service.provider_manager, "validate_provider_credentials", side_effect=Exception("bad")),
        ):
            with pytest.raises(ValueError, match="Failed to validate"):
                service.update_datasource_credentials("t1", "id", "prov", "org/plug", {"sk": "v"}, "name")

    def test_should_encrypt_credentials_and_commit_when_update_succeeds(self, service, sqlite_session, mock_user):
        """Verifies that encrypted_credentials is reassigned with encrypted value and commit is called."""
        p = make_provider(credential_id="id", name="old_name", encrypted_credentials={"sk": "old_enc"})
        persist(sqlite_session, p)
        with (
            patch("services.datasource_provider_service.get_current_user", return_value=mock_user),
            patch.object(service, "extract_secret_variables", return_value=["sk"]),
            patch.object(service.provider_manager, "validate_provider_credentials"),
        ):
            service.update_datasource_credentials("t1", "id", "prov", "org/plug", {"sk": "new_val"}, "name")
        self._enc.encrypt_token.assert_called()
        sqlite_session.expire_all()
        updated = sqlite_session.get(DatasourceProvider, p.id)
        assert updated.name == "name"
        assert updated.encrypted_credentials == {"sk": "enc_tok"}

    # -----------------------------------------------------------------------
    # remove_datasource_credentials (lines 980-997)
    # -----------------------------------------------------------------------

    def test_should_delete_provider_and_commit_when_found(self, service, sqlite_session):
        p = make_provider(credential_id="id")
        persist(sqlite_session, p)
        service.remove_datasource_credentials("t1", "id", "prov", "org/plug", session=sqlite_session)
        assert sqlite_session.get(DatasourceProvider, p.id) is None

    def test_should_do_nothing_when_credential_not_found_on_remove(self, service, sqlite_session):
        """No error raised; no delete called when record doesn't exist (lines 994 branch)."""
        service.remove_datasource_credentials("t1", "id", "prov", "org/plug", session=sqlite_session)
        assert sqlite_session.scalars(select(DatasourceProvider)).all() == []
