"""Real HTTP copy/export/import/rebind acceptance for portable External nodes.

Precondition: the isolated deployment and verified-TLS fixture documented in
``acceptance.py`` are running. ``BYOA_TEST_ACTORS_JSON.foreign_owner`` must hold
an Owner in a different workspace; missing credentials fail rather than skip.
Postcondition on success: copied/imported workflows actually finish through the
fixture, jobs/edges are unchanged, bindings have new epochs, foreign references
require an atomic rebind and no business Send is replayed. Reports contain only
synthetic identities, hashes and assertions, never DSL bodies or credentials.
The runner creates clearly named Apps/assets and preserves them for inspection.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, override

import yaml

from tests.e2e_tests.external_agents.acceptance import AcceptanceError, require
from tests.e2e_tests.external_agents.matrix_support import same_json_value
from tests.e2e_tests.external_agents.workflow_acceptance import WorkflowAcceptance, graph, node

EXTERNAL_IDS = frozenset({"external", "external-again"})
PORTABLE_NODE_KEYS = frozenset(
    {
        "type",
        "version",
        "agent_node_kind",
        "title",
        "desc",
        "error_strategy",
        "default_value",
        "retry_config",
        "_isInIteration",
        "_isInLoop",
        "iteration_id",
        "loop_id",
        "agent_task",
        "agent_declared_outputs",
        "external_wait",
        "agent_binding",
    }
)
JOB_KEYS = (
    "title",
    "desc",
    "agent_task",
    "agent_declared_outputs",
    "external_wait",
    "error_strategy",
    "default_value",
    "retry_config",
)


def two_agent_graph(agent: str) -> dict:
    """Return a valid serial graph whose two nodes share the original reference.

    Both nodes execute real work and have distinct binding/frame identities.
    Explicit defaults and wait settings are portability sentinels, not expected
    execution fallbacks; every final node output is checked against the peer.
    """
    value = graph(agent)
    first = next(item for item in value["nodes"] if item["id"] == "external")
    first["data"].update(
        desc="Portable author configuration sentinel",
        error_strategy="default-value",
        default_value=[{"key": "text", "type": "string", "value": "must-not-be-used"}],
        retry_config={"retry_enabled": False, "max_retries": 0, "retry_interval": 1000},
    )
    second = node("external-again", copy.deepcopy(first["data"]), 600)
    second["data"]["title"] = "External again"
    second["data"]["agent_task"] = "{{#start.task#}} second node"
    end = next(item for item in value["nodes"] if item["id"] == "end")
    end["position"]["x"] = 900
    end["data"]["outputs"][0]["value_selector"] = ["external-again", "text"]
    value["nodes"].insert(-1, second)
    ids = ["start", "external", "external-again", "end"]
    value["edges"] = [
        {
            "id": f"{source}-{target}",
            "type": "custom",
            "source": source,
            "target": target,
            "sourceHandle": "source",
            "targetHandle": "target",
        }
        for source, target in zip(ids, ids[1:], strict=False)
    ]
    return value


def external_nodes(value: dict) -> dict[str, dict]:
    """Require both serialized node identities before extracting any bindings."""
    result = {item["id"]: item["data"] for item in value["graph"]["nodes"] if item["id"] in EXTERNAL_IDS}
    require(set(result) == EXTERNAL_IDS, "A portable workflow lost an External node.")
    return result


def epochs(value: dict) -> dict[str, str]:
    """Require a nonempty, per-node server epoch for a connected workflow."""
    result = {
        identifier: data.get("agent_binding", {}).get("binding_epoch")
        for identifier, data in external_nodes(value).items()
    }
    require(all(isinstance(epoch, str) and epoch for epoch in result.values()), "A restored binding has no epoch.")
    require(len(set(result.values())) == len(result), "Distinct External nodes share a binding epoch.")
    return result


def author_configuration(value: dict) -> dict:
    """Select the author-owned values that copy/import/rebind must preserve.

    Viewport and server-owned binding fields are intentionally excluded. Node
    positions, all edges, downstream selectors and explicit default presence are
    retained so a successful HTTP response cannot conceal a lossy round trip.
    """
    return {
        "edges": value["graph"]["edges"],
        "nodes": {
            item["id"]: {
                "position": item["position"],
                "data": {
                    key: item["data"][key]
                    for key in (JOB_KEYS if item["id"] in EXTERNAL_IDS else tuple(item["data"]))
                    if key in item["data"]
                },
            }
            for item in value["graph"]["nodes"]
        },
    }


class DslAcceptance(WorkflowAcceptance):
    def __init__(self) -> None:
        """Construct real HTTP clients; require a foreign principal before writes."""
        super().__init__()
        configured = json.loads(os.environ.get("BYOA_TEST_ACTORS_JSON", "{}"))
        actor = configured.get("foreign_owner") if isinstance(configured, dict) else None
        if not isinstance(actor, dict):
            raise AcceptanceError("DSL acceptance requires foreign_owner credentials in BYOA_TEST_ACTORS_JSON.")
        email, password = actor.get("email"), actor.get("password")
        if not isinstance(email, str) or not isinstance(password, str):
            raise AcceptanceError("DSL acceptance requires foreign_owner credentials in BYOA_TEST_ACTORS_JSON.")
        self.foreign = WorkflowAcceptance()
        self.foreign._email = email
        self.foreign._password = password
        self.foreign.run_id = self.run_id + "-foreign"
        self.report.update(
            scope="real HTTP DSL copy/import/export/batch-rebind and actual Workflow execution", transfers=[]
        )

    @override
    def close(self) -> None:
        """Close both authenticated sessions without exposing their cookies."""
        self.foreign.close()
        super().close()

    def copied_app(self, source: str) -> str:
        """Copy through the Console endpoint; refuse an uncompleted copy."""
        self.phase = "same_workspace_console_copy"
        before = self.stats()["counts"]["send"]
        result = self.call(
            "POST",
            f"/apps/{source}/copy",
            expected=(201,),
            json={"name": f"BYOA DSL copy {self.run_id[:10]}"},
        )
        require(isinstance(result.get("id"), str), "Console copy did not return a persisted App ID.")
        require(self.stats()["counts"]["send"] == before, "Copy dispatched business work.")
        self.report["apps"].append(result["id"])
        return result["id"]

    def export(self, app: str, *, include_secret: bool) -> str:
        """Export YAML through HTTP and enforce the External allowlist in memory."""
        self.phase = "portable_yaml_export"
        before = self.stats()["counts"]["send"]
        result = self.call("GET", f"/apps/{app}/export", params={"format": "yaml", "include_secret": include_secret})
        content = result.get("data")
        if not isinstance(content, str) or not content:
            raise AcceptanceError("The YAML export is empty.")
        parsed = yaml.safe_load(content)
        require(isinstance(parsed, dict), "Export did not contain an App DSL object.")
        require(not parsed.get("agent_packages"), "External-only export materialized a Native Soul package.")
        for data in external_nodes(parsed["workflow"]).values():
            require(
                set(data).issubset(PORTABLE_NODE_KEYS),
                "Export included fields outside the External portable allowlist.",
            )
            binding = data.get("agent_binding", {})
            require(set(binding) == {"binding_type", "original_reference"}, "Export leaked a live binding or epoch.")
            require(
                set(binding["original_reference"]) == {"schema_version", "workspace_id", "agent_id", "display_name"},
                "The portable reference includes connection or execution state.",
            )
            forbidden = {
                "endpoint",
                "credential",
                "authorization",
                "contextId",
                "context_id",
                "taskId",
                "task_id",
                "agent_soul",
            }
            require(not forbidden.intersection(data), "Export leaked connection, runtime or Native state.")
        bearer = os.environ.get("BYOA_FIXTURE_BEARER")
        require(not bearer or bearer not in content, "Export included the configured Agent credential.")
        require(self.stats()["counts"]["send"] == before, "Export dispatched business work.")
        self.report["transfers"].append(
            {
                "kind": "yaml-export",
                "include_secret": include_secret,
                "bytes": len(content.encode()),
                "sha256": hashlib.sha256(content.encode()).hexdigest(),
            }
        )
        return content

    def imported_app(self, actor: WorkflowAcceptance, content: str, *, foreign: bool) -> str:
        """Import current-version YAML through HTTP, checking warnings and identity."""
        self.phase = actor.phase = "foreign_yaml_import" if foreign else "same_workspace_yaml_import"
        before = self.stats()["counts"]["send"]
        result = actor.call(
            "POST",
            "/apps/imports",
            json={
                "mode": "yaml-content",
                "yaml_content": content,
                "name": f"BYOA DSL import {self.run_id[:10]} {'foreign' if foreign else 'same'}",
            },
        )
        require(
            result.get("status") == ("completed-with-warnings" if foreign else "completed"),
            "Import did not return the expected completed/warnings state.",
        )
        identifier = result.get("app_id")
        if not isinstance(identifier, str) or not identifier:
            raise AcceptanceError("Import did not persist its App.")
        warnings = result.get("warnings") or []
        paths = {item.get("path") for item in warnings if item.get("code") == "external_agent_unconnected"}
        require(
            paths
            == (
                {f"workflow.graph.nodes.{identifier}.data.agent_binding" for identifier in EXTERNAL_IDS}
                if foreign
                else set()
            ),
            "Import did not report exactly the unresolved External node references.",
        )
        actor.report["apps"].append(identifier)
        require(self.stats()["counts"]["send"] == before, "Import dispatched business work.")
        self.report["transfers"].append(
            {
                "kind": "foreign-import" if foreign else "same-import",
                "app_id": identifier,
                "unresolved_nodes": len(paths),
            }
        )
        return identifier

    def actual_execution(self, actor: WorkflowAcceptance, app: str, label: str) -> str:
        """Run the transferred graph and prove both durable nodes reached the peer once."""
        self.phase = actor.phase = label
        before = {
            key for key, value in self.stats()["messages"].items() if value.get("run", "").startswith(self.run_id)
        }
        events = actor.stream(
            actor.client,
            actor.base + f"/apps/{app}/workflows/draft/run",
            {"inputs": {"task": actor.text("working", label)}},
        )
        actor.assert_external_pause(events)
        run = actor.run_identity(events)
        result = actor.wait_run(app, run)
        require(result.get("outputs") == {"text": "task ok"}, "A transferred Workflow lost its final output.")
        rows = actor.call("GET", f"/apps/{app}/workflow-runs/{run}/node-executions")["data"]
        external = [item for item in rows if item.get("node_id") in EXTERNAL_IDS]
        require(
            {item["node_id"] for item in external} == EXTERNAL_IDS, "Both transferred nodes did not persist execution."
        )
        require(
            len(external) == 2
            and all(
                item.get("status") == "succeeded" and item.get("outputs") == {"text": "task ok"} for item in external
            ),
            "A transferred node failed or used an error default instead of the real peer output.",
        )
        sent = [
            value
            for key, value in self.stats()["messages"].items()
            if key not in before and value.get("run", "").startswith(self.run_id)
        ]
        require(
            len(sent) == 2 and all(item["sends"] == 1 for item in sent),
            "Copy/import replayed or skipped business Send.",
        )
        require(
            all(
                "provided_context" in item
                and "provided_task_id" in item
                and item["provided_context"] is None
                and item["provided_task_id"] is None
                for item in sent
            ),
            "A transferred Workflow inherited source execution context or task identity.",
        )
        self.report["checks"].append(label)
        self.report["transfers"].append(
            {
                "kind": "executed",
                "app_id": app,
                "run_id": run,
                "external_execution_ids": [item["id"] for item in external],
                "business_sends": 2,
            }
        )
        return run

    def restored(self, actor: WorkflowAcceptance, app: str, original: dict, prior_epochs: set[str], agent: str) -> dict:
        """Read committed graph and reject lossy config, stale epochs or wrong assets."""
        value = actor.call("GET", f"/apps/{app}/workflows/draft")
        require(
            same_json_value(author_configuration(value), author_configuration(original)),
            "Transfer changed jobs, defaults, selectors, positions or edges.",
        )
        require(not set(epochs(value).values()).intersection(prior_epochs), "Transfer reused a source binding epoch.")
        require(
            all(data["agent_binding"].get("agent_id") == agent for data in external_nodes(value).values()),
            "Same-workspace exact Agent reference did not restore.",
        )
        return value

    def foreign_rebind(self, app: str, original: dict, source_agent: str, target_agent: str) -> None:
        """Prove unresolved imports fail closed, then atomically restore both jobs."""
        actor = self.foreign
        self.phase = actor.phase = "unconnected_foreign_import"
        draft = actor.call("GET", f"/apps/{app}/workflows/draft")
        require(
            same_json_value(author_configuration(draft), author_configuration(original)),
            "Foreign import changed author configuration.",
        )
        require(
            all(
                not data["agent_binding"].get("agent_id") and not data["agent_binding"].get("binding_epoch")
                for data in external_nodes(draft).values()
            ),
            "Foreign import auto-bound a source identity.",
        )
        before = self.stats()["counts"]["send"]
        actor.call("POST", f"/apps/{app}/workflows/publish", expected=(400, 409, 422), json={})
        path = f"/apps/{app}/workflows/draft/external-agent-bindings/external/rebind"
        actor.call(
            "POST",
            path,
            expected=(403, 404),
            json={"target_agent_id": source_agent, "expected_hash": draft["hash"], "include_matching": True},
        )
        actor.call(
            "POST",
            path,
            expected=(409,),
            json={"target_agent_id": target_agent, "expected_hash": "stale-" + draft["hash"], "include_matching": True},
        )
        require(
            actor.call("GET", f"/apps/{app}/workflows/draft")["graph"] == draft["graph"],
            "Denied/stale rebind partially changed a graph.",
        )
        require(self.stats()["counts"]["send"] == before, "Import/preflight/rebind dispatched business work.")
        committed = actor.call(
            "POST",
            path,
            json={"target_agent_id": target_agent, "expected_hash": draft["hash"], "include_matching": True},
        )
        require(
            set(committed["node_ids"]) == EXTERNAL_IDS, "Batch rebind did not select both matching unresolved nodes."
        )
        restored = actor.call("GET", f"/apps/{app}/workflows/draft")
        require(
            same_json_value(author_configuration(restored), author_configuration(original)),
            "Batch rebind changed jobs or edges.",
        )
        require(committed["binding_epochs"] == epochs(restored), "Batch rebind response differs from persisted epochs.")
        require(
            all(data["agent_binding"].get("agent_id") == target_agent for data in external_nodes(restored).values()),
            "Batch rebind did not commit the complete target set.",
        )
        actor.publish(app)
        self.report["checks"].append("foreign_import_unconnected_publish_denied_and_atomic_matching_rebind")

    @override
    def run(self) -> dict:
        """Execute source/copy/same-import/foreign-rebind paths against real APIs."""
        self.login()
        self.foreign.login()
        source_scope = self.call("GET", "/workspaces/current/summary")
        target_scope = self.foreign.call("GET", "/workspaces/current/summary")
        require(
            source_scope["id"] != target_scope["id"] and target_scope["role"] == "owner",
            "The foreign principal is not an Owner of a different workspace.",
        )
        agent = self.create_asset(bearer=os.environ.get("BYOA_FIXTURE_BEARER"))
        target = self.foreign.create_asset()
        app = self.app("workflow")
        original = self.save(app, two_agent_graph(agent))
        prior_epochs = set(epochs(original).values())
        source_run = self.actual_execution(self, app, "source_workflow_executes_two_external_nodes")
        copied = self.copied_app(app)
        copy_draft = self.restored(self, copied, original, prior_epochs, agent)
        prior_epochs.update(epochs(copy_draft).values())
        self.actual_execution(self, copied, "same_workspace_copy_actually_executes_without_old_context")
        content = self.export(app, include_secret=False)
        self.export(app, include_secret=True)
        imported = self.imported_app(self, content, foreign=False)
        import_draft = self.restored(self, imported, original, prior_epochs, agent)
        prior_epochs.update(epochs(import_draft).values())
        self.actual_execution(self, imported, "same_workspace_yaml_import_actually_executes_without_old_context")
        foreign = self.imported_app(self.foreign, content, foreign=True)
        self.foreign_rebind(foreign, original, agent, target)
        foreign_draft = self.foreign.call("GET", f"/apps/{foreign}/workflows/draft")
        require(
            not set(epochs(foreign_draft).values()).intersection(prior_epochs), "Foreign rebind restored an old epoch."
        )
        self.actual_execution(self.foreign, foreign, "foreign_yaml_import_rebind_actually_executes_without_old_context")
        require(
            epochs(self.call("GET", f"/apps/{app}/workflows/draft")) == epochs(original),
            "Transfers modified the source binding history.",
        )
        require(
            self.wait_run(app, source_run).get("outputs") == {"text": "task ok"},
            "Transfers changed the source run's historical output.",
        )
        self.report["checks"].append("source_epoch_and_historical_result_unchanged_after_transfers")
        own = [item for item in self.stats()["messages"].values() if item.get("run", "").startswith(self.run_id)]
        require(
            len(own) == 8 and all(item["sends"] == 1 for item in own),
            "Copy/import/save caused unaccounted business work.",
        )
        self.report.update(
            result="passed",
            finished_at=datetime.now(UTC).isoformat(),
            foreign_workspace_id=target_scope["id"],
            foreign_assets=self.foreign.report["assets"],
            foreign_apps=self.foreign.report["apps"],
            verified_business_messages=len(own),
        )
        return self.report


def main() -> None:
    """Emit sanitized acceptance evidence and fail the process on any failed assertion."""
    runner = DslAcceptance()
    try:
        result = runner.run()
    except Exception as error:
        result: dict[str, Any] = {
            **runner.report,
            "result": "failed",
            "phase": runner.phase,
            "error": str(error) if isinstance(error, AcceptanceError) else type(error).__name__,
        }
    finally:
        runner.close()
    encoded = json.dumps(result, indent=2)
    if destination := os.environ.get("BYOA_DSL_ACCEPTANCE_OUTPUT"):
        Path(destination).write_text(encoded + "\n")
    print(encoded)
    if result["result"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
