from unittest.mock import MagicMock, patch

import pytest

from core.extension.extensible import ExtensionModule, ModuleExtension
from core.extension.extension import Extension


class TestExtension:
    def setup_method(self) -> None:
        # Reset the private class attribute before each test
        Extension._Extension__module_extensions = {}

    def test_init(self) -> None:
        # Mock scan_extensions for Moderation and ExternalDataTool
        mock_mod_extensions = {"mod1": ModuleExtension(name="mod1")}
        mock_ext_extensions = {"ext1": ModuleExtension(name="ext1")}

        extension = Extension()

        # We need to mock scan_extensions on the classes defined in Extension.module_classes
        with (
            patch("core.extension.extension.Moderation.scan_extensions", return_value=mock_mod_extensions),
            patch("core.extension.extension.ExternalDataTool.scan_extensions", return_value=mock_ext_extensions),
        ):
            extension.init()

            # Check the scanned extensions are exposed per module, keyed by extension name
            moderation = extension.module_extensions(ExtensionModule.MODERATION.value)
            external_data_tool = extension.module_extensions(ExtensionModule.EXTERNAL_DATA_TOOL.value)
            assert {e.name: e for e in moderation} == mock_mod_extensions
            assert {e.name: e for e in external_data_tool} == mock_ext_extensions

    def test_module_extensions_success(self) -> None:
        # Setup data
        mock_extensions = {"name1": ModuleExtension(name="name1"), "name2": ModuleExtension(name="name2")}
        Extension._Extension__module_extensions = {ExtensionModule.MODERATION.value: mock_extensions}

        extension = Extension()
        result = extension.module_extensions(ExtensionModule.MODERATION.value)

        assert len(result) == 2
        assert any(e.name == "name1" for e in result)
        assert any(e.name == "name2" for e in result)

    def test_module_extensions_not_found(self) -> None:
        extension = Extension()
        with pytest.raises(ValueError, match="Extension Module unknown not found"):
            extension.module_extensions("unknown")

    def test_module_extension_success(self) -> None:
        mock_ext = ModuleExtension(name="test_ext")
        Extension._Extension__module_extensions = {ExtensionModule.MODERATION.value: {"test_ext": mock_ext}}

        extension = Extension()
        result = extension.module_extension(ExtensionModule.MODERATION, "test_ext")
        assert result == mock_ext

    def test_module_extension_module_not_found(self) -> None:
        extension = Extension()
        # ExtensionModule.MODERATION is "moderation"
        with pytest.raises(ValueError, match="Extension Module moderation not found"):
            extension.module_extension(ExtensionModule.MODERATION, "any")

    def test_module_extension_extension_not_found(self) -> None:
        # We need a non-empty dict because 'if not module_extensions' in extension.py
        # returns True for an empty dict, which raises the module not found error instead.
        Extension._Extension__module_extensions = {ExtensionModule.MODERATION.value: {"other": MagicMock()}}

        extension = Extension()
        with pytest.raises(ValueError, match="Extension unknown not found"):
            extension.module_extension(ExtensionModule.MODERATION, "unknown")

    def test_extension_class_success(self) -> None:
        class MockClass:
            pass

        mock_ext = ModuleExtension(name="test_ext", extension_class=MockClass)
        Extension._Extension__module_extensions = {ExtensionModule.MODERATION.value: {"test_ext": mock_ext}}

        extension = Extension()
        result = extension.extension_class(ExtensionModule.MODERATION, "test_ext")
        assert result == MockClass

    def test_extension_class_none(self) -> None:
        mock_ext = ModuleExtension(name="test_ext", extension_class=None)
        Extension._Extension__module_extensions = {ExtensionModule.MODERATION.value: {"test_ext": mock_ext}}

        extension = Extension()
        with pytest.raises(AssertionError):
            extension.extension_class(ExtensionModule.MODERATION, "test_ext")
