from pathlib import Path

from dotenv import dotenv_values

BASE_API_AND_DOCKER_CONFIG_SET_DIFF: frozenset[str] = frozenset(
    (
        "APP_MAX_EXECUTION_TIME",
        "BATCH_UPLOAD_LIMIT",
        "CELERY_BEAT_SCHEDULER_TIME",
        "CODE_EXECUTION_API_KEY",
        "HTTP_REQUEST_MAX_CONNECT_TIMEOUT",
        "HTTP_REQUEST_MAX_READ_TIMEOUT",
        "HTTP_REQUEST_MAX_WRITE_TIMEOUT",
        "INNER_API_KEY",
        "INNER_API_KEY_FOR_PLUGIN",
        "KEYWORD_DATA_SOURCE_TYPE",
        "LOGIN_LOCKOUT_DURATION",
        "LOG_FORMAT",
        "OCI_ACCESS_KEY",
        "OCI_BUCKET_NAME",
        "OCI_ENDPOINT",
        "OCI_REGION",
        "OCI_SECRET_KEY",
        "PLUGIN_DAEMON_KEY",
        "PLUGIN_DAEMON_URL",
        "PLUGIN_REMOTE_INSTALL_HOST",
        "PLUGIN_REMOTE_INSTALL_PORT",
        "REDIS_DB",
        "RESEND_API_URL",
        "RESPECT_XFORWARD_HEADERS_ENABLED",
        "SENTRY_DSN",
        "SSRF_DEFAULT_CONNECT_TIME_OUT",
        "SSRF_DEFAULT_MAX_RETRIES",
        "SSRF_DEFAULT_READ_TIME_OUT",
        "SSRF_DEFAULT_TIME_OUT",
        "SSRF_DEFAULT_WRITE_TIME_OUT",
        "UPSTASH_VECTOR_TOKEN",
        "UPSTASH_VECTOR_URL",
        "USING_UGC_INDEX",
        "WEAVIATE_BATCH_SIZE",
    )
)

BASE_API_AND_DOCKER_COMPOSE_CONFIG_SET_DIFF: frozenset[str] = frozenset(
    (
        "BATCH_UPLOAD_LIMIT",
        "CELERY_BEAT_SCHEDULER_TIME",
        "HTTP_REQUEST_MAX_CONNECT_TIMEOUT",
        "HTTP_REQUEST_MAX_READ_TIMEOUT",
        "HTTP_REQUEST_MAX_WRITE_TIMEOUT",
        "INNER_API_KEY",
        "INNER_API_KEY_FOR_PLUGIN",
        "KEYWORD_DATA_SOURCE_TYPE",
        "LOGIN_LOCKOUT_DURATION",
        "LOG_FORMAT",
        "OPENDAL_FS_ROOT",
        "OPENDAL_S3_ACCESS_KEY_ID",
        "OPENDAL_S3_BUCKET",
        "OPENDAL_S3_ENDPOINT",
        "OPENDAL_S3_REGION",
        "OPENDAL_S3_ROOT",
        "OPENDAL_S3_SECRET_ACCESS_KEY",
        "OPENDAL_S3_SERVER_SIDE_ENCRYPTION",
        "PGVECTOR_MAX_CONNECTION",
        "PGVECTOR_MIN_CONNECTION",
        "PGVECTO_RS_DATABASE",
        "PGVECTO_RS_HOST",
        "PGVECTO_RS_PASSWORD",
        "PGVECTO_RS_PORT",
        "PGVECTO_RS_USER",
        "PLUGIN_DAEMON_KEY",
        "PLUGIN_DAEMON_URL",
        "PLUGIN_REMOTE_INSTALL_HOST",
        "PLUGIN_REMOTE_INSTALL_PORT",
        "RESPECT_XFORWARD_HEADERS_ENABLED",
        "SCARF_NO_ANALYTICS",
        "SSRF_DEFAULT_CONNECT_TIME_OUT",
        "SSRF_DEFAULT_MAX_RETRIES",
        "SSRF_DEFAULT_READ_TIME_OUT",
        "SSRF_DEFAULT_TIME_OUT",
        "SSRF_DEFAULT_WRITE_TIME_OUT",
        "STORAGE_OPENDAL_SCHEME",
        "SUPABASE_API_KEY",
        "SUPABASE_BUCKET_NAME",
        "SUPABASE_URL",
        "USING_UGC_INDEX",
        "VIKINGDB_CONNECTION_TIMEOUT",
        "VIKINGDB_SOCKET_TIMEOUT",
        "WEAVIATE_BATCH_SIZE",
    )
)

REPO_ROOT = Path(__file__).resolve().parents[4]


def _api_config_set() -> set[str]:
    return set(dotenv_values(REPO_ROOT / "api" / ".env.example").keys())


def _docker_config_set() -> set[str]:
    docker_config_set = set(dotenv_values(REPO_ROOT / "docker" / ".env.example").keys())
    envs_dir = REPO_ROOT / "docker" / "envs"
    if envs_dir.exists():
        for env_file_path in envs_dir.rglob("*.env.example"):
            docker_config_set.update(dotenv_values(env_file_path).keys())
    return docker_config_set


def test_api_env_keys_exist_in_docker_env_examples():
    diff = _api_config_set() - _docker_config_set() - BASE_API_AND_DOCKER_CONFIG_SET_DIFF

    assert not diff, f"API and Docker config sets are different with keys: {sorted(diff)}"


def test_api_env_keys_exist_in_docker_compose_env_examples():
    diff = _api_config_set() - _docker_config_set() - BASE_API_AND_DOCKER_COMPOSE_CONFIG_SET_DIFF

    assert not diff, f"API and Docker Compose config sets are different with keys: {sorted(diff)}"
