import os
import subprocess
from pathlib import Path

from tests.pytest_dify import (
    DEFAULT_LOG_FORMAT,
    DockerComposeStack,
    build_middleware_stack,
    build_vdb_stack,
    ensure_backend_test_environment,
    ensure_compose_env_files,
    parse_services,
)


def test_ensure_backend_test_environment_uses_example_env_and_stable_logging(
    tmp_path: Path,
    monkeypatch,
):
    repo_root = tmp_path
    integration_tests_dir = repo_root / "api" / "tests" / "integration_tests"
    integration_tests_dir.mkdir(parents=True)
    env_example = integration_tests_dir / ".env.example"
    env_example.write_text("LOG_LEVEL=INFO\n")
    storage_root = repo_root / "storage"

    monkeypatch.setenv("LOG_FORMAT", "json")
    monkeypatch.delenv("LOG_OUTPUT_FORMAT", raising=False)
    monkeypatch.delenv("DIFY_TEST_ENV_FILE", raising=False)
    monkeypatch.delenv("DIFY_VDB_TEST_ENV_FILE", raising=False)
    monkeypatch.delenv("STORAGE_TYPE", raising=False)
    monkeypatch.delenv("OPENDAL_SCHEME", raising=False)
    monkeypatch.setenv("OPENDAL_FS_ROOT", str(storage_root))

    ensure_backend_test_environment(repo_root)

    assert os.environ["DIFY_TEST_ENV_FILE"] == str(env_example)
    assert "DIFY_VDB_TEST_ENV_FILE" not in os.environ
    assert os.environ["LOG_OUTPUT_FORMAT"] == "text"
    assert os.environ["LOG_FORMAT"] == DEFAULT_LOG_FORMAT
    assert os.environ["STORAGE_TYPE"] == "opendal"
    assert os.environ["OPENDAL_SCHEME"] == "fs"
    assert storage_root.is_dir()


def test_ensure_compose_env_files_copies_missing_env_files(tmp_path: Path):
    docker_dir = tmp_path / "docker"
    envs_dir = docker_dir / "envs"
    envs_dir.mkdir(parents=True)
    (docker_dir / ".env.example").write_text("APP_WEB_URL=http://localhost\n")
    (envs_dir / "middleware.env.example").write_text("DB_PASSWORD=difyai123456\n")

    ensure_compose_env_files(tmp_path)

    assert (docker_dir / ".env").read_text() == "APP_WEB_URL=http://localhost\n"
    assert (docker_dir / "middleware.env").read_text() == "DB_PASSWORD=difyai123456\n"


def test_parse_services_discards_empty_items():
    assert parse_services(" db_postgres, redis,, sandbox ") == ["db_postgres", "redis", "sandbox"]


def test_stack_up_uses_waiting_compose_command(monkeypatch, tmp_path: Path):
    calls: list[list[str]] = []

    def fake_run(args, **kwargs):
        calls.append(args)
        return subprocess.CompletedProcess(args=args, returncode=0)

    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr("time.sleep", lambda _: None)

    stack = DockerComposeStack(
        name="middleware",
        project_name="dify-pytest-middleware",
        repo_root=tmp_path,
        compose_files=(tmp_path / "docker-compose.yaml",),
        env_file=tmp_path / "middleware.env",
        services=("db_postgres", "redis"),
    )

    stack.up()

    assert calls == [
        [
            "docker",
            "compose",
            "--project-name",
            "dify-pytest-middleware",
            "--env-file",
            str(tmp_path / "middleware.env"),
            "-f",
            str(tmp_path / "docker-compose.yaml"),
            "up",
            "-d",
            "--wait",
            "--wait-timeout",
            "180",
            "db_postgres",
            "redis",
        ]
    ]


def test_builders_use_expected_compose_files(tmp_path: Path):
    middleware = build_middleware_stack(tmp_path, ["db_postgres"])
    vdb = build_vdb_stack(tmp_path, ["weaviate", "qdrant"])

    assert middleware.compose_files == (tmp_path / "docker" / "docker-compose.middleware.yaml",)
    assert middleware.env_file == tmp_path / "docker" / "middleware.env"
    assert middleware.ready_delay_seconds == 5.0
    assert vdb.compose_files == (
        tmp_path / "docker" / "docker-compose.yaml",
        tmp_path / "docker" / "docker-compose.pytest.ports.yaml",
    )
    assert vdb.env_file == tmp_path / "docker" / ".env"
    assert vdb.profiles == ("weaviate", "qdrant")
