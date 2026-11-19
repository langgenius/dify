import re
from pathlib import Path

from dotenv import dotenv_values

BASE_API_AND_DOCKER_CONFIG_SET_DIFF: frozenset[str] = frozenset(
    (
        "AGENT_BACKEND_API_TOKEN",
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
        "AGENT_BACKEND_API_TOKEN",
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

REPO_ROOT = Path(__file__).resolve().parents[5]


def _api_config_set() -> set[str]:
    return set(dotenv_values(REPO_ROOT / "api" / ".env.example").keys())


def _docker_config_set(docker_dir: Path) -> set[str]:
    """Return keys documented in readable Docker templates, excluding local overrides.

    Include assignments, commented assignments, and explicit root .env instructions.
    The root .env.example must exist; read failures propagate without changing any files.
    """
    envs_dir = docker_dir / "envs"
    env_files = [docker_dir / ".env.example", *envs_dir.rglob("*.env.example"), *envs_dir.rglob("*.defaults")]
    docker_config_set: set[str] = set()
    for env_file_path in env_files:
        content = env_file_path.read_text()
        docker_config_set.update(dotenv_values(env_file_path, interpolate=False).keys())
        docker_config_set.update(re.findall(r"(?m)^[ \t]*#[ \t]*([A-Z_][A-Z0-9_]*)=", content))
        docker_config_set.update(re.findall(r"(?m)^# Set ([A-Z_][A-Z0-9_]*) in docker/\.env\b", content))
    return docker_config_set


def test_docker_config_set_includes_documented_keys_only(tmp_path: Path) -> None:
    """Given templates and local overrides, collect only keys documented in the templates."""
    envs_dir = tmp_path / "envs" / "core-services"
    envs_dir.mkdir(parents=True)
    (tmp_path / ".env.example").write_text("ROOT_KEY=value\n# ROOT_OPTIONAL=\n")
    (envs_dir / "service.defaults").write_text(
        "DEFAULT_KEY=${ROOT_KEY:-fallback}\n# OPTIONAL_KEY=\n  # INDENTED_KEY=value\n"
        "# Set COMPOSE_PORT in docker/.env; Compose needs it before loading service files.\n"
        "# Prose with NOT_A_KEY=value\n# NO_ASSIGNMENT\n"
    )
    (envs_dir / "provider.env.example").write_text("PROVIDER_KEY=value\n# PROVIDER_OPTIONAL=value\n")
    (tmp_path / ".env").write_text("LOCAL_ROOT_KEY=private\n")
    (envs_dir / "service.env").write_text("LOCAL_SERVICE_KEY=private\n")

    assert _docker_config_set(tmp_path) == {
        "ROOT_KEY",
        "ROOT_OPTIONAL",
        "DEFAULT_KEY",
        "OPTIONAL_KEY",
        "INDENTED_KEY",
        "COMPOSE_PORT",
        "PROVIDER_KEY",
        "PROVIDER_OPTIONAL",
    }


def test_api_env_keys_exist_in_docker_env_examples() -> None:
    """Require every non-exempt API setting to remain documented in Docker templates."""
    diff = _api_config_set() - _docker_config_set(REPO_ROOT / "docker") - BASE_API_AND_DOCKER_CONFIG_SET_DIFF

    assert not diff, f"API and Docker config sets are different with keys: {sorted(diff)}"


def test_api_env_keys_exist_in_docker_compose_env_examples() -> None:
    """Require every non-exempt API setting to remain documented for Docker Compose."""
    diff = _api_config_set() - _docker_config_set(REPO_ROOT / "docker") - BASE_API_AND_DOCKER_COMPOSE_CONFIG_SET_DIFF

    assert not diff, f"API and Docker Compose config sets are different with keys: {sorted(diff)}"
