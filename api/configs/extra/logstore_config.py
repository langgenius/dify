from pydantic_settings import BaseSettings


class LogStoreConfig(BaseSettings):
    """Migration controls for repositories backed by Aliyun LogStore."""

    LOGSTORE_DUAL_WRITE_ENABLED: bool = False

    # Keep workflow graphs in LogStore by default. Deployments may disable this
    # while migrating large graph payloads to another persistence owner.
    LOGSTORE_ENABLE_PUT_GRAPH_FIELD: bool = True
