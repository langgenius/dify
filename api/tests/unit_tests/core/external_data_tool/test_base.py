from collections.abc import Callable, Mapping
from typing import Any, override

import pytest

from core.extension.extensible import ExtensionModule
from core.external_data_tool.base import ExternalDataTool


class TestExternalDataTool:
    def test_module_attribute(self) -> None:
        assert ExternalDataTool.module == ExtensionModule.EXTERNAL_DATA_TOOL

    def test_init(self) -> None:
        # Create a concrete subclass to test init
        """Given a concrete tool and explicit configuration, retain its tenant, app, variable, and configuration."""

        class ConcreteTool(ExternalDataTool):
            @classmethod
            @override
            def validate_config(cls, tenant_id: str, config: dict[str, Any]) -> None:
                """Given tool configuration, perform no validation in this initialization-only fake."""
                pass

            @override
            def query(self, inputs: Mapping[str, Any], query: str | None = None) -> str:
                """Given the declared arguments, call the base stub and propagate NotImplementedError."""
                return ExternalDataTool.query(self, inputs, query)

        tool = ConcreteTool(tenant_id="tenant_1", app_id="app_1", variable="var_1", config={"key": "value"})
        assert tool.tenant_id == "tenant_1"
        assert tool.app_id == "app_1"
        assert tool.variable == "var_1"
        assert tool.config == {"key": "value"}

    def test_init_without_config(self) -> None:
        # Create a concrete subclass to test init
        class ConcreteTool(ExternalDataTool):
            @classmethod
            @override
            def validate_config(cls, tenant_id: str, config: dict[str, Any]) -> None:
                pass

            @override
            def query(self, inputs: Mapping[str, Any], query: str | None = None) -> str:
                return ""

        tool = ConcreteTool(tenant_id="tenant_1", app_id="app_1", variable="var_1")
        assert tool.tenant_id == "tenant_1"
        assert tool.app_id == "app_1"
        assert tool.variable == "var_1"
        assert tool.config is None

    @pytest.mark.parametrize("base_method", [ExternalDataTool.validate_config])
    def test_validate_config_raises_not_implemented(self, base_method: Callable[[str, dict[str, Any]], None]) -> None:
        """Given the base validator, verify its unimplemented contract raises."""
        with pytest.raises(NotImplementedError):
            base_method("tenant_1", {})

    def test_query_raises_not_implemented(self) -> None:
        """Given a concrete tool that calls the base query, propagate NotImplementedError."""

        class ConcreteTool(ExternalDataTool):
            @classmethod
            @override
            def validate_config(cls, tenant_id: str, config: dict[str, Any]) -> None:
                pass

            @override
            def query(self, inputs: Mapping[str, Any], query: str | None = None) -> str:
                """Given the declared arguments, call the base stub and propagate NotImplementedError."""
                return ExternalDataTool.query(self, inputs, query)

        tool = ConcreteTool(tenant_id="tenant_1", app_id="app_1", variable="var_1")
        with pytest.raises(NotImplementedError):
            tool.query({})
