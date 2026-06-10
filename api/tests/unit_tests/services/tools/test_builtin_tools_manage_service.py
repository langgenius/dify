from unittest.mock import MagicMock, patch

import pytest

from services.tools.builtin_tools_manage_service import BuiltinToolManageService

MODULE = "services.tools.builtin_tools_manage_service"


def _mock_session(mock_session_cls):
    """Helper: set up a Session context manager mock and return the inner session."""
    session = MagicMock()
    mock_session_cls.return_value.__enter__ = MagicMock(return_value=session)
    mock_session_cls.return_value.__exit__ = MagicMock(return_value=False)
    return session


def _mock_sessionmaker(mock_sm_cls):
    """Helper: set up a sessionmaker().begin() context manager mock and return the inner session."""
    session = MagicMock()
    mock_sm_cls.return_value.begin.return_value.__enter__ = MagicMock(return_value=session)
    mock_sm_cls.return_value.begin.return_value.__exit__ = MagicMock(return_value=False)
    return session


class TestDeleteCustomOauthClientParams:
    @patch(f"{MODULE}.sessionmaker")
    @patch(f"{MODULE}.db")
    def test_deletes_and_returns_success(self, mock_db, mock_sm_cls):
        session = _mock_sessionmaker(mock_sm_cls)

        result = BuiltinToolManageService.delete_custom_oauth_client_params("tenant-1", "google")

        assert result == {"result": "success"}
        session.execute.assert_called_once()


class TestListBuiltinToolProviderTools:
    @patch(f"{MODULE}.ToolLabelManager")
    @patch(f"{MODULE}.ToolTransformService")
    @patch(f"{MODULE}.ToolManager")
    def test_transforms_each_tool(self, mock_manager, mock_transform, mock_labels):
        mock_controller = MagicMock()
        mock_controller.get_tools.return_value = [MagicMock(), MagicMock()]
        mock_manager.get_builtin_provider.return_value = mock_controller
        mock_transform.convert_tool_entity_to_api_entity.return_value = MagicMock()

        result = BuiltinToolManageService.list_builtin_tool_provider_tools("tenant-1", "google")

        assert len(result) == 2

    @patch(f"{MODULE}.ToolLabelManager")
    @patch(f"{MODULE}.ToolTransformService")
    @patch(f"{MODULE}.ToolManager")
    def test_empty_tools(self, mock_manager, mock_transform, mock_labels):
        mock_controller = MagicMock()
        mock_controller.get_tools.return_value = []
        mock_manager.get_builtin_provider.return_value = mock_controller

        assert BuiltinToolManageService.list_builtin_tool_provider_tools("t", "p") == []


class TestGetBuiltinToolProviderInfo:
    @patch(f"{MODULE}.ToolTransformService")
    @patch(f"{MODULE}.BuiltinToolManageService.get_builtin_provider")
    @patch(f"{MODULE}.ToolManager")
    def test_raises_when_not_found(self, mock_manager, mock_get, mock_transform):
        mock_get.return_value = None

        with pytest.raises(ValueError, match="you have not added provider"):
            BuiltinToolManageService.get_builtin_tool_provider_info("t", "no")

    @patch(f"{MODULE}.ToolTransformService")
    @patch(f"{MODULE}.BuiltinToolManageService.get_builtin_provider")
    @patch(f"{MODULE}.ToolManager")
    def test_clears_original_credentials(self, mock_manager, mock_get, mock_transform):
        mock_get.return_value = MagicMock()
        entity = MagicMock()
        mock_transform.builtin_provider_to_user_provider.return_value = entity

        result = BuiltinToolManageService.get_builtin_tool_provider_info("t", "google")

        assert result.original_credentials == {}


class TestListBuiltinProviderCredentialsSchema:
    @patch(f"{MODULE}.ToolManager")
    def test_returns_schema(self, mock_manager):
        mock_manager.get_builtin_provider.return_value.get_credentials_schema_by_type.return_value = [{"f": "k"}]

        result = BuiltinToolManageService.list_builtin_provider_credentials_schema("g", "api_key", "t")

        assert result == [{"f": "k"}]


class TestGetBuiltinToolProviderIcon:
    @patch(f"{MODULE}.Path")
    @patch(f"{MODULE}.ToolManager")
    def test_returns_bytes_and_mime(self, mock_manager, mock_path):
        mock_manager.get_hardcoded_provider_icon.return_value = ("/icon.svg", "image/svg+xml")
        mock_path.return_value.read_bytes.return_value = b"<svg/>"

        icon, mime = BuiltinToolManageService.get_builtin_tool_provider_icon("google")

        assert icon == b"<svg/>"
        assert mime == "image/svg+xml"


class TestIsOauthSystemClientExists:
    @patch(f"{MODULE}.Session")
    @patch(f"{MODULE}.db")
    def test_true_when_exists(self, mock_db, mock_session_cls):
        session = _mock_session(mock_session_cls)
        session.scalar.return_value = MagicMock()

        assert BuiltinToolManageService.is_oauth_system_client_exists("google") is True

    @patch(f"{MODULE}.Session")
    @patch(f"{MODULE}.db")
    def test_false_when_missing(self, mock_db, mock_session_cls):
        session = _mock_session(mock_session_cls)
        session.scalar.return_value = None

        assert BuiltinToolManageService.is_oauth_system_client_exists("google") is False


class TestIsOauthCustomClientEnabled:
    @patch(f"{MODULE}.Session")
    @patch(f"{MODULE}.db")
    def test_true_when_enabled(self, mock_db, mock_session_cls):
        session = _mock_session(mock_session_cls)
        session.scalar.return_value = MagicMock(enabled=True)

        assert BuiltinToolManageService.is_oauth_custom_client_enabled("t", "g") is True

    @patch(f"{MODULE}.Session")
    @patch(f"{MODULE}.db")
    def test_false_when_none(self, mock_db, mock_session_cls):
        session = _mock_session(mock_session_cls)
        session.scalar.return_value = None

        assert BuiltinToolManageService.is_oauth_custom_client_enabled("t", "g") is False


class TestDeleteBuiltinToolProvider:
    @patch(f"{MODULE}.BuiltinToolManageService.create_tool_encrypter")
    @patch(f"{MODULE}.ToolManager")
    @patch(f"{MODULE}.sessionmaker")
    @patch(f"{MODULE}.db")
    def test_raises_when_not_found(self, mock_db, mock_sm_cls, mock_tm, mock_enc):
        session = _mock_sessionmaker(mock_sm_cls)
        session.scalar.return_value = None

        with pytest.raises(ValueError, match="you have not added provider"):
            BuiltinToolManageService.delete_builtin_tool_provider("t", "p", "id")

    @patch(f"{MODULE}.BuiltinToolManageService.create_tool_encrypter")
    @patch(f"{MODULE}.ToolManager")
    @patch(f"{MODULE}.sessionmaker")
    @patch(f"{MODULE}.db")
    def test_deletes_provider_and_clears_cache(self, mock_db, mock_sm_cls, mock_tm, mock_enc):
        session = _mock_sessionmaker(mock_sm_cls)
        db_provider = MagicMock()
        session.scalar.return_value = db_provider
        mock_cache = MagicMock()
        mock_enc.return_value = (MagicMock(), mock_cache)

        result = BuiltinToolManageService.delete_builtin_tool_provider("t", "p", "c")

        assert result == {"result": "success"}
        session.delete.assert_called_once_with(db_provider)
        mock_cache.delete.assert_called_once()


class TestSetDefaultProvider:
    @patch(f"{MODULE}.sessionmaker")
    @patch(f"{MODULE}.db")
    def test_raises_when_not_found(self, mock_db, mock_sm_cls):
        session = _mock_sessionmaker(mock_sm_cls)
        session.scalar.return_value = None

        with pytest.raises(ValueError, match="provider not found"):
            BuiltinToolManageService.set_default_provider("t", "p", "id")

    @patch(f"{MODULE}.sessionmaker")
    @patch(f"{MODULE}.db")
    def test_sets_default_and_clears_old(self, mock_db, mock_sm_cls):
        session = _mock_sessionmaker(mock_sm_cls)
        target = MagicMock()
        session.scalar.return_value = target

        result = BuiltinToolManageService.set_default_provider("t", "p", "id")

        assert result == {"result": "success"}
        assert target.is_default is True

    @patch(f"{MODULE}.sessionmaker")
    @patch(f"{MODULE}.db")
    def test_clear_default_is_tenant_scoped_not_user_scoped(self, mock_db, mock_sm_cls):
        # Regression: clearing prior defaults must NOT filter by user_id, otherwise
        # two workspace members can each leave their own credential as default at
        # the same time (the default flag is tenant-scoped, not per-user).
        session = _mock_sessionmaker(mock_sm_cls)
        session.scalar.return_value = MagicMock()

        BuiltinToolManageService.set_default_provider("tenant-1", "google", "cred-id")

        session.execute.assert_called_once()
        update_stmt = session.execute.call_args.args[0]
        compiled = str(update_stmt.compile(compile_kwargs={"literal_binds": True}))
        assert "user_id" not in compiled
        assert "tenant_id" in compiled
        assert "provider" in compiled


class TestUpdateBuiltinToolProvider:
    @patch(f"{MODULE}.sessionmaker")
    @patch(f"{MODULE}.db")
    def test_raises_when_provider_not_exists(self, mock_db, mock_sm_cls):
        session = _mock_sessionmaker(mock_sm_cls)
        session.scalar.return_value = None

        with pytest.raises(ValueError, match="you have not added provider"):
            BuiltinToolManageService.update_builtin_tool_provider("u", "t", "p", "c")

    @patch(f"{MODULE}.BuiltinToolManageService.create_tool_encrypter")
    @patch(f"{MODULE}.CredentialType")
    @patch(f"{MODULE}.ToolManager")
    @patch(f"{MODULE}.sessionmaker")
    @patch(f"{MODULE}.db")
    def test_updates_credentials_and_commits(self, mock_db, mock_sm_cls, mock_tm, mock_cred_type, mock_enc):
        session = _mock_sessionmaker(mock_sm_cls)
        db_provider = MagicMock(credential_type="api_key", credentials="{}")
        session.scalar.return_value = db_provider

        mock_cred_instance = MagicMock()
        mock_cred_instance.is_editable.return_value = True
        mock_cred_instance.is_validate_allowed.return_value = False
        mock_cred_type.of.return_value = mock_cred_instance

        mock_controller = MagicMock(need_credentials=True)
        mock_tm.get_builtin_provider.return_value = mock_controller

        mock_encrypter = MagicMock()
        mock_encrypter.decrypt.return_value = {"key": "old"}
        mock_encrypter.encrypt.return_value = {"key": "new"}
        mock_cache = MagicMock()
        mock_enc.return_value = (mock_encrypter, mock_cache)

        result = BuiltinToolManageService.update_builtin_tool_provider("u", "t", "p", "c", credentials={"key": "val"})

        assert result == {"result": "success"}
        mock_cache.delete.assert_called_once()


class TestGetOauthClientSchema:
    @patch(f"{MODULE}.BuiltinToolManageService.get_custom_oauth_client_params", return_value={})
    @patch(f"{MODULE}.BuiltinToolManageService.is_oauth_system_client_exists", return_value=False)
    @patch(f"{MODULE}.BuiltinToolManageService.is_oauth_custom_client_enabled", return_value=True)
    @patch(f"{MODULE}.dify_config")
    @patch(f"{MODULE}.PluginService")
    @patch(f"{MODULE}.ToolManager")
    def test_returns_schema_dict(self, mock_tm, mock_plugin, mock_config, mock_enabled, mock_sys, mock_params):
        mock_config.CONSOLE_API_URL = "https://api.example.com"
        mock_controller = MagicMock()
        mock_controller.get_oauth_client_schema.return_value = []
        mock_tm.get_builtin_provider.return_value = mock_controller

        result = BuiltinToolManageService.get_builtin_tool_provider_oauth_client_schema("t", "google")

        assert "schema" in result
        assert result["is_oauth_custom_client_enabled"] is True
        assert "redirect_uri" in result


class TestGetOauthClient:
    @patch(f"{MODULE}.PluginService")
    @patch(f"{MODULE}.create_provider_encrypter")
    @patch(f"{MODULE}.ToolManager")
    @patch(f"{MODULE}.Session")
    @patch(f"{MODULE}.db")
    def test_returns_user_client_params_when_exists(
        self, mock_db, mock_session_cls, mock_tm, mock_create_enc, mock_plugin
    ):
        session = _mock_session(mock_session_cls)
        mock_controller = MagicMock()
        mock_controller.get_oauth_client_schema.return_value = []
        mock_tm.get_builtin_provider.return_value = mock_controller

        mock_encrypter = MagicMock()
        mock_encrypter.decrypt.return_value = {"client_id": "id", "client_secret": "secret"}
        mock_create_enc.return_value = (mock_encrypter, MagicMock())

        user_client = MagicMock(oauth_params='{"encrypted": "data"}')
        session.scalar.return_value = user_client

        result = BuiltinToolManageService.get_oauth_client("t", "google")

        assert result == {"client_id": "id", "client_secret": "secret"}

    @patch(f"{MODULE}.decrypt_system_params", return_value={"sys_key": "sys_val"})
    @patch(f"{MODULE}.PluginService")
    @patch(f"{MODULE}.create_provider_encrypter")
    @patch(f"{MODULE}.ToolManager")
    @patch(f"{MODULE}.Session")
    @patch(f"{MODULE}.db")
    def test_falls_back_to_system_client(
        self, mock_db, mock_session_cls, mock_tm, mock_create_enc, mock_plugin, mock_decrypt
    ):
        session = _mock_session(mock_session_cls)
        mock_controller = MagicMock()
        mock_controller.get_oauth_client_schema.return_value = []
        mock_tm.get_builtin_provider.return_value = mock_controller

        mock_create_enc.return_value = (MagicMock(), MagicMock())

        system_client = MagicMock(encrypted_oauth_params="enc")
        session.scalar.side_effect = [None, system_client]

        result = BuiltinToolManageService.get_oauth_client("t", "google")

        assert result == {"sys_key": "sys_val"}


class TestSaveCustomOauthClientParams:
    def test_returns_early_when_no_params(self):
        result = BuiltinToolManageService.save_custom_oauth_client_params("t", "p")
        assert result == {"result": "success"}

    @patch(f"{MODULE}.ToolManager")
    def test_raises_when_provider_not_found(self, mock_tm):
        mock_tm.get_builtin_provider.return_value = None

        with pytest.raises((ValueError, Exception), match="not found|Provider"):
            BuiltinToolManageService.save_custom_oauth_client_params("t", "p", enable_oauth_custom_client=True)


class TestGetCustomOauthClientParams:
    @patch(f"{MODULE}.Session")
    @patch(f"{MODULE}.db")
    def test_returns_empty_when_none(self, mock_db, mock_session_cls):
        session = _mock_session(mock_session_cls)
        session.scalar.return_value = None

        result = BuiltinToolManageService.get_custom_oauth_client_params("t", "p")

        assert result == {}


class TestGetBuiltinToolProviderCredentialInfo:
    @patch(f"{MODULE}.BuiltinToolManageService.is_oauth_custom_client_enabled", return_value=False)
    @patch(f"{MODULE}.BuiltinToolManageService.get_builtin_tool_provider_credentials", return_value=[])
    @patch(f"{MODULE}.ToolManager")
    def test_returns_credential_info(self, mock_tm, mock_creds, mock_oauth):
        mock_tm.get_builtin_provider.return_value.get_supported_credential_types.return_value = ["api-key"]

        result = BuiltinToolManageService.get_builtin_tool_provider_credential_info("t", "google")

        assert result.credentials == []
        assert result.supported_credential_types == ["api-key"]
        assert result.is_oauth_custom_client_enabled is False


class TestGetBuiltinToolProviderCredentials:
    @patch(f"{MODULE}.db")
    def test_returns_empty_when_no_providers(self, mock_db):
        mock_db.session.no_autoflush.__enter__ = MagicMock(return_value=None)
        mock_db.session.no_autoflush.__exit__ = MagicMock(return_value=False)
        mock_db.session.scalars.return_value.all.return_value = []

        result = BuiltinToolManageService.get_builtin_tool_provider_credentials("t", "google")

        assert result == []

    @patch(f"{MODULE}.ToolTransformService")
    @patch(f"{MODULE}.BuiltinToolManageService.create_tool_encrypter")
    @patch(f"{MODULE}.ToolManager")
    @patch(f"{MODULE}.db")
    def test_returns_credential_entities(self, mock_db, mock_tm, mock_enc, mock_transform):
        mock_db.session.no_autoflush.__enter__ = MagicMock(return_value=None)
        mock_db.session.no_autoflush.__exit__ = MagicMock(return_value=False)

        provider = MagicMock(provider="google", is_default=False)
        mock_db.session.scalars.return_value.all.return_value = [provider]

        mock_encrypter = MagicMock()
        mock_encrypter.decrypt.return_value = {"key": "decrypted"}
        mock_encrypter.mask_plugin_credentials.return_value = {"key": "***"}
        mock_enc.return_value = (mock_encrypter, MagicMock())

        credential_entity = MagicMock()
        mock_transform.convert_builtin_provider_to_credential_entity.return_value = credential_entity

        result = BuiltinToolManageService.get_builtin_tool_provider_credentials("t", "google")

        assert len(result) == 1
        assert result[0] is credential_entity
        assert provider.is_default is True


class TestGetBuiltinProvider:
    @patch(f"{MODULE}.ToolProviderID")
    @patch(f"{MODULE}.Session")
    @patch(f"{MODULE}.db")
    def test_returns_none_when_not_found(self, mock_db, mock_session_cls, mock_prov_id):
        session = _mock_session(mock_session_cls)
        mock_prov_id.return_value.provider_name = "google"
        mock_prov_id.return_value.organization = "langgenius"
        session.scalar.return_value = None

        result = BuiltinToolManageService.get_builtin_provider("google", "t")

        assert result is None

    @patch(f"{MODULE}.ToolProviderID")
    @patch(f"{MODULE}.Session")
    @patch(f"{MODULE}.db")
    def test_returns_provider_for_langgenius_org(self, mock_db, mock_session_cls, mock_prov_id):
        session = _mock_session(mock_session_cls)
        mock_prov_id.return_value.provider_name = "google"
        mock_prov_id.return_value.organization = "langgenius"
        db_provider = MagicMock(provider="google")
        mock_prov_id_result = MagicMock()
        mock_prov_id_result.to_string.return_value = "langgenius/google/google"

        def prov_id_side_effect(name):
            m = MagicMock()
            m.provider_name = "google"
            m.organization = "langgenius"
            m.to_string.return_value = "langgenius/google/google"
            m.plugin_id = "langgenius/google"
            return m

        mock_prov_id.side_effect = prov_id_side_effect
        session.scalar.return_value = db_provider

        result = BuiltinToolManageService.get_builtin_provider("google", "t")

        assert result is db_provider

    @patch(f"{MODULE}.ToolProviderID")
    @patch(f"{MODULE}.Session")
    @patch(f"{MODULE}.db")
    def test_returns_provider_for_non_langgenius_org(self, mock_db, mock_session_cls, mock_prov_id):
        session = _mock_session(mock_session_cls)

        def prov_id_side_effect(name):
            m = MagicMock()
            m.provider_name = "custom-tool"
            m.organization = "third-party"
            m.to_string.return_value = "third-party/custom/custom-tool"
            m.plugin_id = "third-party/custom"
            return m

        mock_prov_id.side_effect = prov_id_side_effect
        db_provider = MagicMock(provider="third-party/custom/custom-tool")
        session.scalar.return_value = db_provider

        result = BuiltinToolManageService.get_builtin_provider("third-party/custom/custom-tool", "t")

        assert result is db_provider

    @patch(f"{MODULE}.ToolProviderID")
    @patch(f"{MODULE}.Session")
    @patch(f"{MODULE}.db")
    def test_falls_back_on_exception(self, mock_db, mock_session_cls, mock_prov_id):
        session = _mock_session(mock_session_cls)
        mock_prov_id.side_effect = Exception("parse error")
        fallback = MagicMock()
        session.scalar.return_value = fallback

        result = BuiltinToolManageService.get_builtin_provider("old-provider", "t")

        assert result is fallback
