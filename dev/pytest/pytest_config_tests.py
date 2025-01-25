import yaml  # type: ignore
from dotenv import dotenv_values
from pathlib import Path

BASE_API_AND_DOCKER_CONFIG_SET_DIFF = {
    "APP_MAX_EXECUTION_TIME",
    "BATCH_UPLOAD_LIMIT",
    "CELERY_BEAT_SCHEDULER_TIME",
    "CODE_EXECUTION_API_KEY",
    "HTTP_REQUEST_MAX_CONNECT_TIMEOUT",
    "HTTP_REQUEST_MAX_READ_TIMEOUT",
    "HTTP_REQUEST_MAX_WRITE_TIMEOUT",
    "KEYWORD_DATA_SOURCE_TYPE",
    "LOGIN_LOCKOUT_DURATION",
    "LOG_FORMAT",
    "OCI_ACCESS_KEY",
    "OCI_BUCKET_NAME",
    "OCI_ENDPOINT",
    "OCI_REGION",
    "OCI_SECRET_KEY",
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
    DIFF_API_WITH_DOCKER = (
        API_CONFIG_SET - DOCKER_CONFIG_SET - BASE_API_AND_DOCKER_CONFIG_SET_DIFF
    )
    if DIFF_API_WITH_DOCKER:
        print(
            f"API and Docker config sets are different with key: {DIFF_API_WITH_DOCKER}"
        )
        raise Exception("API and Docker config sets are different")
    DIFF_API_WITH_DOCKER_COMPOSE = (
        API_CONFIG_SET
        - DOCKER_COMPOSE_CONFIG_SET
        - BASE_API_AND_DOCKER_COMPOSE_CONFIG_SET_DIFF
    )
    if DIFF_API_WITH_DOCKER_COMPOSE:
        print(
            f"API and Docker Compose config sets are different with key: {DIFF_API_WITH_DOCKER_COMPOSE}"
        )
        raise Exception("API and Docker Compose config sets are different")
    print("All tests passed!")


if __name__ == "__main__":
    test_yaml_config()
