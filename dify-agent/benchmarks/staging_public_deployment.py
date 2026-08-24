"""Read-only deployment evidence for public Staging scaling experiments.

This module deliberately has no scale, patch, or Argo mutation operation.  It
turns Kubernetes and Argo read models into a fail-closed experiment gate; the
operator performs the approved GitOps change and manual scale separately.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime, timezone
import hashlib
import json
import math
import subprocess
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


DEFAULT_KUBE_CONTEXT = "staging-main"
DEFAULT_NAMESPACE = "dify-staging"
DEFAULT_DEPLOYMENT = "dify-agent-backend"
DEFAULT_SERVICE = "dify-agent-backend-svc"
DEFAULT_CONTAINER = "dify-agent-backend"
DEFAULT_ARGO_CHILD = "staging-agent-backend"
DEFAULT_ARGO_PARENT = "staging-applications"
DEFAULT_COLLECTOR_DEPLOYMENT = "dify-dataset-worker"
DEFAULT_COLLECTOR_CONTAINER = "dify-dataset-worker"


class StagingBackendPodEvidence(BaseModel):
    """Non-secret identity and sizing evidence for one target Pod."""

    model_config = ConfigDict(extra="forbid")

    name: str
    uid: str
    node_name: str
    zone: str
    ready: bool
    restart_count: int = Field(ge=0)
    image: str
    image_id: str
    cpu_request_millicores: int = Field(ge=0)
    cpu_limit_millicores: int = Field(ge=0)
    memory_request_mib: int = Field(ge=0)
    memory_limit_mib: int = Field(ge=0)
    declared_workers: int = Field(ge=0)
    observed_workers: int = Field(ge=0)


class StagingCollectorPreflightEvidence(BaseModel):
    """Non-secret readiness and immutable identity for the collector path."""

    model_config = ConfigDict(extra="forbid")

    deployment_name: str
    expected_replicas: int = Field(default=1, ge=1)
    desired_replicas: int = Field(ge=0)
    updated_replicas: int = Field(ge=0)
    ready_replicas: int = Field(ge=0)
    available_replicas: int = Field(ge=0)
    selected_pods: int = Field(ge=0)
    ready_pods: int = Field(ge=0)
    restarted_containers: int = Field(ge=0)
    deployment_generation: int = Field(ge=0)
    deployment_observed_generation: int = Field(ge=0)
    pod_uid: str
    pod_image: str
    pod_image_id: str
    retention_queue_configured: bool
    conversation_queue_configured: bool = False
    conversation_cleanup_task_importable: bool = False
    tool_file_storage_cleanup_capable: bool = False
    conversation_cleanup_retry_configured: bool = False
    conversation_cleanup_sweeper_available: bool = False
    file_cleanup_valid: bool = False
    file_cleanup_errors: list[str] = Field(default_factory=list)
    agent_backend_base_url_configured: bool
    agent_backend_auth_configured: bool = False
    agent_backend_health_reachable: bool
    agent_backend_openapi_reachable: bool
    valid: bool
    errors: list[str] = Field(default_factory=list)


class StagingBackendDeploymentEvidence(BaseModel):
    """A read-only snapshot used to gate one replica experiment stage."""

    model_config = ConfigDict(extra="forbid")

    captured_at: str
    kube_context: str
    namespace: str
    deployment_name: str
    service_name: str
    expected_replicas: int = Field(ge=1)
    desired_replicas: int = Field(ge=0)
    updated_replicas: int = Field(ge=0)
    ready_replicas: int = Field(ge=0)
    available_replicas: int = Field(ge=0)
    generation: int = Field(ge=0)
    observed_generation: int = Field(ge=0)
    ready_endpoints: int = Field(ge=0)
    argo_child_auto_sync_disabled: bool
    argo_parent_auto_sync_enabled: bool
    argo_parent_self_heal_enabled: bool
    effective_agent_config_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    pods: list[StagingBackendPodEvidence]
    collector_preflight: StagingCollectorPreflightEvidence
    valid: bool
    errors: list[str] = Field(default_factory=list)


KubectlRunner = Callable[[Sequence[str]], str]


def collect_staging_backend_deployment_evidence(
    *,
    expected_replicas: int,
    kube_context: str = DEFAULT_KUBE_CONTEXT,
    namespace: str = DEFAULT_NAMESPACE,
    deployment_name: str = DEFAULT_DEPLOYMENT,
    service_name: str = DEFAULT_SERVICE,
    container_name: str = DEFAULT_CONTAINER,
    argo_child_name: str = DEFAULT_ARGO_CHILD,
    argo_parent_name: str = DEFAULT_ARGO_PARENT,
    collector_deployment_name: str = DEFAULT_COLLECTOR_DEPLOYMENT,
    collector_container_name: str = DEFAULT_COLLECTOR_CONTAINER,
    runner: KubectlRunner | None = None,
) -> StagingBackendDeploymentEvidence:
    """Collect and validate the immutable topology required by one load stage."""

    if expected_replicas not in {1, 2, 4}:
        raise ValueError("expected replicas must be one of 1, 2, or 4")
    invoke = runner or _run_argv

    def get_json(*args: str) -> dict[str, Any]:
        output = invoke(("kubectl", "--context", kube_context, "--namespace", namespace, *args, "-o", "json"))
        value = json.loads(output)
        if not isinstance(value, dict):
            raise ValueError("Kubernetes object response must be a JSON object")
        return value

    deployment = get_json("get", f"deployment/{deployment_name}")
    config_map_names, secret_names = _referenced_configuration_names(deployment)
    config_maps = {name: get_json("get", f"configmap/{name}") for name in sorted(config_map_names)}
    secret_metadata = {
        name: _get_secret_metadata(
            invoke=invoke,
            kube_context=kube_context,
            namespace=namespace,
            secret_name=name,
        )
        for name in sorted(secret_names)
    }
    selector = _selector(deployment)
    pods = get_json("get", "pods", "-l", selector)
    endpoints = get_json("get", f"endpoints/{service_name}")
    nodes = get_json("get", "nodes")
    collector_deployment = get_json("get", f"deployment/{collector_deployment_name}")
    collector_selector = _selector(collector_deployment)
    collector_pods = get_json("get", "pods", "-l", collector_selector)

    def get_argo(name: str) -> dict[str, Any]:
        output = invoke(
            (
                "kubectl",
                "--context",
                kube_context,
                "--namespace",
                "argocd",
                "get",
                f"application/{name}",
                "-o",
                "json",
            )
        )
        value = json.loads(output)
        if not isinstance(value, dict):
            raise ValueError("Argo Application response must be a JSON object")
        return value

    child_application = get_argo(argo_child_name)
    parent_application = get_argo(argo_parent_name)
    pod_items = _items(pods)
    worker_evidence: dict[str, tuple[int, int]] = {}
    for pod in pod_items:
        metadata = _mapping(pod.get("metadata"), "Pod metadata")
        pod_name = _string(metadata.get("name"), "Pod metadata.name")
        raw = invoke(
            (
                "kubectl",
                "--context",
                kube_context,
                "--namespace",
                namespace,
                "exec",
                pod_name,
                "-c",
                container_name,
                "--",
                "python",
                "-c",
                _WORKER_PROBE,
            )
        )
        worker_payload = json.loads(raw)
        if not isinstance(worker_payload, dict):
            raise ValueError("worker probe response must be a JSON object")
        worker_evidence[pod_name] = (
            int(worker_payload.get("declared", 0)),
            int(worker_payload.get("observed", 0)),
        )
    collector_pod_items = _items(collector_pods)
    collector_probe_evidence: dict[str, tuple[bool, ...]] = {}
    for pod in collector_pod_items:
        metadata = _mapping(pod.get("metadata"), "collector Pod metadata")
        pod_name = _string(metadata.get("name"), "collector Pod metadata.name")
        collector_status = _pod_named_container_status(pod, collector_container_name)
        if collector_status is None or not _container_ready(collector_status):
            continue
        raw = invoke(
            (
                "kubectl",
                "--context",
                kube_context,
                "--namespace",
                namespace,
                "exec",
                pod_name,
                "-c",
                collector_container_name,
                "--",
                "python",
                "-c",
                _COLLECTOR_PROBE,
            )
        )
        probe_payload = json.loads(raw)
        if not isinstance(probe_payload, dict):
            raise ValueError("collector probe response must be a JSON object")
        collector_probe_evidence[pod_name] = (
            probe_payload.get("retention_queue_configured") is True,
            probe_payload.get("agent_backend_base_url_configured") is True,
            probe_payload.get("agent_backend_health_reachable") is True,
            probe_payload.get("agent_backend_openapi_reachable") is True,
            probe_payload.get("conversation_queue_configured") is True,
            probe_payload.get("conversation_cleanup_task_importable") is True,
            probe_payload.get("tool_file_storage_cleanup_capable") is True,
            probe_payload.get("conversation_cleanup_retry_configured") is True,
            probe_payload.get("conversation_cleanup_sweeper_available") is True,
            probe_payload.get("agent_backend_auth_configured") is True,
        )
    return evaluate_staging_backend_deployment(
        expected_replicas=expected_replicas,
        kube_context=kube_context,
        namespace=namespace,
        deployment_name=deployment_name,
        service_name=service_name,
        container_name=container_name,
        deployment=deployment,
        config_maps=config_maps,
        secret_metadata=secret_metadata,
        pods=pod_items,
        endpoints=endpoints,
        nodes=_items(nodes),
        child_application=child_application,
        parent_application=parent_application,
        worker_evidence=worker_evidence,
        collector_deployment_name=collector_deployment_name,
        collector_container_name=collector_container_name,
        collector_deployment=collector_deployment,
        collector_pods=collector_pod_items,
        collector_probe_evidence=collector_probe_evidence,
    )


def evaluate_staging_backend_deployment(
    *,
    expected_replicas: int,
    kube_context: str,
    namespace: str,
    deployment_name: str,
    service_name: str,
    container_name: str,
    deployment: Mapping[str, Any],
    pods: Sequence[Mapping[str, Any]],
    endpoints: Mapping[str, Any],
    nodes: Sequence[Mapping[str, Any]],
    child_application: Mapping[str, Any],
    parent_application: Mapping[str, Any],
    worker_evidence: Mapping[str, tuple[int, int]],
    collector_deployment_name: str,
    collector_container_name: str,
    collector_deployment: Mapping[str, Any],
    collector_pods: Sequence[Mapping[str, Any]],
    collector_probe_evidence: Mapping[str, tuple[bool, ...]],
    config_maps: Mapping[str, Mapping[str, Any]] | None = None,
    secret_metadata: Mapping[str, Mapping[str, Any]] | None = None,
) -> StagingBackendDeploymentEvidence:
    """Evaluate pre-fetched API objects without performing any cluster write."""

    errors: list[str] = []
    metadata = _mapping(deployment.get("metadata"), "Deployment metadata")
    spec = _mapping(deployment.get("spec"), "Deployment spec")
    effective_agent_config_fingerprint = _effective_agent_config_fingerprint(
        deployment=deployment,
        config_maps=config_maps or {},
        secret_metadata=secret_metadata or {},
    )
    status = _mapping(deployment.get("status", {}), "Deployment status")
    desired = int(spec.get("replicas", 1))
    updated = int(status.get("updatedReplicas", 0))
    ready = int(status.get("readyReplicas", 0))
    available = int(status.get("availableReplicas", 0))
    generation = int(metadata.get("generation", 0))
    observed_generation = int(status.get("observedGeneration", 0))
    if {desired, updated, ready, available} != {expected_replicas}:
        errors.append(f"Deployment desired/updated/ready/available replicas did not all match {expected_replicas}")
    if generation != observed_generation:
        errors.append("Deployment generation was not fully observed")

    node_zones = _node_zones(nodes)
    deployment_container = _deployment_container(spec, container_name)
    expected_image = _string(deployment_container.get("image"), "Deployment container image")
    pod_evidence: list[StagingBackendPodEvidence] = []
    for pod in pods:
        pod_evidence.append(
            _pod_evidence(
                pod=pod,
                container_name=container_name,
                node_zones=node_zones,
                worker_evidence=worker_evidence,
            )
        )
    if len(pod_evidence) != expected_replicas:
        errors.append(f"selected Pod count {len(pod_evidence)} did not match {expected_replicas}")
    if len({pod.node_name for pod in pod_evidence}) != len(pod_evidence):
        errors.append("Agent Pods were not placed on distinct nodes")
    if any(not pod.zone for pod in pod_evidence):
        errors.append("one or more Agent Pod zones could not be resolved")
    else:
        all_zones = sorted({zone for zone in node_zones.values() if zone})
        counts = Counter(pod.zone for pod in pod_evidence)
        if (
            all_zones
            and max(counts.get(zone, 0) for zone in all_zones) - min(counts.get(zone, 0) for zone in all_zones) > 1
        ):
            errors.append("Agent Pod zone skew exceeded 1")
    if any(not pod.ready for pod in pod_evidence):
        errors.append("one or more Agent Pods were not Ready")
    if any(pod.restart_count != 0 for pod in pod_evidence):
        errors.append("one or more Agent containers restarted")
    if any(pod.image != expected_image for pod in pod_evidence):
        errors.append("Agent Pod image did not match the Deployment image")
    image_ids = {pod.image_id for pod in pod_evidence}
    if len(image_ids) != 1 or not all(image_ids):
        errors.append("Agent Pods did not share one immutable image digest")
    for pod in pod_evidence:
        if (pod.cpu_request_millicores, pod.cpu_limit_millicores) != (2000, 2000):
            errors.append(f"{pod.name} did not have 2 vCPU requests and limits")
        if (pod.memory_request_mib, pod.memory_limit_mib) != (2048, 2048):
            errors.append(f"{pod.name} did not have 2 GiB memory requests and limits")
        if (pod.declared_workers, pod.observed_workers) != (2, 2):
            errors.append(f"{pod.name} did not declare and run exactly 2 Uvicorn workers")

    ready_endpoints = _ready_endpoint_count(endpoints)
    if ready_endpoints != expected_replicas:
        errors.append(f"ready Endpoint count {ready_endpoints} did not match {expected_replicas}")
    child_disabled = _argo_automated_enabled(child_application) is False
    if not child_disabled:
        errors.append("staging-agent-backend child Application auto-sync was not explicitly disabled")
    parent_enabled = _argo_automated_enabled(parent_application) is True
    parent_self_heal = _argo_self_heal_enabled(parent_application)
    if not parent_enabled or not parent_self_heal:
        errors.append("staging-applications parent Application did not retain automated self-heal")

    collector_preflight = _evaluate_collector_preflight(
        deployment_name=collector_deployment_name,
        container_name=collector_container_name,
        deployment=collector_deployment,
        pods=collector_pods,
        probe_evidence=collector_probe_evidence,
    )
    if not collector_preflight.valid:
        errors.append("dify-dataset-worker collector preflight failed")

    return StagingBackendDeploymentEvidence(
        captured_at=datetime.now(timezone.utc).isoformat(),
        kube_context=kube_context,
        namespace=namespace,
        deployment_name=deployment_name,
        service_name=service_name,
        expected_replicas=expected_replicas,
        desired_replicas=desired,
        updated_replicas=updated,
        ready_replicas=ready,
        available_replicas=available,
        generation=generation,
        observed_generation=observed_generation,
        ready_endpoints=ready_endpoints,
        argo_child_auto_sync_disabled=child_disabled,
        argo_parent_auto_sync_enabled=parent_enabled,
        argo_parent_self_heal_enabled=parent_self_heal,
        effective_agent_config_fingerprint=effective_agent_config_fingerprint,
        pods=pod_evidence,
        collector_preflight=collector_preflight,
        valid=not errors,
        errors=list(dict.fromkeys(errors)),
    )


def _evaluate_collector_preflight(
    *,
    deployment_name: str,
    container_name: str,
    deployment: Mapping[str, Any],
    pods: Sequence[Mapping[str, Any]],
    probe_evidence: Mapping[str, tuple[bool, ...]],
) -> StagingCollectorPreflightEvidence:
    errors: list[str] = []
    file_cleanup_errors: list[str] = []
    metadata = _mapping(deployment.get("metadata"), "collector Deployment metadata")
    spec = _mapping(deployment.get("spec"), "collector Deployment spec")
    status = _mapping(deployment.get("status", {}), "collector Deployment status")
    desired = int(spec.get("replicas", 1))
    updated = int(status.get("updatedReplicas", 0))
    ready = int(status.get("readyReplicas", 0))
    available = int(status.get("availableReplicas", 0))
    generation = int(metadata.get("generation", 0))
    observed_generation = int(status.get("observedGeneration", 0))
    if (desired, updated, ready, available) != (1, 1, 1, 1):
        errors.append("collector desired/updated/ready/available replicas did not all match 1")
    if generation != observed_generation:
        errors.append("collector Deployment generation was not fully observed")

    deployment_container = _deployment_container(spec, container_name)
    expected_image = _string(deployment_container.get("image"), "collector Deployment container image")

    ready_pod_names: list[str] = []
    restarted_containers = 0
    pod_uid = ""
    pod_image = ""
    pod_image_id = ""
    for pod in pods:
        metadata = _mapping(pod.get("metadata"), "collector Pod metadata")
        pod_name = _string(metadata.get("name"), "collector Pod metadata.name")
        spec_value = _mapping(pod.get("spec"), "collector Pod spec")
        declared_containers = _sequence(spec_value.get("containers", []), "collector Pod containers")
        if not any(container.get("name") == container_name for container in declared_containers):
            errors.append("collector Pod did not declare the expected container")
        container_status = _pod_named_container_status(pod, container_name)
        if container_status is not None and _container_ready(container_status):
            ready_pod_names.append(pod_name)
            pod_uid = _string(metadata.get("uid"), "collector Pod metadata.uid")
            pod_container = _named(declared_containers, container_name, "collector Pod container")
            pod_image = _string(pod_container.get("image"), "collector Pod container image")
            pod_image_id = _string(container_status.get("imageID"), "collector Pod container imageID")
        if container_status is not None and int(container_status.get("restartCount", 0)) > 0:
            restarted_containers += 1
    if len(pods) != 1 or len(ready_pod_names) != 1:
        errors.append("collector must have exactly one selected Ready Pod")
    if restarted_containers:
        errors.append("collector container restart count was not zero")
    if pod_image and pod_image != expected_image:
        errors.append("collector Pod image did not match the Deployment image")
    if not pod_image_id:
        errors.append("collector Pod did not expose an immutable image ID")

    probe_values = [probe_evidence[name] for name in ready_pod_names if name in probe_evidence]
    if len(probe_values) != 1:
        errors.append("collector Ready Pod did not produce exactly one probe result")
        retention_queue_configured = False
        base_url_configured = False
        health_reachable = False
        openapi_reachable = False
        api_token_configured = False
        conversation_queue_configured = False
        conversation_cleanup_task_importable = False
        tool_file_storage_cleanup_capable = False
        conversation_cleanup_retry_configured = False
        conversation_cleanup_sweeper_available = False
    else:
        # New probe fields are appended so older test fixtures keep their
        # established positional meaning. Missing fields remain fail-closed.
        normalized_probe = (*probe_values[0][:10], False, False, False, False, False, False, False, False, False, False)
        (
            retention_queue_configured,
            base_url_configured,
            health_reachable,
            openapi_reachable,
            conversation_queue_configured,
            conversation_cleanup_task_importable,
            tool_file_storage_cleanup_capable,
            conversation_cleanup_retry_configured,
            conversation_cleanup_sweeper_available,
            api_token_configured,
        ) = normalized_probe[:10]
    if not retention_queue_configured:
        errors.append("collector effective Celery queues did not include retention")
    if not conversation_queue_configured:
        file_cleanup_errors.append("collector effective Celery queues did not include conversation")
    if not conversation_cleanup_task_importable:
        file_cleanup_errors.append("collector could not import the conversation cleanup task")
    if not tool_file_storage_cleanup_capable:
        file_cleanup_errors.append("collector did not expose the required ToolFile storage cleanup ordering")
    if not conversation_cleanup_retry_configured:
        file_cleanup_errors.append("collector conversation cleanup task did not expose retry capability")
    if not conversation_cleanup_sweeper_available:
        file_cleanup_errors.append("collector did not expose the soft-deleted conversation cleanup sweeper")
    if not base_url_configured:
        errors.append("collector Agent Backend base URL was not configured")
    if not api_token_configured:
        errors.append("collector Agent Backend API token was not configured")
    if not (health_reachable or openapi_reachable):
        errors.append("collector could not reach an Agent Backend health or OpenAPI endpoint")

    return StagingCollectorPreflightEvidence(
        deployment_name=deployment_name,
        desired_replicas=desired,
        updated_replicas=updated,
        ready_replicas=ready,
        available_replicas=available,
        selected_pods=len(pods),
        ready_pods=len(ready_pod_names),
        restarted_containers=restarted_containers,
        deployment_generation=generation,
        deployment_observed_generation=observed_generation,
        pod_uid=pod_uid,
        pod_image=pod_image,
        pod_image_id=pod_image_id,
        retention_queue_configured=retention_queue_configured,
        conversation_queue_configured=conversation_queue_configured,
        conversation_cleanup_task_importable=conversation_cleanup_task_importable,
        tool_file_storage_cleanup_capable=tool_file_storage_cleanup_capable,
        conversation_cleanup_retry_configured=conversation_cleanup_retry_configured,
        conversation_cleanup_sweeper_available=conversation_cleanup_sweeper_available,
        file_cleanup_valid=not file_cleanup_errors,
        file_cleanup_errors=file_cleanup_errors,
        agent_backend_base_url_configured=base_url_configured,
        agent_backend_auth_configured=api_token_configured,
        agent_backend_health_reachable=health_reachable,
        agent_backend_openapi_reachable=openapi_reachable,
        valid=not errors,
        errors=errors,
    )


def _pod_evidence(
    *,
    pod: Mapping[str, Any],
    container_name: str,
    node_zones: Mapping[str, str],
    worker_evidence: Mapping[str, tuple[int, int]],
) -> StagingBackendPodEvidence:
    metadata = _mapping(pod.get("metadata"), "Pod metadata")
    spec = _mapping(pod.get("spec"), "Pod spec")
    status = _mapping(pod.get("status", {}), "Pod status")
    name = _string(metadata.get("name"), "Pod metadata.name")
    uid = _string(metadata.get("uid"), "Pod metadata.uid")
    node_name = _string(spec.get("nodeName"), "Pod spec.nodeName")
    containers = _sequence(spec.get("containers"), "Pod spec.containers")
    container = _named(containers, container_name, "Pod container")
    statuses = _sequence(status.get("containerStatuses", []), "Pod status.containerStatuses")
    container_status = _named(statuses, container_name, "Pod container status")
    resources = _mapping(container.get("resources", {}), "Pod container resources")
    requests = _mapping(resources.get("requests", {}), "Pod container requests")
    limits = _mapping(resources.get("limits", {}), "Pod container limits")
    declared, observed = worker_evidence.get(name, (0, 0))
    return StagingBackendPodEvidence(
        name=name,
        uid=uid,
        node_name=node_name,
        zone=node_zones.get(node_name, ""),
        ready=_container_ready(container_status),
        restart_count=int(container_status.get("restartCount", 0)),
        image=_string(container.get("image"), "Pod container image"),
        image_id=_string(container_status.get("imageID"), "Pod container imageID"),
        cpu_request_millicores=_cpu_millicores(requests.get("cpu")),
        cpu_limit_millicores=_cpu_millicores(limits.get("cpu")),
        memory_request_mib=_memory_mib(requests.get("memory")),
        memory_limit_mib=_memory_mib(limits.get("memory")),
        declared_workers=declared,
        observed_workers=observed,
    )


def _referenced_configuration_names(
    deployment: Mapping[str, Any],
) -> tuple[set[str], set[str]]:
    """Return ConfigMap and Secret names referenced by the Pod template."""

    spec = _mapping(deployment.get("spec"), "Deployment spec")
    template = _mapping(spec.get("template"), "Deployment spec.template")
    pod_spec = _mapping(template.get("spec"), "Deployment Pod spec")
    config_maps: set[str] = set()
    secrets: set[str] = set()

    def visit(value: object) -> None:
        if isinstance(value, Mapping):
            for key, nested in value.items():
                if key in {"configMap", "configMapRef", "configMapKeyRef"} and isinstance(nested, Mapping):
                    name = nested.get("name")
                    if isinstance(name, str) and name:
                        config_maps.add(name)
                elif key in {"secret", "secretRef", "secretKeyRef"} and isinstance(nested, Mapping):
                    name = nested.get("name") or nested.get("secretName")
                    if isinstance(name, str) and name:
                        secrets.add(name)
                elif key == "imagePullSecrets" and isinstance(nested, list):
                    for item in nested:
                        if isinstance(item, Mapping):
                            name = item.get("name")
                            if isinstance(name, str) and name:
                                secrets.add(name)
                visit(nested)
        elif isinstance(value, list):
            for nested in value:
                visit(nested)

    visit(pod_spec)
    return config_maps, secrets


def _get_secret_metadata(
    *,
    invoke: KubectlRunner,
    kube_context: str,
    namespace: str,
    secret_name: str,
) -> dict[str, str]:
    """Read only the Secret identity fields; never request or retain Secret data."""

    output = invoke(
        (
            "kubectl",
            "--context",
            kube_context,
            "--namespace",
            namespace,
            "get",
            f"secret/{secret_name}",
            "-o",
            "jsonpath={.metadata.uid}{'\\t'}{.metadata.resourceVersion}",
        )
    )
    values = output.strip().split("\t")
    if len(values) != 2 or not all(values):
        raise ValueError("Secret metadata response must contain UID and resourceVersion")
    return {"uid": values[0], "resourceVersion": values[1]}


def _effective_agent_config_fingerprint(
    *,
    deployment: Mapping[str, Any],
    config_maps: Mapping[str, Mapping[str, Any]],
    secret_metadata: Mapping[str, Mapping[str, Any]],
) -> str:
    """Hash effective Agent configuration without serializing referenced values."""

    spec = _mapping(deployment.get("spec"), "Deployment spec")
    template = _mapping(spec.get("template"), "Deployment spec.template")
    pod_spec = _mapping(template.get("spec"), "Deployment Pod spec")
    config_map_names, secret_names = _referenced_configuration_names(deployment)

    config_map_identities: list[dict[str, str]] = []
    for name in sorted(config_map_names):
        config_map = config_maps.get(name)
        if config_map is None:
            raise ValueError("referenced ConfigMap evidence was not collected")
        metadata = _mapping(config_map.get("metadata"), "ConfigMap metadata")
        resource_version = _string(metadata.get("resourceVersion"), "ConfigMap metadata.resourceVersion")
        data = config_map.get("data", {})
        binary_data = config_map.get("binaryData", {})
        if not isinstance(data, Mapping) or not isinstance(binary_data, Mapping):
            raise ValueError("ConfigMap data and binaryData must be objects")
        config_map_identities.append(
            {
                "name_sha256": _canonical_sha256(name),
                "resource_version": resource_version,
                "content_sha256": _canonical_sha256({"data": dict(data), "binaryData": dict(binary_data)}),
            }
        )

    secret_identities: list[str] = []
    for name in sorted(secret_names):
        metadata = secret_metadata.get(name)
        if metadata is None:
            raise ValueError("referenced Secret metadata evidence was not collected")
        uid = _string(metadata.get("uid"), "Secret metadata.uid")
        resource_version = _string(metadata.get("resourceVersion"), "Secret metadata.resourceVersion")
        secret_identities.append(_canonical_sha256({"name": name, "uid": uid, "resourceVersion": resource_version}))

    return _canonical_sha256(
        {
            "pod_template_spec": pod_spec,
            "config_maps": config_map_identities,
            "secret_metadata_identities": secret_identities,
        }
    )


def _canonical_sha256(value: object) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _selector(deployment: Mapping[str, Any]) -> str:
    spec = _mapping(deployment.get("spec"), "Deployment spec")
    selector = _mapping(spec.get("selector"), "Deployment spec.selector")
    labels = _mapping(selector.get("matchLabels"), "Deployment selector.matchLabels")
    if not labels:
        raise ValueError("Deployment selector.matchLabels must not be empty")
    return ",".join(f"{key}={labels[key]}" for key in sorted(labels))


def _deployment_container(spec: Mapping[str, Any], name: str) -> Mapping[str, Any]:
    template = _mapping(spec.get("template"), "Deployment spec.template")
    pod_spec = _mapping(template.get("spec"), "Deployment Pod spec")
    return _named(_sequence(pod_spec.get("containers"), "Deployment containers"), name, "Deployment container")


def _node_zones(nodes: Sequence[Mapping[str, Any]]) -> dict[str, str]:
    result: dict[str, str] = {}
    for node in nodes:
        metadata = _mapping(node.get("metadata"), "Node metadata")
        name = _string(metadata.get("name"), "Node metadata.name")
        labels = _mapping(metadata.get("labels", {}), "Node metadata.labels")
        result[name] = str(labels.get("topology.kubernetes.io/zone", ""))
    return result


def _ready_endpoint_count(endpoints: Mapping[str, Any]) -> int:
    subsets = _sequence(endpoints.get("subsets", []), "Endpoints subsets")
    return sum(len(_sequence(subset.get("addresses", []), "Endpoint addresses")) for subset in subsets)


def _argo_automated_enabled(application: Mapping[str, Any]) -> bool:
    spec = _mapping(application.get("spec", {}), "Application spec")
    policy = _mapping(spec.get("syncPolicy", {}), "Application syncPolicy")
    automated = policy.get("automated")
    if not isinstance(automated, Mapping):
        return False
    enabled = automated.get("enabled")
    return enabled is not False


def _argo_self_heal_enabled(application: Mapping[str, Any]) -> bool:
    spec = _mapping(application.get("spec", {}), "Application spec")
    policy = _mapping(spec.get("syncPolicy", {}), "Application syncPolicy")
    automated = policy.get("automated")
    return isinstance(automated, Mapping) and automated.get("selfHeal") is True


def _container_ready(status: Mapping[str, Any]) -> bool:
    return status.get("ready") is True


def _pod_named_container_status(pod: Mapping[str, Any], container_name: str) -> Mapping[str, Any] | None:
    status = pod.get("status")
    if not isinstance(status, Mapping):
        return None
    statuses = status.get("containerStatuses")
    if not isinstance(statuses, list):
        return None
    matches = [item for item in statuses if isinstance(item, Mapping) and item.get("name") == container_name]
    return matches[0] if len(matches) == 1 else None


def _cpu_millicores(value: object) -> int:
    if not isinstance(value, str) or not value:
        return 0
    if value.endswith("m"):
        return int(value[:-1])
    return int(float(value) * 1000)


def _memory_mib(value: object) -> int:
    if not isinstance(value, str) or not value:
        return 0
    units = {"Ki": 1 / 1024, "Mi": 1, "Gi": 1024, "Ti": 1024 * 1024}
    for suffix, multiplier in units.items():
        if value.endswith(suffix):
            return int(math.floor(float(value[: -len(suffix)]) * multiplier))
    return int(math.floor(float(value) / 1024 / 1024))


def _mapping(value: object, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must be an object")
    return value


def _sequence(value: object, label: str) -> Sequence[Mapping[str, Any]]:
    if not isinstance(value, list) or any(not isinstance(item, Mapping) for item in value):
        raise ValueError(f"{label} must be an array of objects")
    return value


def _items(value: Mapping[str, Any]) -> Sequence[Mapping[str, Any]]:
    return _sequence(value.get("items"), "List items")


def _named(items: Sequence[Mapping[str, Any]], name: str, label: str) -> Mapping[str, Any]:
    matches = [item for item in items if item.get("name") == name]
    if len(matches) != 1:
        raise ValueError(f"{label} {name!r} must appear exactly once")
    return matches[0]


def _string(value: object, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{label} must be a non-empty string")
    return value


def _run_argv(argv: Sequence[str]) -> str:
    completed = subprocess.run(list(argv), check=True, capture_output=True, text=True, timeout=60)
    return completed.stdout


_WORKER_PROBE = """import glob,json,os
count=0
for path in glob.glob('/proc/[0-9]*/cmdline'):
    if int(path.split('/')[2]) == os.getpid():
        # This probe's own ``python -c`` command embeds the marker below.
        # Counting it would turn the expected two spawned Uvicorn children
        # into a false three-worker deployment observation.
        continue
    try:
        command=open(path,'rb').read()
    except OSError:
        continue
    if b'from multiprocessing.spawn import spawn_main' in command:
        count+=1
print(json.dumps({'declared':int(os.environ.get('UVICORN_WORKERS','0')),'observed':count}))
"""


_COLLECTOR_PROBE = """import inspect,json,os,urllib.request
queues=''
try:
    argv=[item.decode() for item in open('/proc/1/cmdline','rb').read().split(b'\\0') if item]
except OSError:
    argv=[]
for index,item in enumerate(argv):
    if item in {'-Q','--queues'} and index+1 < len(argv):
        queues=argv[index+1]
    elif item.startswith('--queues='):
        queues=item.split('=',1)[1]
if not queues:
    queues=os.environ.get('CELERY_WORKER_QUEUES') or os.environ.get('CELERY_QUEUES') or ''
queue_names={item.strip() for item in queues.split(',') if item.strip()}
cleanup_capabilities={
    'conversation_cleanup_task_importable':False,
    'tool_file_storage_cleanup_capable':False,
    'conversation_cleanup_retry_configured':False,
    'conversation_cleanup_sweeper_available':False,
}
try:
    import tasks.delete_conversation_task as cleanup_module
    cleanup_task=getattr(cleanup_module,'delete_conversation_related_data',None)
    cleanup_capabilities['conversation_cleanup_task_importable']=callable(cleanup_task)
    cleanup_function=getattr(cleanup_module,'_cleanup_conversation_related_data',None)
    delete_function=getattr(cleanup_module,'_delete_storage_object',None)
    if callable(cleanup_function) and callable(delete_function):
        cleanup_source=''.join(inspect.getsource(cleanup_function).split())
        delete_source=''.join(inspect.getsource(delete_function).split())
        storage_call='_delete_storage_object(tool_file.file_key)'
        row_call='session.delete(tool_file)'
        cleanup_capabilities['tool_file_storage_cleanup_capable']=(
            'ToolFile.conversation_id==conversation_id' in cleanup_source
            and storage_call in cleanup_source
            and row_call in cleanup_source
            and cleanup_source.index(storage_call) < cleanup_source.index(row_call)
            and 'storage.delete(file_key)' in delete_source
            and 'storage.exists(file_key)' in delete_source
        )
    if cleanup_task is not None:
        task_source=inspect.getsource(cleanup_task.run)
        cleanup_capabilities['conversation_cleanup_retry_configured']=(
            int(getattr(cleanup_task,'max_retries',0) or 0) > 0
            and 'self.retry' in task_source
        )
    cleanup_capabilities['conversation_cleanup_sweeper_available']=callable(
        getattr(cleanup_module,'sweep_deleted_conversations',None)
    )
except Exception:
    pass
base_url=os.environ.get('AGENT_BACKEND_BASE_URL','').strip().rstrip('/')
api_token_configured=bool(os.environ.get('AGENT_BACKEND_API_TOKEN','').strip())
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def reachable(path):
    if not base_url:
        return False
    try:
        with opener.open(base_url+path,timeout=5) as response:
            return 200 <= int(response.status) < 300
    except Exception:
        return False
health=reachable('/health') or reachable('/healthz')
openapi=reachable('/openapi.json')
print(json.dumps({
    'retention_queue_configured':'retention' in queue_names,
    'conversation_queue_configured':'conversation' in queue_names,
    'agent_backend_base_url_configured':bool(base_url),
    'agent_backend_auth_configured':api_token_configured,
    'agent_backend_health_reachable':health,
    'agent_backend_openapi_reachable':openapi,
    **cleanup_capabilities,
}))
"""


__all__ = [
    "StagingBackendDeploymentEvidence",
    "StagingBackendPodEvidence",
    "StagingCollectorPreflightEvidence",
    "collect_staging_backend_deployment_evidence",
    "evaluate_staging_backend_deployment",
]
