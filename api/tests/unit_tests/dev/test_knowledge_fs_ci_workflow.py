from __future__ import annotations

import itertools
import json
import os
import shlex
import subprocess
from collections.abc import Iterator
from pathlib import Path
from typing import override

import pytest
import yaml

from dev.check_knowledge_fs_coverage import discover_core_coverage_paths

ROOT = Path(__file__).resolve().parents[4]


class _Yaml:
    """Typed view over a ``yaml.BaseLoader`` document, whose nodes are only mappings, sequences and strings."""

    def __init__(self, value: object) -> None:
        self.value = value

    def __getitem__(self, key: str) -> _Yaml:
        assert isinstance(self.value, dict), self.value
        return _Yaml(self.value[key])

    def get(self, key: str, default: str = "") -> _Yaml:
        assert isinstance(self.value, dict), self.value
        return _Yaml(self.value.get(key, default))

    def __iter__(self) -> Iterator[_Yaml]:
        assert isinstance(self.value, list), self.value
        return (_Yaml(item) for item in self.value)

    def __contains__(self, item: str) -> bool:
        assert isinstance(self.value, (str, list, dict)), self.value
        return item in self.value

    @override
    def __eq__(self, other: object) -> bool:
        return self.value == other

    def __bool__(self) -> bool:
        return bool(self.value)

    @property
    def text(self) -> str:
        assert isinstance(self.value, str), self.value
        return self.value


def _workflow(name: str) -> _Yaml:
    return _Yaml(yaml.load((ROOT / ".github/workflows" / name).read_text(), Loader=yaml.BaseLoader))


def _step(workflow: _Yaml, name: str, *, job: str = "quality") -> _Yaml:
    return next(step for step in workflow["jobs"][job]["steps"] if step["name"] == name)


def test_dify_dockerfile_has_only_existing_local_copy_sources() -> None:
    dockerfile = (ROOT / "api/Dockerfile").read_text()
    for line in dockerfile.splitlines():
        if not line.startswith("COPY ") or "--from=" in line:
            continue
        paths = [part for part in shlex.split(line)[1:] if not part.startswith("--")]
        for path in paths[:-1]:
            assert (ROOT / path).exists(), f"Missing Docker build context source: {path}"
    assert "AS knowledge-fs" not in dockerfile
    assert "COPY knowledge-fs/" not in dockerfile
    assert "nodejs=${NODE_PACKAGE_VERSION}" in dockerfile
    assert "poppler-utils" in dockerfile


def test_dify_gate_target_collection_includes_all_owned_integration_files(tmp_path: Path) -> None:
    workflow = _workflow("knowledge-fs-ci.yml")
    assert discover_core_coverage_paths(ROOT)
    command = _step(workflow, "Collect Dify KnowledgeFS gate targets")["run"].text
    subprocess.run(["bash", "-c", command], cwd=ROOT, env={**os.environ, "RUNNER_TEMP": str(tmp_path)}, check=True)
    manifest = tmp_path / "knowledge-fs-ci-targets"
    production = set((manifest / "production-files").read_bytes().decode().strip("\0").split("\0"))
    tests = set((manifest / "unit-test-files").read_bytes().decode().strip("\0").split("\0"))
    assert {
        "api/services/knowledge_fs/query_images.py",
        "api/services/knowledge_fs/service_query_image_upload.py",
        "api/controllers/service_api/knowledge_fs/resources.py",
        "api/models/enums.py",
        "api/models/model.py",
    } <= production
    assert {
        "api/tests/unit_tests/dev/test_knowledge_fs_ci_workflow.py",
        "api/tests/unit_tests/services/test_knowledge_fs_service_query_images.py",
        "api/tests/unit_tests/migrations/test_knowledge_fs_migration_chain.py",
    } <= tests
    assert all((ROOT / path).is_file() for path in production | tests)
    for name in (
        "Verify pinned KnowledgeFS contract",
        "Lint Dify KnowledgeFS integration",
        "Type-check Dify KnowledgeFS integration",
        "Test Dify KnowledgeFS unit surface",
        "Enforce Dify KnowledgeFS focused coverage",
        "Verify Dify Agent dependency lock",
        "Lint Dify Agent KnowledgeFS integration",
        "Type-check Dify Agent KnowledgeFS integration",
        "Test Dify Agent KnowledgeFS integration",
    ):
        assert _step(workflow, name)
    coverage = _step(workflow, "Enforce Dify KnowledgeFS focused coverage")["run"]
    assert "--minimum 90" in coverage
    assert "--glue-minimum 90" in coverage
    assert (
        "node --test .github/scripts/knowledge-deploy-gates.test.cjs"
        in _step(workflow, "Test deployment revision gates")["run"]
    )
    assert "--check" in _step(workflow, "Verify pinned KnowledgeFS contract")["run"]
    for step in workflow["jobs"]["quality"]["steps"]:
        assert step.get("working-directory") != "./knowledge-fs"
        assert "cd knowledge-fs" not in step.get("run", "")


@pytest.mark.parametrize(
    ("quality", "vectors", "skip"),
    list(itertools.product(["success", "failure", "cancelled", "skipped"], repeat=3)),
)
def test_required_dify_gate_status_fails_closed(quality: str, vectors: str, skip: str) -> None:
    workflow = _workflow("knowledge-fs-ci.yml")
    assert "vector-backends" in workflow["jobs"]["final"]["needs"]
    final = _step(workflow, "Finalize KnowledgeFS CI status", job="final")
    assert final["env"]["VECTOR_RESULT"] == "${{ needs.vector-backends.result }}"
    command = final["run"].text
    result = subprocess.run(
        ["bash", "-c", command],
        env={
            **os.environ,
            "EVENT_NAME": "push",
            "KNOWLEDGE_FS_CHANGED": "true",
            "QUALITY_RESULT": quality,
            "VECTOR_RESULT": vectors,
            "SKIP_RESULT": skip,
        },
        capture_output=True,
        check=False,
    )
    assert result.returncode == (0 if quality == vectors == "success" else 1)


def test_dify_deployment_has_one_owner_and_uses_tested_revision() -> None:
    workflow = _workflow("deploy-knowledge.yml")
    dev = _workflow("deploy-dev.yml")
    assert dev["on"]["workflow_run"]["branches"] == ["deploy/dev"]
    assert "deploy/konwledge" not in json.dumps(dev.value)
    assert workflow["on"]["workflow_run"]["workflows"] == ["Build and Push API & Web"]
    assert workflow["on"]["workflow_run"]["branches"] == ["deploy/konwledge"]
    assert workflow["concurrency"]["cancel-in-progress"] == "false"
    deploy = workflow["jobs"]["deploy"]
    assert int(deploy["timeout-minutes"].text) >= 335
    assert "workflow_run.event == 'push'" in deploy["if"]
    assert "head_repository.full_name == github.repository" in deploy["if"]
    checkout = _step(workflow, "Checkout tested deployment gates", job="deploy")
    assert checkout["with"]["ref"] == "${{ github.event.workflow_run.head_sha }}"
    assert checkout["with"]["persist-credentials"] == "false"
    remote = _step(workflow, "Deploy tested Dify revision while preserving KnowledgeFS", job="deploy")
    assert remote["if"] == "steps.gates.outputs.current == 'true'"
    assert remote["env"]["EXPECTED_DIFY_REVISION"] == "${{ github.event.workflow_run.head_sha }}"
    assert "EXPECTED_DIFY_REVISION" in remote["with"]["envs"]
    assert "--expected-revision" in remote["with"]["script"]
    assert "migrate.mjs" not in remote["with"]["script"]


@pytest.mark.parametrize("invalid", [None, "revision", "entrypoint"])
def test_remote_bridge_passes_exact_revision_or_refuses_to_execute(tmp_path: Path, invalid: str | None) -> None:
    workflow = _workflow("deploy-knowledge.yml")
    command = _step(workflow, "Deploy tested Dify revision while preserving KnowledgeFS", job="deploy")["with"][
        "script"
    ].text
    controller = tmp_path / "knowledge-fs-independent-deploy.py"
    controller.write_text(
        "import json, sys\nfrom pathlib import Path\n"
        "Path(__file__).with_name('arguments.json').write_text(json.dumps(sys.argv[1:]))\n"
    )
    wrapper = tmp_path / "deploy.sh"
    wrapper.write_text(
        "#!/usr/bin/env bash\nset -euo pipefail\nexec python3 "
        + shlex.quote(str(controller))
        + " --dify --project-dir "
        + shlex.quote(str(tmp_path))
        + (' "$@"\n' if invalid != "entrypoint" else "\n")
    )
    wrapper.chmod(0o700)
    revision = "a" * 40 if invalid != "revision" else "main"
    result = subprocess.run(
        ["bash", "-c", command],
        env={**os.environ, "DEPLOY_DIR": str(tmp_path), "EXPECTED_DIFY_REVISION": revision},
        capture_output=True,
        check=False,
    )
    arguments = tmp_path / "arguments.json"
    if invalid:
        assert result.returncode != 0
        assert not arguments.exists()
    else:
        assert result.returncode == 0, result.stderr.decode()
        assert json.loads(arguments.read_text()) == [
            "--dify",
            "--project-dir",
            str(tmp_path),
            "--expected-revision",
            revision,
        ]
