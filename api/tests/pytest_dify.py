"""Pytest support helpers for Dify backend test environment setup.

The helpers in this module keep Docker and environment preparation behind explicit
pytest options so ordinary unit-test runs do not start external services.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

DEFAULT_LOG_FORMAT = "%(asctime)s,%(msecs)d %(levelname)-2s [%(filename)s:%(lineno)d] %(req_id)s %(message)s"
DEFAULT_MIDDLEWARE_SERVICES = ("db_postgres", "redis", "sandbox", "ssrf_proxy")
DEFAULT_VDB_SERVICES = ("db_postgres", "redis", "weaviate", "qdrant", "pgvector", "chroma")
VDB_SERVICE_PROFILES = {
    "db_postgres": "postgresql",
    "weaviate": "weaviate",
    "qdrant": "qdrant",
    "couchbase-server": "couchbase",
    "etcd": "milvus",
    "minio": "milvus",
    "milvus-standalone": "milvus",
    "pgvecto-rs": "pgvecto-rs",
    "pgvector": "pgvector",
    "chroma": "chroma",
    "elasticsearch": "elasticsearch",
    "oceanbase": "oceanbase",
}


def parse_services(value: str) -> list[str]:
    """Parse a comma-separated service list from a pytest option."""
    return [service.strip() for service in value.split(",") if service.strip()]


def ensure_backend_test_environment(repo_root: Path) -> None:
    """Set deterministic defaults needed before test conftests import application config."""
    integration_tests_dir = repo_root / "api" / "tests" / "integration_tests"
    test_env_file = integration_tests_dir / ".env"
    test_env_example_file = integration_tests_dir / ".env.example"
    vdb_env_file = integration_tests_dir / "vdb.env"

    if "DIFY_TEST_ENV_FILE" not in os.environ:
        os.environ["DIFY_TEST_ENV_FILE"] = str(test_env_file if test_env_file.exists() else test_env_example_file)

    if "DIFY_VDB_TEST_ENV_FILE" not in os.environ and vdb_env_file.exists():
        os.environ["DIFY_VDB_TEST_ENV_FILE"] = str(vdb_env_file)

    os.environ["LOG_OUTPUT_FORMAT"] = "text"
    os.environ["LOG_FORMAT"] = DEFAULT_LOG_FORMAT
    os.environ.setdefault("STORAGE_TYPE", "opendal")
    os.environ.setdefault("OPENDAL_SCHEME", "fs")
    os.environ.setdefault("OPENDAL_FS_ROOT", "/tmp/dify-storage")
    Path(os.environ["OPENDAL_FS_ROOT"]).mkdir(parents=True, exist_ok=True)


def ensure_compose_env_files(repo_root: Path) -> None:
    """Create ignored Docker env files from examples when Docker-backed tests request compose."""
    docker_dir = repo_root / "docker"
    env_file = docker_dir / ".env"
    env_example_file = docker_dir / ".env.example"
    middleware_env_file = docker_dir / "middleware.env"
    middleware_env_example_file = docker_dir / "envs" / "middleware.env.example"

    if not env_file.exists():
        shutil.copyfile(env_example_file, env_file)
    if not middleware_env_file.exists():
        shutil.copyfile(middleware_env_example_file, middleware_env_file)


@dataclass(frozen=True)
class DockerComposeStack:
    """A docker compose project that pytest can start before collection and stop at shutdown."""

    name: str
    project_name: str
    repo_root: Path
    compose_files: tuple[Path, ...]
    env_file: Path
    services: tuple[str, ...]
    profiles: tuple[str, ...] = ()
    ready_delay_seconds: float = 0.0
    warmup_urls: tuple[str, ...] = ()

    def _compose_command(self) -> list[str]:
        command = [
            "docker",
            "compose",
            "--project-name",
            self.project_name,
            "--env-file",
            str(self.env_file),
        ]
        for profile in self.profiles:
            command.extend(("--profile", profile))
        for compose_file in self.compose_files:
            command.extend(("-f", str(compose_file)))
        return command

    def up(self) -> None:
        """Start the configured services and wait for compose healthchecks when supported."""
        wait_command = self._compose_command() + [
            "up",
            "-d",
            "--wait",
            "--wait-timeout",
            "180",
            *self.services,
        ]
        completed = subprocess.run(wait_command, cwd=self.repo_root, text=True, capture_output=True)
        if completed.returncode == 0:
            if self.ready_delay_seconds > 0:
                time.sleep(self.ready_delay_seconds)
            self._warm_up()
            return

        combined_output = f"{completed.stdout}\n{completed.stderr}"
        if "unknown flag: --wait" in combined_output or "unknown flag: wait-timeout" in combined_output:
            subprocess.run(self._compose_command() + ["up", "-d", *self.services], cwd=self.repo_root, check=True)
            time.sleep(5)
            self._warm_up()
            return

        raise subprocess.CalledProcessError(
            returncode=completed.returncode,
            cmd=wait_command,
            output=completed.stdout,
            stderr=completed.stderr,
        )

    def down(self) -> None:
        """Stop services started for this pytest run."""
        subprocess.run(self._compose_command() + ["down"], cwd=self.repo_root, check=True)

    def _warm_up(self) -> None:
        for url in self.warmup_urls:
            deadline = time.monotonic() + 30.0
            last_error: Exception | None = None
            while time.monotonic() < deadline:
                try:
                    with urllib.request.urlopen(url, timeout=5) as response:
                        if 200 <= response.status < 300:
                            break
                except urllib.error.HTTPError as error:
                    if error.code < 500:
                        break
                    last_error = error
                except (OSError, urllib.error.URLError) as error:
                    last_error = error
                time.sleep(1)
            else:
                raise RuntimeError(f"Timed out waiting for {self.name} warmup URL {url}") from last_error


def build_middleware_stack(repo_root: Path, services: list[str]) -> DockerComposeStack:
    """Build the middleware compose stack used by API integration tests."""
    return DockerComposeStack(
        name="middleware",
        project_name="dify-pytest-middleware",
        repo_root=repo_root,
        compose_files=(repo_root / "docker" / "docker-compose.middleware.yaml",),
        env_file=repo_root / "docker" / "middleware.env",
        services=tuple(services),
        ready_delay_seconds=5.0,
        warmup_urls=("http://127.0.0.1:8194/health",),
    )


def build_vdb_stack(repo_root: Path, services: list[str]) -> DockerComposeStack:
    """Build the vector-store compose stack used by VDB integration tests."""
    profiles = tuple(
        dict.fromkeys(profile for service in services if (profile := VDB_SERVICE_PROFILES.get(service)) is not None)
    )
    service_names = set(services)
    warmup_urls = []
    if "qdrant" in service_names:
        warmup_urls.append("http://127.0.0.1:6333/collections")
    if "chroma" in service_names:
        warmup_urls.append("http://127.0.0.1:8000/api/v2/auth/identity")
    return DockerComposeStack(
        name="vdb",
        project_name="dify-pytest-vdb",
        repo_root=repo_root,
        compose_files=(
            repo_root / "docker" / "docker-compose.yaml",
            repo_root / "docker" / "docker-compose.pytest.ports.yaml",
        ),
        env_file=repo_root / "docker" / ".env",
        services=tuple(services),
        profiles=profiles,
        warmup_urls=tuple(warmup_urls),
    )
