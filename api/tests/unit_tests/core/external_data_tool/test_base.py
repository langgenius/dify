import pytest

from core.extension.extensible import ExtensionModule
from core.external_data_tool.base import ExternalDataTool


class TestExternalDataTool:
    def test_module_attribute(self):
        assert ExternalDataTool.module == ExtensionModule.EXTERNAL_DATA_TOOL

    def test_init(self):
        # Create a concrete subclass to test init
        class ConcreteTool(ExternalDataTool):
            @classmethod
            def validate_config(cls, tenant_id: str, config: dict):
                return super().validate_config(tenant_id, config)

            def query(self, inputs: dict, query: str | None = None) -> str:
                return super().query(inputs, query)

        tool = ConcreteTool(tenant_id="tenant_1", app_id="app_1", variable="var_1", config={"key": "value"})
        assert tool.tenant_id == "tenant_1"
        assert tool.app_id == "app_1"
        assert tool.variable == "var_1"
        assert tool.config == {"key": "value"}

    def test_init_without_config(self):
        # Create a concrete subclass to test init
        class ConcreteTool(ExternalDataTool):
            @classmethod
            def validate_config(cls, tenant_id: str, config: dict):
                pass

            def query(self, inputs: dict, query: str | None = None) -> str:
                return ""

        tool = ConcreteTool(tenant_id="tenant_1", app_id="app_1", variable="var_1")
        assert tool.tenant_id == "tenant_1"
        assert tool.app_id == "app_1"
        assert tool.variable == "var_1"
        assert tool.config is None

    def test_validate_config_raises_not_implemented(self):
        class ConcreteTool(ExternalDataTool):
            @classmethod
            def validate_config(cls, tenant_id: str, config: dict):
                return super().validate_config(tenant_id, config)

            def query(self, inputs: dict, query: str | None = None) -> str:
                return ""

        with pytest.raises(NotImplementedError):
            ConcreteTool.validate_config("tenant_1", {})

    def test_query_raises_not_implemented(self):
        class ConcreteTool(ExternalDataTool):
            @classmethod
            def validate_config(cls, tenant_id: str, config: dict):
                pass

            def query(self, inputs: dict, query: str | None = None) -> str:
                return super().query(inputs, query)

        tool = ConcreteTool(tenant_id="tenant_1", app_id="app_1", variable="var_1")
        with pytest.raises(NotImplementedError):
            tool.query({})
