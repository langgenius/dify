import httpx

RAW_RESPONSE_HEADER = "X-Stainless-Raw-Response"
# 通过 `Timeout` 控制接口`connect` 和 `read` 超时时间，默认为`timeout=300.0, connect=8.0`
ZHIPUAI_DEFAULT_TIMEOUT = httpx.Timeout(timeout=300.0, connect=8.0)
# 通过 `retry` 参数控制重试次数，默认为3次
ZHIPUAI_DEFAULT_MAX_RETRIES = 3
# 通过 `Limits` 控制最大连接数和保持连接数，默认为`max_connections=50, max_keepalive_connections=10`
ZHIPUAI_DEFAULT_LIMITS = httpx.Limits(max_connections=50, max_keepalive_connections=10)

INITIAL_RETRY_DELAY = 0.5
MAX_RETRY_DELAY = 8.0
