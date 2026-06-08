from unittest.mock import MagicMock

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
    def test_datasource_provider_not_found_error(self):
        error = DatasourceProviderNotFoundError("Provider not found")
        assert str(error) == "Provider not found"
        assert isinstance(error, ValueError)

    def test_datasource_not_found_error(self):
        error = DatasourceNotFoundError("Datasource not found")
        assert str(error) == "Datasource not found"
        assert isinstance(error, ValueError)

    def test_datasource_parameter_validation_error(self):
        error = DatasourceParameterValidationError("Validation failed")
        assert str(error) == "Validation failed"
        assert isinstance(error, ValueError)

    def test_datasource_provider_credential_validation_error(self):
        error = DatasourceProviderCredentialValidationError("Credential validation failed")
        assert str(error) == "Credential validation failed"
        assert isinstance(error, ValueError)

    def test_datasource_not_supported_error(self):
        error = DatasourceNotSupportedError("Not supported")
        assert str(error) == "Not supported"
        assert isinstance(error, ValueError)

    def test_datasource_invoke_error(self):
        error = DatasourceInvokeError("Invoke error")
        assert str(error) == "Invoke error"
        assert isinstance(error, ValueError)

    def test_datasource_api_schema_error(self):
        error = DatasourceApiSchemaError("API schema error")
        assert str(error) == "API schema error"
        assert isinstance(error, ValueError)

    def test_datasource_engine_invoke_error(self):
        mock_meta = MagicMock(spec=DatasourceInvokeMeta)
        error = DatasourceEngineInvokeError(meta=mock_meta)
        assert error.meta == mock_meta
        assert isinstance(error, Exception)

    def test_datasource_engine_invoke_error_init(self):
        # Test initialization with meta
        meta = DatasourceInvokeMeta(time_cost=1.5, error="Engine failed")
        error = DatasourceEngineInvokeError(meta=meta)
        assert error.meta == meta
        assert error.meta.time_cost == 1.5
        assert error.meta.error == "Engine failed"
