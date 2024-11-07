from dify_oapi.core.enum import LogLevel


class Config:
    def __init__(self):
        self.domain: str | None = None
        self.timeout: float | None = None  # 客户端超时时间, 单位秒, 默认永不超时
        self.log_level: LogLevel = LogLevel.WARNING  # 日志级别, 默认为 WARNING
