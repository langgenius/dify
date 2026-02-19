from core.app.entities.app_invoke_entities import InvokeFrom
from core.datasource.__base.datasource_runtime import DatasourceRuntime, FakeDatasourceRuntime
from core.datasource.entities.datasource_entities import DatasourceInvokeFrom


class TestDatasourceRuntime:
    def test_init(self):
        runtime = DatasourceRuntime(
            tenant_id="test-tenant",
            datasource_id="test-ds",
            invoke_from=InvokeFrom.DEBUGGER,
            datasource_invoke_from=DatasourceInvokeFrom.RAG_PIPELINE,
            credentials={"key": "val"},
            runtime_parameters={"p": "v"},
        )
        assert runtime.tenant_id == "test-tenant"
        assert runtime.datasource_id == "test-ds"
        assert runtime.credentials["key"] == "val"

    def test_fake_datasource_runtime(self):
        # This covers the FakeDatasourceRuntime class and its __init__
        runtime = FakeDatasourceRuntime()
        assert runtime.tenant_id == "fake_tenant_id"
        assert runtime.datasource_id == "fake_datasource_id"
        assert runtime.invoke_from == InvokeFrom.DEBUGGER
        assert runtime.datasource_invoke_from == DatasourceInvokeFrom.RAG_PIPELINE
