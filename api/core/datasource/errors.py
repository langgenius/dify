from core.datasource.entities.datasource_entities import DatasourceInvokeMeta


class DatasourceProviderNotFoundError(ValueError):
    pass


class DatasourceNotFoundError(ValueError):
    pass


class DatasourceParameterValidationError(ValueError):
    pass


class DatasourceProviderCredentialValidationError(ValueError):
    pass


class DatasourceNotSupportedError(ValueError):
    pass


class DatasourceInvokeError(ValueError):
    pass


class DatasourceApiSchemaError(ValueError):
    pass


class DatasourceEngineInvokeError(Exception):
    meta: DatasourceInvokeMeta

    def __init__(self, meta, **kwargs):
        self.meta = meta
        super().__init__(**kwargs)
