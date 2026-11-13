"""Real Overview/Workflow strict output and Error Handling acceptance.

Requires the standard DIFY_TEST_* / BYOA_FIXTURE_* environment. The peer's
private matrix descriptor endpoint only selects controlled output; all product
requests, mapping, durable outcomes and graph branches execute normally. A
passing report proves exact values, correct node-vs-Workflow status and one Send
per accepted task. No remote retry is permitted for invalid or ambiguous output.
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import override
from uuid import uuid4

from tests.e2e_tests.external_agents.acceptance import AcceptanceError, require
from tests.e2e_tests.external_agents.matrix_support import MatrixAcceptance


class OutputErrorAcceptance(MatrixAcceptance):
    """Exercise the product's strict mapper and Graphon branches through HTTP."""

    def admission_cases(self, agent: str) -> None:
        """File-valued defaults fail before Invocation admission or business Send.

        Empty Array[File]/Object values are otherwise legal container values;
        the expected reason specifically proves the frozen File-default gate.
        The later normal matrix proves legal 0/false/empty defaults still work.
        """
        file = {"name": "attachment", "kind": "file", "required": False}
        cases = [
            ("file-default-is-forbidden", {**file, "has_default": True, "default": None}),
            (
                "array-file-default-is-forbidden",
                {"name": "attachments", "kind": "array", "item": file, "has_default": True, "default": []},
            ),
            (
                "object-containing-file-default-is-forbidden",
                {"name": "record", "kind": "object", "children": [file], "has_default": True, "default": {}},
            ),
            (
                "nested-file-leaf-default-is-forbidden",
                {"name": "record", "kind": "object", "children": [{**file, "has_default": True, "default": None}]},
            ),
        ]
        detail = self.call("GET", f"/external-agents/{agent}")
        for case, field in cases:
            self.phase = case
            before = self.stats()["counts"]["send"]
            response = self.client.post(
                self.base + f"/external-agents/{agent}/tests",
                json={
                    "page_session_id": f"matrix-{self.run_id}-{case}",
                    "expected_generation": detail["asset"]["test_display_generation"],
                    "idempotency_key": str(uuid4()),
                    "task_text": self.text("direct", "file default admission must reject"),
                    "outputs": [field],
                },
            )
            require(response.status_code in {400, 422}, "A File default did not fail HTTP admission.")
            rejected = response.json()
            require("invocation_id" not in rejected, "A rejected File default created an Invocation identity.")
            require(
                "File-valued defaults are not supported" in rejected.get("message", ""),
                "File defaults were rejected for an unrelated payload error.",
            )
            require(self.stats()["counts"]["send"] == before, "A rejected File default dispatched business Send.")
            self.report["checks"].append(case)
            self.report.setdefault("admission_cases", []).append(
                {
                    "case": case,
                    "http_status": response.status_code,
                    "invocation_id_returned": False,
                    "business_sends": 0,
                }
            )

    def overview_cases(self, agent: str) -> None:
        """Reject coercion/null/duplicates and preserve legal false/zero/empty defaults."""
        scalar = [{"name": "text", "kind": "string"}]
        self.register("plain-text", artifacts=[{"artifactId": "plain", "parts": [{"text": "plain text ok"}]}])
        self.overview(agent, "plain-text", scalar, state="succeeded", expected={"text": "plain text ok"})
        fields = [
            {"name": "zero", "kind": "number"},
            {"name": "flag", "kind": "boolean"},
            {"name": "empty", "kind": "string"},
            {"name": "items", "kind": "array", "item": {"name": "item", "kind": "number"}},
            {"name": "object", "kind": "object", "children": [{"name": "kept", "kind": "number"}]},
            {"name": "optional", "kind": "string", "required": False},
        ]
        legal = {"zero": 0, "flag": False, "empty": "", "items": [], "object": {"kept": 1}}
        self.register(
            "strict-valid-values", data={**legal, "object": {"kept": 1, "extra_child": "drop"}, "extra": "drop"}
        )
        self.overview(agent, "strict-valid-values", fields, state="succeeded", expected=legal)
        defaults = [
            {"name": "zero", "kind": "number", "has_default": True, "default": 0},
            {"name": "flag", "kind": "boolean", "has_default": True, "default": False},
            {"name": "empty", "kind": "string", "has_default": True, "default": ""},
            {
                "name": "items",
                "kind": "array",
                "item": {"name": "item", "kind": "number"},
                "has_default": True,
                "default": [],
            },
        ]
        expected = {"zero": 0, "flag": False, "empty": "", "items": []}
        for case, data in (
            ("missing-fields-use-typed-defaults", {}),
            ("invalid-fields-use-typed-defaults", {"zero": "0", "flag": 0, "empty": None, "items": [1, "bad"]}),
        ):
            self.register(case, data=data)
            self.overview(agent, case, defaults, state="succeeded", expected=expected)
        self.register("optional-missing-is-omitted", data={"text": "kept"})
        self.overview(
            agent,
            "optional-missing-is-omitted",
            [*scalar, {"name": "maybe", "kind": "string", "required": False}],
            state="succeeded",
            expected={"text": "kept"},
        )
        bad = [
            ("required-missing", {}, scalar),
            ("field-name-is-case-sensitive", {"Text": "wrong case"}, scalar),
            ("required-null", {"text": None}, scalar),
            ("optional-present-null", {"maybe": None}, [{"name": "maybe", "kind": "string", "required": False}]),
            ("boolean-is-not-number", {"zero": False}, [{"name": "zero", "kind": "number"}]),
            ("string-is-not-number", {"zero": "0"}, [{"name": "zero", "kind": "number"}]),
            (
                "invalid-array-element",
                {"items": [1, "2"]},
                [{"name": "items", "kind": "array", "item": {"name": "item", "kind": "number"}}],
            ),
            (
                "object-is-not-array",
                {"items": {}},
                [{"name": "items", "kind": "array", "item": {"name": "item", "kind": "number"}}],
            ),
        ]
        for case, data, declarations in bad:
            self.register(case, data=data)
            self.overview(agent, case, declarations, state="failed", code="output_validation_failed")
        self.register(
            "invalid-explicit-json",
            artifacts=[{"artifactId": "json", "parts": [{"text": '{"text":', "mediaType": "application/json"}]}],
        )
        self.overview(agent, "invalid-explicit-json", scalar, state="failed", code="invalid_structured_output")
        self.register(
            "duplicate-json-key",
            artifacts=[
                {
                    "artifactId": "json",
                    "parts": [{"text": '{"text":"one","text":"two"}', "mediaType": "application/json"}],
                }
            ],
        )
        self.overview(agent, "duplicate-json-key", scalar, state="failed", code="ambiguous_output")
        self.register(
            "ambiguous-cannot-use-field-default",
            artifacts=[{"artifactId": "ambiguous", "parts": [{"data": {"text": "one"}}, {"data": {"text": "two"}}]}],
        )
        self.overview(
            agent,
            "ambiguous-cannot-use-field-default",
            [{"name": "text", "kind": "string", "has_default": True, "default": "must-not-mask"}],
            state="failed",
            code="ambiguous_output",
        )

    def workflow_cases(self, agent: str) -> None:
        """Distinguish a validated field default from node default/fail branch/stop."""
        self.register("workflow-field-default-precedes-node-default", data={})
        self.workflow_output(
            agent,
            "workflow-field-default-precedes-node-default",
            [{"name": "text", "type": "string", "default_value": "field fallback"}],
            expected_status="succeeded",
            expected_outputs={"text": "field fallback"},
            strategy="default-value",
            defaults=[{"key": "text", "type": "string", "value": "node fallback"}],
        )
        self.register("workflow-node-default-is-handled-error", data={"text": 7})
        self.workflow_output(
            agent,
            "workflow-node-default-is-handled-error",
            [{"name": "text", "type": "string"}],
            expected_status="partial-succeeded",
            expected_outputs={"text": "node fallback"},
            strategy="default-value",
            defaults=[{"key": "text", "type": "string", "value": "node fallback"}],
        )
        self.register("workflow-fail-branch-is-handled-error", data={"text": 7})
        self.workflow_output(
            agent,
            "workflow-fail-branch-is-handled-error",
            [{"name": "text", "type": "string"}],
            expected_status="partial-succeeded",
            expected_outputs={"error_type": "output_validation_failed"},
            strategy="fail-branch",
            branch=True,
        )
        self.register("workflow-no-handler-stops", data={"text": 7})
        self.workflow_output(
            agent,
            "workflow-no-handler-stops",
            [{"name": "text", "type": "string"}],
            expected_status="failed",
            expected_outputs={},
        )
        self.register(
            "workflow-ambiguity-blocks-node-default",
            artifacts=[{"artifactId": "ambiguous", "parts": [{"data": {"text": "one"}}, {"data": {"text": "two"}}]}],
        )
        self.workflow_output(
            agent,
            "workflow-ambiguity-blocks-node-default",
            [{"name": "text", "type": "string"}],
            expected_status="failed",
            expected_outputs={},
            strategy="default-value",
            defaults=[{"key": "text", "type": "string", "value": "must-not-mask"}],
        )
        self.register("workflow-node-typed-empty-defaults", data={})
        declarations = [
            {"name": "zero", "type": "number"},
            {"name": "flag", "type": "boolean"},
            {"name": "empty", "type": "string"},
            {"name": "items", "type": "array", "array_item": {"type": "number"}},
        ]
        defaults = [
            {"key": "zero", "type": "number", "value": 0},
            {"key": "flag", "type": "boolean", "value": False},
            {"key": "empty", "type": "string", "value": ""},
            {"key": "items", "type": "array[number]", "value": []},
        ]
        self.workflow_output(
            agent,
            "workflow-node-typed-empty-defaults",
            declarations,
            expected_status="partial-succeeded",
            expected_outputs={"zero": 0, "flag": False, "empty": "", "items": []},
            strategy="default-value",
            defaults=defaults,
        )

    @override
    def run(self) -> dict:
        """Pass only after all real task/output/branch assertions have completed."""
        self.login()
        agent = self.create_asset()
        self.report["scope"] = "real Overview + Workflow strict outputs, legal defaults and Error Handling"
        self.admission_cases(agent)
        self.overview_cases(agent)
        self.workflow_cases(agent)
        self.report.update(result="passed", finished_at=datetime.now(UTC).isoformat())
        return self.report


def main() -> None:
    """Emit static failure diagnostics and ID-only evidence, never raw outputs."""
    runner = OutputErrorAcceptance()
    try:
        result = runner.run()
    except Exception as error:
        result = {
            **runner.report,
            "result": "failed",
            "phase": runner.phase,
            "error": str(error) if isinstance(error, AcceptanceError) else type(error).__name__,
        }
    finally:
        runner.close()
    encoded = json.dumps(result, indent=2)
    if destination := os.environ.get("BYOA_OUTPUT_ERROR_ACCEPTANCE_OUTPUT"):
        Path(destination).write_text(encoded + "\n")
    print(encoded)
    if result["result"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
