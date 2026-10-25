from core.datasource.entities.datasource_entities import DatasourceInvokeMeta
from core.datasource.errors import (
    DatasourceApiSchemaError,
    DatasourceEngineInvokeError,
    DatasourceInvokeError,
    DatasourceNotFoundError,
    DatasourceNotSupportedError,
    DatasourceParameterValidationError,
    DatasourceProviderCredentialValidationError,
    DatasourceProviderNotFoundError,
)


class TestErrors:
    def test_datasource_provider_not_found_error(self) -> None:
        error = DatasourceProviderNotFoundError("Provider not found")
        assert str(error) == "Provider not found"
        assert isinstance(error, ValueError)

    def test_datasource_not_found_error(self) -> None:
        error = DatasourceNotFoundError("Datasource not found")
        assert str(error) == "Datasource not found"
        assert isinstance(error, ValueError)

    def test_datasource_parameter_validation_error(self) -> None:
        error = DatasourceParameterValidationError("Validation failed")
        assert str(error) == "Validation failed"
        assert isinstance(error, ValueError)

    def test_datasource_provider_credential_validation_error(self) -> None:
        error = DatasourceProviderCredentialValidationError("Credential validation failed")
        assert str(error) == "Credential validation failed"
        assert isinstance(error, ValueError)

    def test_datasource_not_supported_error(self) -> None:
        error = DatasourceNotSupportedError("Not supported")
        assert str(error) == "Not supported"
        assert isinstance(error, ValueError)

    def test_datasource_invoke_error(self) -> None:
        error = DatasourceInvokeError("Invoke error")
        assert str(error) == "Invoke error"
        assert isinstance(error, ValueError)

    def test_datasource_api_schema_error(self) -> None:
        error = DatasourceApiSchemaError("API schema error")
        assert str(error) == "API schema error"
        assert isinstance(error, ValueError)

    def test_datasource_engine_invoke_error(self) -> None:
        meta = DatasourceInvokeMeta.error_instance("Invoke failed")
        error = DatasourceEngineInvokeError(meta=meta)
        assert error.meta == meta
        assert isinstance(error, Exception)

    def test_datasource_engine_invoke_error_init(self) -> None:
        # Test initialization with meta
        meta = DatasourceInvokeMeta(time_cost=1.5, error="Engine failed")
        error = DatasourceEngineInvokeError(meta=meta)
        assert error.meta == meta
        assert error.meta.time_cost == 1.5
        assert error.meta.error == "Engine failed"
