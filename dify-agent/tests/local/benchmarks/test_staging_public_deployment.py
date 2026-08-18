from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

from benchmarks.staging_public_deployment import (
    collect_staging_backend_deployment_evidence,
    evaluate_staging_backend_deployment,
)


def _deployment(replicas: int) -> dict[str, Any]:
    return {
        "metadata": {"generation": 7},
        "spec": {
            "replicas": replicas,
            "template": {
                "spec": {
                    "containers": [
                        {
                            "name": "dify-agent-backend",
                            "image": "registry/agent@sha256:abc",
                        }
                    ]
                }
            },
        },
        "status": {
            "observedGeneration": 7,
            "updatedReplicas": replicas,
            "readyReplicas": replicas,
            "availableReplicas": replicas,
        },
    }


def _pod(index: int, *, node_name: str | None = None, cpu: str = "2", restarts: int = 0) -> dict[str, Any]:
    name = f"agent-{index}"
    return {
        "metadata": {"name": name, "uid": f"uid-{index}"},
        "spec": {
            "nodeName": node_name or f"node-{index}",
            "containers": [
                {
                    "name": "dify-agent-backend",
                    "image": "registry/agent@sha256:abc",
                    "resources": {
                        "requests": {"cpu": cpu, "memory": "2Gi"},
                        "limits": {"cpu": cpu, "memory": "2048Mi"},
                    },
                }
            ],
        },
        "status": {
            "containerStatuses": [
                {
                    "name": "dify-agent-backend",
                    "ready": True,
                    "restartCount": restarts,
                    "imageID": "registry/agent@sha256:abc",
                }
            ]
        },
    }


def _node(index: int) -> dict[str, Any]:
    return {
        "metadata": {
            "name": f"node-{index}",
            "labels": {"topology.kubernetes.io/zone": f"zone-{index % 3}"},
        }
    }


def _application(*, enabled: bool, self_heal: bool = True) -> dict[str, Any]:
    return {"spec": {"syncPolicy": {"automated": {"enabled": enabled, "selfHeal": self_heal}}}}


def _collector_deployment(*, replicas: int = 1) -> dict[str, Any]:
    return {
        "metadata": {"generation": 11},
        "spec": {
            "replicas": replicas,
            "template": {
                "spec": {
                    "containers": [
                        {
                            "name": "dify-dataset-worker",
                            "image": "registry/api@sha256:collector",
                        }
                    ]
                }
            },
        },
        "status": {
            "observedGeneration": 11,
            "updatedReplicas": replicas,
            "readyReplicas": replicas,
            "availableReplicas": replicas,
        },
    }


def _collector_pod(*, ready: bool = True, restarts: int = 0) -> dict[str, Any]:
    return {
        "metadata": {"name": "dataset-worker-0", "uid": "collector-uid-0"},
        "spec": {
            "containers": [
                {
                    "name": "dify-dataset-worker",
                    "image": "registry/api@sha256:collector",
                }
            ]
        },
        "status": {
            "containerStatuses": [
                {
                    "name": "dify-dataset-worker",
                    "ready": ready,
                    "restartCount": restarts,
                    "imageID": "registry/api@sha256:collector",
                }
            ]
        },
    }


def _configured_deployment(replicas: int) -> dict[str, Any]:
    deployment = _deployment(replicas)
    container = deployment["spec"]["template"]["spec"]["containers"][0]
    container.update(
        {
            "command": ["python"],
            "args": ["-m", "app"],
            "envFrom": [
                {"configMapRef": {"name": "agent-config"}},
                {"secretRef": {"name": "agent-secret"}},
            ],
        }
    )
    return deployment


def _config_map(*, resource_version: str = "101", value: str = "two") -> dict[str, Any]:
    return {
        "metadata": {"uid": "config-uid", "resourceVersion": resource_version},
        "data": {"UVICORN_WORKERS": value},
    }


def _evaluate(
    replicas: int,
    *,
    deployment: dict[str, Any] | None = None,
    config_maps: dict[str, dict[str, Any]] | None = None,
    secret_metadata: dict[str, dict[str, Any]] | None = None,
    pods: list[dict[str, Any]] | None = None,
    child_enabled: bool = False,
    collector_deployment: dict[str, Any] | None = None,
    collector_pods: list[dict[str, Any]] | None = None,
    collector_probe: tuple[bool, bool, bool, bool] = (True, True, False, True),
):
    pod_items = pods or [_pod(index) for index in range(replicas)]
    collector_pod_items = collector_pods or [_collector_pod()]
    return evaluate_staging_backend_deployment(
        expected_replicas=replicas,
        kube_context="staging-main",
        namespace="dify-staging",
        deployment_name="dify-agent-backend",
        service_name="dify-agent-backend-svc",
        container_name="dify-agent-backend",
        deployment=deployment or _deployment(replicas),
        pods=pod_items,
        endpoints={"subsets": [{"addresses": [{} for _ in range(replicas)]}]},
        nodes=[_node(index) for index in range(max(replicas, 3))],
        child_application=_application(enabled=child_enabled),
        parent_application=_application(enabled=True),
        worker_evidence={pod["metadata"]["name"]: (2, 2) for pod in pod_items},
        collector_deployment_name="dify-dataset-worker",
        collector_container_name="dify-dataset-worker",
        collector_deployment=collector_deployment or _collector_deployment(),
        collector_pods=collector_pod_items,
        collector_probe_evidence={
            pod["metadata"]["name"]: collector_probe
            for pod in collector_pod_items
            if pod["status"]["containerStatuses"][0]["ready"] is True
        },
        config_maps=config_maps,
        secret_metadata=secret_metadata,
    )


def test_valid_replica_stage_requires_fixed_resources_workers_and_topology() -> None:
    evidence = _evaluate(4)
    assert evidence.valid is True
    assert evidence.ready_endpoints == 4
    assert len({pod.node_name for pod in evidence.pods}) == 4
    assert {pod.observed_workers for pod in evidence.pods} == {2}
    assert {pod.image_id for pod in evidence.pods} == {"registry/agent@sha256:abc"}
    assert evidence.collector_preflight.valid is True
    assert evidence.collector_preflight.agent_backend_openapi_reachable is True
    assert evidence.collector_preflight.deployment_generation == 11
    assert evidence.collector_preflight.deployment_observed_generation == 11
    assert evidence.collector_preflight.pod_uid == "collector-uid-0"
    assert evidence.collector_preflight.pod_image_id == "registry/api@sha256:collector"
    assert len(evidence.effective_agent_config_fingerprint) == 64


def test_worker_probe_excludes_its_own_marker_bearing_python_process() -> None:
    source = __import__("benchmarks.staging_public_deployment", fromlist=["_WORKER_PROBE"])._WORKER_PROBE

    assert "os.getpid()" in source
    assert "from multiprocessing.spawn import spawn_main" in source


def test_effective_config_fingerprint_detects_template_configmap_and_secret_drift() -> None:
    deployment = _configured_deployment(1)
    baseline = _evaluate(
        1,
        deployment=deployment,
        config_maps={"agent-config": _config_map()},
        secret_metadata={"agent-secret": {"uid": "secret-uid", "resourceVersion": "201"}},
    )

    changed_template = _configured_deployment(1)
    changed_template["spec"]["template"]["spec"]["containers"][0]["args"] = [
        "-m",
        "other",
    ]
    template_evidence = _evaluate(
        1,
        deployment=changed_template,
        config_maps={"agent-config": _config_map()},
        secret_metadata={"agent-secret": {"uid": "secret-uid", "resourceVersion": "201"}},
    )
    config_map_evidence = _evaluate(
        1,
        deployment=deployment,
        config_maps={"agent-config": _config_map(resource_version="102", value="three")},
        secret_metadata={"agent-secret": {"uid": "secret-uid", "resourceVersion": "201"}},
    )
    secret_evidence = _evaluate(
        1,
        deployment=deployment,
        config_maps={"agent-config": _config_map()},
        secret_metadata={"agent-secret": {"uid": "secret-uid", "resourceVersion": "202"}},
    )

    fingerprints = {
        baseline.effective_agent_config_fingerprint,
        template_evidence.effective_agent_config_fingerprint,
        config_map_evidence.effective_agent_config_fingerprint,
        secret_evidence.effective_agent_config_fingerprint,
    }
    assert len(fingerprints) == 4
    serialized = baseline.model_dump_json()
    assert "agent-config" not in serialized
    assert "agent-secret" not in serialized
    assert "secret-uid" not in serialized


def test_child_auto_sync_must_be_explicitly_disabled() -> None:
    evidence = _evaluate(1, child_enabled=True)
    assert evidence.valid is False
    assert any("child Application auto-sync" in error for error in evidence.errors)


def test_duplicate_node_or_resource_drift_fails_closed() -> None:
    pods = [_pod(0, node_name="node-0"), _pod(1, node_name="node-0", cpu="1", restarts=1)]
    evidence = _evaluate(2, pods=pods)
    assert evidence.valid is False
    assert any("distinct nodes" in error for error in evidence.errors)
    assert any("2 vCPU" in error for error in evidence.errors)
    assert any("restarted" in error for error in evidence.errors)


def test_collector_preflight_fails_closed_without_retention_or_backend_reachability() -> None:
    evidence = _evaluate(1, collector_probe=(False, True, False, False))
    assert evidence.valid is False
    assert evidence.collector_preflight.valid is False
    assert evidence.collector_preflight.retention_queue_configured is False
    assert evidence.collector_preflight.agent_backend_base_url_configured is True
    assert any("effective Celery queues" in error for error in evidence.collector_preflight.errors)
    assert any("health or OpenAPI" in error for error in evidence.collector_preflight.errors)


def test_collector_preflight_requires_one_ready_unrestarted_replica() -> None:
    evidence = _evaluate(
        1,
        collector_deployment=_collector_deployment(replicas=2),
        collector_pods=[_collector_pod(restarts=1), _collector_pod(ready=False)],
    )
    assert evidence.valid is False
    assert evidence.collector_preflight.desired_replicas == 2
    assert evidence.collector_preflight.restarted_containers == 1
    assert any("replicas did not all match 1" in error for error in evidence.collector_preflight.errors)
    assert any("restart count" in error for error in evidence.collector_preflight.errors)


def test_collection_probes_collector_without_serializing_queue_or_backend_url_values() -> None:
    agent_deployment = _configured_deployment(1)
    agent_deployment["spec"]["selector"] = {"matchLabels": {"app": "dify-agent-backend"}}
    collector_deployment = _collector_deployment()
    collector_deployment["spec"]["selector"] = {"matchLabels": {"app": "dify-dataset-worker"}}
    responses: dict[str, object] = {
        "deployment/dify-agent-backend": agent_deployment,
        "deployment/dify-dataset-worker": collector_deployment,
        "pods:app=dify-agent-backend": {"items": [_pod(0)]},
        "pods:app=dify-dataset-worker": {"items": [_collector_pod()]},
        "endpoints/dify-agent-backend-svc": {"subsets": [{"addresses": [{}]}]},
        "nodes": {"items": [_node(0), _node(1), _node(2)]},
        "application/staging-agent-backend": _application(enabled=False),
        "application/staging-applications": _application(enabled=True),
        "configmap/agent-config": _config_map(),
    }
    invocations: list[tuple[str, ...]] = []

    def runner(argv: Sequence[str]) -> str:
        invocations.append(tuple(argv))
        values = list(argv)
        if "exec" in values:
            pod_name = values[values.index("exec") + 1]
            if pod_name == "agent-0":
                return json.dumps({"declared": 2, "observed": 2})
            assert pod_name == "dataset-worker-0"
            return json.dumps(
                {
                    "retention_queue_configured": True,
                    "agent_backend_base_url_configured": True,
                    "agent_backend_health_reachable": False,
                    "agent_backend_openapi_reachable": True,
                }
            )
        resource = values[values.index("get") + 1]
        if resource == "secret/agent-secret":
            assert values[-1].startswith("jsonpath=")
            return "secret-uid\t201"
        if resource == "pods":
            resource = f"pods:{values[values.index('-l') + 1]}"
        return json.dumps(responses[resource])

    evidence = collect_staging_backend_deployment_evidence(expected_replicas=1, runner=runner)
    serialized = evidence.model_dump_json()
    assert evidence.valid is True
    assert evidence.collector_preflight.ready_pods == 1
    assert "dataset,dataset_summary,retention" not in serialized
    assert "http://private-agent-backend" not in serialized
    assert "agent-config" not in serialized
    assert "agent-secret" not in serialized
    assert "secret-uid" not in serialized
    secret_calls = [values for values in invocations if "secret/agent-secret" in values]
    assert len(secret_calls) == 1
    assert "jsonpath={.metadata.uid}{'\\t'}{.metadata.resourceVersion}" in secret_calls[0]
