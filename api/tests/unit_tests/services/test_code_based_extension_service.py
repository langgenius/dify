from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from services.code_based_extension_service import CodeBasedExtensionService


class TestCodeBasedExtensionService:
    def test_should_return_only_non_builtin_extensions_with_public_fields(self, monkeypatch: pytest.MonkeyPatch):
        """Test service returns only non-builtin extensions with name/label/form_schema fields."""
        moderation_extension = SimpleNamespace(
            name="custom-moderation",
            label={"en-US": "Custom Moderation"},
            form_schema=[{"variable": "api_key"}],
            builtin=False,
            extension_class=object,
            position=20,
        )
        builtin_extension = SimpleNamespace(
            name="builtin-moderation",
            label={"en-US": "Builtin Moderation"},
            form_schema=[{"variable": "token"}],
            builtin=True,
            extension_class=object,
            position=1,
        )
        retrieval_extension = SimpleNamespace(
            name="custom-retrieval",
            label={"en-US": "Custom Retrieval"},
            form_schema=None,
            builtin=False,
            extension_class=object,
            position=30,
        )
        module_extensions_mock = MagicMock(return_value=[moderation_extension, builtin_extension, retrieval_extension])
        monkeypatch.setattr(
            "services.code_based_extension_service.code_based_extension.module_extensions",
            module_extensions_mock,
        )

        result = CodeBasedExtensionService.get_code_based_extension("external_data_tool")

        assert result == [
            {
                "name": "custom-moderation",
                "label": {"en-US": "Custom Moderation"},
                "form_schema": [{"variable": "api_key"}],
            },
            {
                "name": "custom-retrieval",
                "label": {"en-US": "Custom Retrieval"},
                "form_schema": None,
            },
        ]
        assert set(result[0].keys()) == {"name", "label", "form_schema"}
        module_extensions_mock.assert_called_once_with("external_data_tool")

    def test_should_return_empty_list_when_all_extensions_are_builtin(self, monkeypatch: pytest.MonkeyPatch):
        """Test builtin extensions are filtered out completely."""
        builtin_extension = SimpleNamespace(
            name="builtin-moderation",
            label={"en-US": "Builtin Moderation"},
            form_schema=[{"variable": "token"}],
            builtin=True,
        )
        module_extensions_mock = MagicMock(return_value=[builtin_extension])
        monkeypatch.setattr(
            "services.code_based_extension_service.code_based_extension.module_extensions",
            module_extensions_mock,
        )

        result = CodeBasedExtensionService.get_code_based_extension("moderation")

        assert result == []
        module_extensions_mock.assert_called_once_with("moderation")

    def test_should_propagate_error_when_module_extensions_lookup_fails(self, monkeypatch: pytest.MonkeyPatch):
        """Test ValueError from extension lookup bubbles up unchanged."""
        module_extensions_mock = MagicMock(side_effect=ValueError("Extension Module invalid-module not found"))
        monkeypatch.setattr(
            "services.code_based_extension_service.code_based_extension.module_extensions",
            module_extensions_mock,
        )

        with pytest.raises(ValueError, match="Extension Module invalid-module not found"):
            CodeBasedExtensionService.get_code_based_extension("invalid-module")

        module_extensions_mock.assert_called_once_with("invalid-module")
