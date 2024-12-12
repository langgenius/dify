from prometheus_client import Counter, Histogram

from configs import dify_config

app_request = Counter(
    name="app_request",
    documentation="The total count of APP requests",
    labelnames=["app_id", "tenant_id", "username"],
)
app_request_failed = Counter(
    name="app_request_failed",
    documentation="The failed count of APP requests",
    labelnames=["app_id", "tenant_id", "username"],
)
app_request_latency = Histogram(
    name="app_request_latency",
    documentation="The latency of APP requests",
    unit="seconds",
    labelnames=["app_id", "tenant_id", "username"],
    buckets=dify_config.HISTOGRAM_BUCKETS_5MIN,
)
app_input_tokens = Counter(
    name="app_input_tokens",
    documentation="The input tokens cost by APP requests",
    labelnames=["app_id", "tenant_id", "username"],
)
app_output_tokens = Counter(
    name="app_output_tokens",
    documentation="The output tokens cost by APP requests",
    labelnames=["app_id", "tenant_id", "username"],
)
app_total_tokens = Counter(
    name="app_total_tokens",
    documentation="The total tokens cost by APP requests",
    labelnames=["app_id", "tenant_id", "username"],
)
