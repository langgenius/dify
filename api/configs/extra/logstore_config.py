from pydantic_settings import BaseSettings


class LogStoreConfig(BaseSettings):
    """Connection settings and migration controls for Aliyun LogStore."""

    ALIYUN_SLS_ACCESS_KEY_ID: str = ""
    ALIYUN_SLS_ACCESS_KEY_SECRET: str = ""
    ALIYUN_SLS_ENDPOINT: str = ""
    ALIYUN_SLS_REGION: str = ""
    ALIYUN_SLS_PROJECT_NAME: str = ""
    ALIYUN_SLS_LOGSTORE_TTL: int = 365
    ALIYUN_SLS_CHECK_CONNECTIVITY_TIMEOUT: int = 30
    LOGSTORE_SQL_ECHO: bool = False
    LOGSTORE_PG_MODE_ENABLED: bool = True

    LOGSTORE_DUAL_WRITE_ENABLED: bool = False
    LOGSTORE_DUAL_READ_ENABLED: bool = True

    # Keep workflow graphs in LogStore by default. Deployments may disable this
    # while migrating large graph payloads to another persistence owner.
    LOGSTORE_ENABLE_PUT_GRAPH_FIELD: bool = True
