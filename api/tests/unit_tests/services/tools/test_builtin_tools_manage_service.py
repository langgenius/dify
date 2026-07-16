"""Unit tests for built-in tool management and its persisted credential state."""

import json
from dataclasses import dataclass
from unittest.mock import MagicMock

import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from core.plugin.entities.plugin_daemon import CredentialType
from models.tools import BuiltinToolProvider, ToolOAuthSystemClient, ToolOAuthTenantClient
from services.tools import builtin_tools_manage_service as service_module
from services.tools.builtin_tools_manage_service import BuiltinToolManageService


@dataclass(frozen=True)
class ToolsDatabase:
    engine: Engine
    session_maker: sessionmaker[Session]


@pytest.fixture
def tools_database(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> ToolsDatabase:
    """Bind service-owned sessions to an isolated engine with only credential tables."""
    BuiltinToolProvider.metadata.create_all(
        sqlite_engine,
        tables=[
            BuiltinToolProvider.__table__,
            ToolOAuthSystemClient.__table__,
            ToolOAuthTenantClient.__table__,
        ],
    )
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    database = ToolsDatabase(engine=sqlite_engine, session_maker=session_maker)
    monkeypatch.setattr(service_module, "db", database)
    return database


def _persist_provider(
    database: ToolsDatabase,
    *,
    credential_id: str = "cred-1",
    tenant_id: str = "tenant-1",
    user_id: str = "user-1",
    provider: str = "google",
    name: str = "Google 1",
    credentials: dict[str, str] | None = None,
    is_default: bool = False,
) -> BuiltinToolProvider:
    db_provider = BuiltinToolProvider(
        tenant_id=tenant_id,
        user_id=user_id,
        provider=provider,
        name=name,
        encrypted_credentials=json.dumps(credentials or {"key": "encrypted"}),
        credential_type=CredentialType.API_KEY,
        is_default=is_default,
    )
    db_provider.id = credential_id
    with database.session_maker.begin() as session:
        session.add(db_provider)
    return db_provider


def _persist_tenant_oauth_client(
    database: ToolsDatabase,
    *,
    tenant_id: str = "tenant-1",
    plugin_id: str = "langgenius/google",
    provider: str = "google",
    enabled: bool = True,
    encrypted_params: str = '{"encrypted": "data"}',
) -> ToolOAuthTenantClient:
    client = ToolOAuthTenantClient(tenant_id=tenant_id, plugin_id=plugin_id, provider=provider)
    client.enabled = enabled
    client.encrypted_oauth_params = encrypted_params
    with database.session_maker.begin() as session:
        session.add(client)
    return client


def _persist_system_oauth_client(
    database: ToolsDatabase,
    *,
    plugin_id: str = "langgenius/google",
    provider: str = "google",
) -> ToolOAuthSystemClient:
    client = ToolOAuthSystemClient(plugin_id=plugin_id, provider=provider, encrypted_oauth_params="enc")
    with database.session_maker.begin() as session:
        session.add(client)
    return client


class TestDeleteCustomOauthClientParams:
    def test_deletes_matching_tenant_only(self, tools_database: ToolsDatabase) -> None:
        _persist_tenant_oauth_client(tools_database, tenant_id="tenant-1")
        _persist_tenant_oauth_client(tools_database, tenant_id="tenant-2")

        result = BuiltinToolManageService.delete_custom_oauth_client_params("tenant-1", "google")

        assert result == {"result": "success"}
        with tools_database.session_maker() as session:
            clients = session.scalars(select(ToolOAuthTenantClient)).all()
            assert [client.tenant_id for client in clients] == ["tenant-2"]


class TestListBuiltinToolProviderTools:
    def test_transforms_each_tool(self, monkeypatch: pytest.MonkeyPatch) -> None:
        controller = MagicMock()
        controller.get_tools.return_value = [MagicMock(), MagicMock()]
        monkeypatch.setattr(service_module.ToolManager, "get_builtin_provider", MagicMock(return_value=controller))
        convert = MagicMock(return_value=MagicMock())
        monkeypatch.setattr(service_module.ToolTransformService, "convert_tool_entity_to_api_entity", convert)
        monkeypatch.setattr(service_module.ToolLabelManager, "get_tool_labels", MagicMock(return_value=[]))

        result = BuiltinToolManageService.list_builtin_tool_provider_tools("tenant-1", "google")

        assert len(result) == 2
        assert convert.call_count == 2

    def test_empty_tools(self, monkeypatch: pytest.MonkeyPatch) -> None:
        controller = MagicMock()
        controller.get_tools.return_value = []
        monkeypatch.setattr(service_module.ToolManager, "get_builtin_provider", MagicMock(return_value=controller))

        assert BuiltinToolManageService.list_builtin_tool_provider_tools("t", "p") == []


class TestGetBuiltinToolProviderInfo:
    def test_raises_when_not_found(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(BuiltinToolManageService, "get_builtin_provider", MagicMock(return_value=None))
        monkeypatch.setattr(service_module.ToolManager, "get_builtin_provider", MagicMock(return_value=MagicMock()))

        with pytest.raises(ValueError, match="you have not added provider"):
            BuiltinToolManageService.get_builtin_tool_provider_info("t", "no")

    def test_clears_original_credentials(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(BuiltinToolManageService, "get_builtin_provider", MagicMock(return_value=MagicMock()))
        monkeypatch.setattr(service_module.ToolManager, "get_builtin_provider", MagicMock(return_value=MagicMock()))
        entity = MagicMock()
        monkeypatch.setattr(
            service_module.ToolTransformService,
            "builtin_provider_to_user_provider",
            MagicMock(return_value=entity),
        )

        result = BuiltinToolManageService.get_builtin_tool_provider_info("t", "google")

        assert result.original_credentials == {}


class TestListBuiltinProviderCredentialsSchema:
    def test_returns_schema(self, monkeypatch: pytest.MonkeyPatch) -> None:
        controller = MagicMock()
        controller.get_credentials_schema_by_type.return_value = [{"f": "k"}]
        monkeypatch.setattr(service_module.ToolManager, "get_builtin_provider", MagicMock(return_value=controller))

        result = BuiltinToolManageService.list_builtin_provider_credentials_schema("g", CredentialType.API_KEY, "t")

        assert result == [{"f": "k"}]


class TestGetBuiltinToolProviderIcon:
    def test_returns_bytes_and_mime(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            service_module.ToolManager,
            "get_hardcoded_provider_icon",
            MagicMock(return_value=("/icon.svg", "image/svg+xml")),
        )
        path = MagicMock()
        path.return_value.read_bytes.return_value = b"<svg/>"
        monkeypatch.setattr(service_module, "Path", path)

        icon, mime = BuiltinToolManageService.get_builtin_tool_provider_icon("google")

        assert icon == b"<svg/>"
        assert mime == "image/svg+xml"


class TestIsOauthSystemClientExists:
    def test_true_when_exists(self, tools_database: ToolsDatabase) -> None:
        _persist_system_oauth_client(tools_database)

        assert BuiltinToolManageService.is_oauth_system_client_exists("google") is True

    def test_false_when_missing(self, tools_database: ToolsDatabase) -> None:
        _persist_system_oauth_client(tools_database, plugin_id="langgenius/slack", provider="slack")

        assert BuiltinToolManageService.is_oauth_system_client_exists("google") is False


class TestIsOauthCustomClientEnabled:
    def test_true_when_enabled(self, tools_database: ToolsDatabase) -> None:
        _persist_tenant_oauth_client(tools_database)

        assert BuiltinToolManageService.is_oauth_custom_client_enabled("tenant-1", "google") is True

    def test_false_when_disabled_or_other_tenant(self, tools_database: ToolsDatabase) -> None:
        _persist_tenant_oauth_client(tools_database, tenant_id="tenant-1", enabled=False)
        _persist_tenant_oauth_client(tools_database, tenant_id="tenant-2", enabled=True)

        assert BuiltinToolManageService.is_oauth_custom_client_enabled("tenant-1", "google") is False


class TestDeleteBuiltinToolProvider:
    def test_raises_when_not_found(self, tools_database: ToolsDatabase) -> None:
        with pytest.raises(ValueError, match="you have not added provider"):
            BuiltinToolManageService.delete_builtin_tool_provider("tenant-1", "google", "missing")

    def test_deletes_provider_and_clears_cache(
        self,
        monkeypatch: pytest.MonkeyPatch,
        tools_database: ToolsDatabase,
    ) -> None:
        _persist_provider(tools_database, credential_id="cred-1")
        _persist_provider(tools_database, credential_id="cred-other", tenant_id="tenant-2")
        cache = MagicMock()
        monkeypatch.setattr(service_module.ToolManager, "get_builtin_provider", MagicMock(return_value=MagicMock()))
        monkeypatch.setattr(
            BuiltinToolManageService,
            "create_tool_encrypter",
            MagicMock(return_value=(MagicMock(), cache)),
        )

        result = BuiltinToolManageService.delete_builtin_tool_provider("tenant-1", "google", "cred-1")

        assert result == {"result": "success"}
        cache.delete.assert_called_once()
        with tools_database.session_maker() as session:
            assert session.get(BuiltinToolProvider, "cred-1") is None
            assert session.get(BuiltinToolProvider, "cred-other") is not None


class TestSetDefaultProvider:
    def test_raises_when_not_found(self, tools_database: ToolsDatabase) -> None:
        with pytest.raises(ValueError, match="provider not found"):
            BuiltinToolManageService.set_default_provider("tenant-1", "google", "missing")

    def test_sets_target_and_clears_only_same_tenant_defaults(self, tools_database: ToolsDatabase) -> None:
        _persist_provider(tools_database, credential_id="target", name="Google target")
        _persist_provider(tools_database, credential_id="old", name="Google old", is_default=True)
        _persist_provider(
            tools_database,
            credential_id="other-tenant",
            tenant_id="tenant-2",
            name="Other tenant",
            is_default=True,
        )

        result = BuiltinToolManageService.set_default_provider("tenant-1", "google", "target")

        assert result == {"result": "success"}
        with tools_database.session_maker() as session:
            assert session.get(BuiltinToolProvider, "target").is_default is True
            assert session.get(BuiltinToolProvider, "old").is_default is False
            assert session.get(BuiltinToolProvider, "other-tenant").is_default is True


class TestUpdateBuiltinToolProvider:
    def test_raises_when_provider_not_exists(self, tools_database: ToolsDatabase) -> None:
        with pytest.raises(ValueError, match="you have not added provider"):
            BuiltinToolManageService.update_builtin_tool_provider("u", "tenant-1", "google", "missing")

    def test_updates_persisted_credentials_and_clears_cache(
        self,
        monkeypatch: pytest.MonkeyPatch,
        tools_database: ToolsDatabase,
    ) -> None:
        _persist_provider(tools_database, credentials={"key": "old"})
        controller = MagicMock(need_credentials=True)
        monkeypatch.setattr(service_module.ToolManager, "get_builtin_provider", MagicMock(return_value=controller))
        encrypter = MagicMock()
        encrypter.decrypt.return_value = {"key": "old"}
        encrypter.encrypt.return_value = {"key": "new"}
        cache = MagicMock()
        monkeypatch.setattr(
            BuiltinToolManageService,
            "create_tool_encrypter",
            MagicMock(return_value=(encrypter, cache)),
        )

        result = BuiltinToolManageService.update_builtin_tool_provider(
            "u", "tenant-1", "google", "cred-1", credentials={"key": "value"}
        )

        assert result == {"result": "success"}
        controller.validate_credentials.assert_called_once_with("u", {"key": "value"})
        cache.delete.assert_called_once()
        with tools_database.session_maker() as session:
            provider = session.get(BuiltinToolProvider, "cred-1")
            assert provider is not None
            assert provider.credentials == {"key": "new"}


class TestGetOauthClientSchema:
    def test_returns_schema_dict(self, monkeypatch: pytest.MonkeyPatch) -> None:
        controller = MagicMock()
        controller.get_oauth_client_schema.return_value = []
        monkeypatch.setattr(service_module.ToolManager, "get_builtin_provider", MagicMock(return_value=controller))
        monkeypatch.setattr(BuiltinToolManageService, "is_oauth_custom_client_enabled", MagicMock(return_value=True))
        monkeypatch.setattr(BuiltinToolManageService, "is_oauth_system_client_exists", MagicMock(return_value=False))
        monkeypatch.setattr(BuiltinToolManageService, "get_custom_oauth_client_params", MagicMock(return_value={}))
        monkeypatch.setattr(service_module.dify_config, "CONSOLE_API_URL", "https://api.example.com")

        result = BuiltinToolManageService.get_builtin_tool_provider_oauth_client_schema("t", "google")

        assert "schema" in result
        assert result["is_oauth_custom_client_enabled"] is True
        assert "redirect_uri" in result


class TestGetOauthClient:
    def test_returns_tenant_client_params_when_exists(
        self,
        monkeypatch: pytest.MonkeyPatch,
        tools_database: ToolsDatabase,
    ) -> None:
        _persist_tenant_oauth_client(tools_database)
        controller = MagicMock()
        controller.get_oauth_client_schema.return_value = []
        monkeypatch.setattr(service_module.ToolManager, "get_builtin_provider", MagicMock(return_value=controller))
        encrypter = MagicMock()
        encrypter.decrypt.return_value = {"client_id": "id", "client_secret": "secret"}
        monkeypatch.setattr(
            service_module, "create_provider_encrypter", MagicMock(return_value=(encrypter, MagicMock()))
        )

        result = BuiltinToolManageService.get_oauth_client("tenant-1", "google")

        assert result == {"client_id": "id", "client_secret": "secret"}
        encrypter.decrypt.assert_called_once_with({"encrypted": "data"})

    def test_falls_back_to_system_client(
        self,
        monkeypatch: pytest.MonkeyPatch,
        tools_database: ToolsDatabase,
    ) -> None:
        _persist_system_oauth_client(tools_database)
        controller = MagicMock()
        controller.get_oauth_client_schema.return_value = []
        monkeypatch.setattr(service_module.ToolManager, "get_builtin_provider", MagicMock(return_value=controller))
        monkeypatch.setattr(
            service_module, "create_provider_encrypter", MagicMock(return_value=(MagicMock(), MagicMock()))
        )
        decrypt = MagicMock(return_value={"sys_key": "sys_val"})
        monkeypatch.setattr(service_module, "decrypt_system_params", decrypt)

        result = BuiltinToolManageService.get_oauth_client("tenant-1", "google")

        assert result == {"sys_key": "sys_val"}
        decrypt.assert_called_once_with("enc")


class TestSaveCustomOauthClientParams:
    def test_returns_early_when_no_params(self) -> None:
        result = BuiltinToolManageService.save_custom_oauth_client_params("t", "p")
        assert result == {"result": "success"}

    def test_raises_when_provider_not_found(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(service_module.ToolManager, "get_builtin_provider", MagicMock(return_value=None))

        with pytest.raises((ValueError, Exception), match="not found|Provider"):
            BuiltinToolManageService.save_custom_oauth_client_params("t", "p", enable_oauth_custom_client=True)


class TestGetCustomOauthClientParams:
    def test_returns_empty_when_none(self, tools_database: ToolsDatabase) -> None:
        _persist_tenant_oauth_client(tools_database, tenant_id="other-tenant")

        result = BuiltinToolManageService.get_custom_oauth_client_params("tenant-1", "google")

        assert result == {}


class TestGetBuiltinToolProviderCredentialInfo:
    def test_returns_credential_info(
        self,
        monkeypatch: pytest.MonkeyPatch,
        tools_database: ToolsDatabase,
    ) -> None:
        controller = MagicMock()
        controller.get_supported_credential_types.return_value = ["api-key"]
        monkeypatch.setattr(service_module.ToolManager, "get_builtin_provider", MagicMock(return_value=controller))
        monkeypatch.setattr(
            BuiltinToolManageService,
            "get_builtin_tool_provider_credentials",
            MagicMock(return_value=[]),
        )
        monkeypatch.setattr(
            BuiltinToolManageService,
            "is_oauth_custom_client_enabled",
            MagicMock(return_value=False),
        )

        with tools_database.session_maker() as session:
            result = BuiltinToolManageService.get_builtin_tool_provider_credential_info(
                "tenant-1", "google", session=session
            )

        assert result.credentials == []
        assert result.supported_credential_types == ["api-key"]
        assert result.is_oauth_custom_client_enabled is False


class TestGetBuiltinToolProviderCredentials:
    def test_returns_empty_when_no_providers(self, tools_database: ToolsDatabase) -> None:
        _persist_provider(tools_database, credential_id="other", tenant_id="other-tenant")

        with tools_database.session_maker() as session:
            result = BuiltinToolManageService.get_builtin_tool_provider_credentials(
                "tenant-1", "google", session=session
            )

        assert result == []

    def test_returns_tenant_scoped_credential_entities(
        self,
        monkeypatch: pytest.MonkeyPatch,
        tools_database: ToolsDatabase,
    ) -> None:
        _persist_provider(tools_database, is_default=False)
        _persist_provider(tools_database, credential_id="other", tenant_id="other-tenant")
        controller = MagicMock()
        monkeypatch.setattr(service_module.ToolManager, "get_builtin_provider", MagicMock(return_value=controller))
        encrypter = MagicMock()
        encrypter.decrypt.return_value = {"key": "decrypted"}
        encrypter.mask_plugin_credentials.return_value = {"key": "***"}
        monkeypatch.setattr(
            BuiltinToolManageService,
            "create_tool_encrypter",
            MagicMock(return_value=(encrypter, MagicMock())),
        )
        credential_entity = MagicMock()
        convert = MagicMock(return_value=credential_entity)
        monkeypatch.setattr(
            service_module.ToolTransformService,
            "convert_builtin_provider_to_credential_entity",
            convert,
        )

        with tools_database.session_maker() as session:
            result = BuiltinToolManageService.get_builtin_tool_provider_credentials(
                "tenant-1", "google", session=session
            )

        assert result == [credential_entity]
        converted_provider = convert.call_args.kwargs["provider"]
        assert isinstance(converted_provider, BuiltinToolProvider)
        assert converted_provider.tenant_id == "tenant-1"
        assert converted_provider.is_default is True


class TestGetBuiltinProvider:
    def test_returns_none_when_not_found(self, tools_database: ToolsDatabase) -> None:
        assert BuiltinToolManageService.get_builtin_provider("google", "tenant-1") is None

    def test_returns_langgenius_provider_for_matching_tenant(self, tools_database: ToolsDatabase) -> None:
        _persist_provider(tools_database, tenant_id="tenant-1", provider="google")
        _persist_provider(tools_database, credential_id="other", tenant_id="tenant-2", provider="google")

        result = BuiltinToolManageService.get_builtin_provider("google", "tenant-1")

        assert result is not None
        assert result.id == "cred-1"
        assert result.provider == "langgenius/google/google"

    def test_returns_non_langgenius_provider(self, tools_database: ToolsDatabase) -> None:
        full_provider = "third-party/custom/custom-tool"
        _persist_provider(tools_database, provider=full_provider)

        result = BuiltinToolManageService.get_builtin_provider(full_provider, "tenant-1")

        assert result is not None
        assert result.id == "cred-1"
        assert result.provider == full_provider

    def test_falls_back_on_provider_id_parse_exception(
        self,
        monkeypatch: pytest.MonkeyPatch,
        tools_database: ToolsDatabase,
    ) -> None:
        _persist_provider(tools_database, provider="old-provider")
        monkeypatch.setattr(service_module, "ToolProviderID", MagicMock(side_effect=Exception("parse error")))

        result = BuiltinToolManageService.get_builtin_provider("old-provider", "tenant-1")

        assert result is not None
        assert result.id == "cred-1"
