#!/usr/bin/env python3
"""Fill blank required secrets in docker/.env for CI; sync DB/Redis passwords to middleware.env.

Postgres and Redis pick up DB_PASSWORD / REDIS_PASSWORD from docker/.env via compose
interpolation. Services that only load ./middleware.env (e.g. plugin_daemon) must use the
same values or they fail SASL auth against Postgres.
"""

from __future__ import annotations

import pathlib
import secrets
import string

REQUIRED_SECRET_VARS = frozenset(
    {
        "SECRET_KEY",
        "DB_PASSWORD",
        "REDIS_PASSWORD",
        "PLUGIN_DIFY_INNER_API_KEY",
        "MINIO_SECRET_KEY",
    }
)

SYNC_TO_MIDDLEWARE = ("DB_PASSWORD", "REDIS_PASSWORD")


def parse_simple_env(path: pathlib.Path) -> dict[str, str]:
    data: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" not in line or line.lstrip().startswith("#"):
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip()
    return data


def fill_docker_env(env_path: pathlib.Path) -> None:
    alphabet = string.ascii_letters + string.digits
    replacement = {k: "".join(secrets.choice(alphabet) for _ in range(48)) for k in REQUIRED_SECRET_VARS}

    lines = env_path.read_text(encoding="utf-8").splitlines()
    updated: list[str] = []
    found: set[str] = set()
    for line in lines:
        if "=" not in line or line.lstrip().startswith("#"):
            updated.append(line)
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key in replacement:
            found.add(key)
            if not value.strip():
                updated.append(f"{key}={replacement[key]}")
            else:
                updated.append(line)
            continue
        updated.append(line)

    missing = REQUIRED_SECRET_VARS - found
    if missing:
        raise SystemExit(f"Required secret vars missing or non-empty not found in docker/.env: {sorted(missing)}")

    env_path.write_text("\n".join(updated) + "\n", encoding="utf-8")


def sync_middleware_from_docker(docker_env_path: pathlib.Path, middleware_path: pathlib.Path) -> None:
    docker_vals = parse_simple_env(docker_env_path)
    need = {k: docker_vals[k] for k in SYNC_TO_MIDDLEWARE if docker_vals.get(k)}
    if not need:
        return

    lines = middleware_path.read_text(encoding="utf-8").splitlines()
    out: list[str] = []
    seen: set[str] = set()
    for line in lines:
        if "=" not in line or line.lstrip().startswith("#"):
            out.append(line)
            continue
        key, _ = line.split("=", 1)
        key = key.strip()
        if key in need:
            out.append(f"{key}={need[key]}")
            seen.add(key)
        else:
            out.append(line)
    for k in SYNC_TO_MIDDLEWARE:
        if k in need and k not in seen:
            out.append(f"{k}={need[k]}")
    middleware_path.write_text("\n".join(out) + "\n", encoding="utf-8")


def main() -> None:
    root = pathlib.Path(__file__).resolve().parents[2]
    env_path = root / "docker" / ".env"
    mw_path = root / "docker" / "middleware.env"
    if not env_path.is_file():
        raise SystemExit("docker/.env not found")
    if not mw_path.is_file():
        raise SystemExit("docker/middleware.env not found")

    fill_docker_env(env_path)
    sync_middleware_from_docker(env_path, mw_path)


if __name__ == "__main__":
    main()
