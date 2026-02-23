from pathlib import Path

import yaml  # type: ignore
from dotenv import dotenv_values

SSRF_TIMEOUT_CONFIG_KEYS = {"SSRF_REQUEST_TIMEOUT", "SSRF_READ_TIMEOUT"}
SSRF_PROXY_ENV_DEFAULTS = {
    "SSRF_REQUEST_TIMEOUT": "${SSRF_REQUEST_TIMEOUT:-1200}",
    "SSRF_READ_TIMEOUT": "${SSRF_READ_TIMEOUT:-1200}",
}
SSRF_PROXY_TIMEOUT_TEMPLATE_LINES = {
    "request_timeout ${SSRF_REQUEST_TIMEOUT} seconds",
    "read_timeout ${SSRF_READ_TIMEOUT} seconds",
}

BASE_API_AND_DOCKER_CONFIG_SET_DIFF = {
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
    "WEAVIATE_GRPC_ENABLED",
}

BASE_API_AND_DOCKER_COMPOSE_CONFIG_SET_DIFF = {
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
    "WEAVIATE_GRPC_ENABLED",
}

API_CONFIG_SET = set(dotenv_values(Path("api") / Path(".env.example")).keys())
DOCKER_CONFIG_SET = set(dotenv_values(Path("docker") / Path(".env.example")).keys())
DOCKER_COMPOSE_CONFIG_SET = set()

with open(Path("docker") / Path("docker-compose.yaml")) as f:
    DOCKER_COMPOSE_CONFIG_SET = set(yaml.safe_load(f.read())["x-shared-env"].keys())


def test_yaml_config():
    # python set == operator is used to compare two sets
    DIFF_API_WITH_DOCKER = API_CONFIG_SET - DOCKER_CONFIG_SET - BASE_API_AND_DOCKER_CONFIG_SET_DIFF
    if DIFF_API_WITH_DOCKER:
        print(f"API and Docker config sets are different with key: {DIFF_API_WITH_DOCKER}")
        raise Exception("API and Docker config sets are different")
    DIFF_API_WITH_DOCKER_COMPOSE = (
        API_CONFIG_SET - DOCKER_COMPOSE_CONFIG_SET - BASE_API_AND_DOCKER_COMPOSE_CONFIG_SET_DIFF
    )
    if DIFF_API_WITH_DOCKER_COMPOSE:
        print(f"API and Docker Compose config sets are different with key: {DIFF_API_WITH_DOCKER_COMPOSE}")
        raise Exception("API and Docker Compose config sets are different")

    missing_ssrf_timeout_keys_in_docker = SSRF_TIMEOUT_CONFIG_KEYS - DOCKER_CONFIG_SET
    if missing_ssrf_timeout_keys_in_docker:
        print(f"Missing SSRF timeout keys in docker/.env.example: {missing_ssrf_timeout_keys_in_docker}")
        raise Exception("docker/.env.example is missing SSRF timeout keys")

    missing_ssrf_timeout_keys_in_compose = SSRF_TIMEOUT_CONFIG_KEYS - DOCKER_COMPOSE_CONFIG_SET
    if missing_ssrf_timeout_keys_in_compose:
        print(f"Missing SSRF timeout keys in docker/docker-compose.yaml x-shared-env: {missing_ssrf_timeout_keys_in_compose}")
        raise Exception("docker-compose.yaml x-shared-env is missing SSRF timeout keys")

    docker_compose_template = (Path("docker") / Path("docker-compose-template.yaml")).read_text(encoding="utf-8")
    for key, expected_value in SSRF_PROXY_ENV_DEFAULTS.items():
        expected_line = f"{key}: {expected_value}"
        if expected_line not in docker_compose_template:
            print(
                "Missing SSRF proxy timeout env mapping in docker-compose-template.yaml: "
                f"{expected_line!r}"
            )
            raise Exception("docker-compose-template.yaml is missing SSRF timeout env mapping")

    squid_template = (Path("docker") / Path("ssrf_proxy") / Path("squid.conf.template")).read_text(encoding="utf-8")
    for line in SSRF_PROXY_TIMEOUT_TEMPLATE_LINES:
        if line not in squid_template:
            print(f"Missing Squid timeout template line: {line!r}")
            raise Exception("squid.conf.template is missing SSRF timeout template line")

    print("All tests passed!")


if __name__ == "__main__":
    test_yaml_config()
