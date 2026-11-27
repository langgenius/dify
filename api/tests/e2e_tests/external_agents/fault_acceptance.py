"""Prepare/assert worker-recovery faults; host orchestration is intentionally external.

Phases: known_prepare, known_assert, unknown_prepare, unknown_assert. Use the
ConsoleAcceptance environment plus BYOA_FAULT_STATE for an IDs-only state file.
The unknown fixture Task ID is never persisted, reported or sent to Dify. Root
restarts/SIGKILLs only the dedicated worker between prepare/assert invocations.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue

from tests.e2e_tests.external_agents.acceptance import AcceptanceError, ConsoleAcceptance, require

Identifier = Annotated[str, Field(min_length=1, max_length=512, pattern=r"^[A-Za-z0-9_-]+$")]
FaultKind = Literal["known", "unknown"]
Phase = Literal["known_prepare", "known_assert", "unknown_prepare", "unknown_assert"]


class CaseIds(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, hide_input_in_errors=True)
    agent_id: Identifier
    invocation_id: Identifier
    message_id: Identifier
    case_tag: Identifier
    remote_task_id: Identifier | None = None


class StateIds(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, hide_input_in_errors=True)
    known: CaseIds | None = None
    unknown: CaseIds | None = None


class ResultMetadata(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True, strict=True)
    external_task_id: str | None = None
    external_task_status: str = "unknown"
    submission_state: str
    sequence: int = 0


class ResultSnapshot(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True, strict=True)
    invocation_id: str
    state: str
    outputs: dict[str, JsonValue] | None = None
    error_code: str | None = None
    metadata: ResultMetadata


class FixtureEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)
    message_id: str
    send_count: int
    task_count: int
    client_get_count: int
    cancel_count: int
    receipt_barrier: str | None = None
    receipt_started: bool | None = None


class FaultAcceptance(ConsoleAcceptance):
    def __init__(self) -> None:
        super().__init__()
        self.state_path = Path(os.environ["BYOA_FAULT_STATE"])
        self.report.update(scope="dedicated worker recovery fault", maximum_wait_seconds=180)

    def state(self) -> StateIds:
        return StateIds.model_validate_json(self.state_path.read_text()) if self.state_path.exists() else StateIds()

    def save_case(self, kind: FaultKind, case: CaseIds) -> None:
        if kind == "unknown":
            require(case.remote_task_id is None, "Unknown state must not contain a fixture Task ID.")
        old = self.state()
        updated = StateIds(
            known=case if kind == "known" else old.known, unknown=case if kind == "unknown" else old.unknown
        )
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.state_path.with_name(self.state_path.name + ".tmp")
        temporary.write_text(updated.model_dump_json(indent=2, exclude_none=True) + "\n")
        temporary.chmod(0o600)
        temporary.replace(self.state_path)

    def load_case(self, kind: FaultKind) -> CaseIds:
        state = self.state()
        case = state.known if kind == "known" else state.unknown
        require(case is not None, "The fault case has not been prepared.")
        if case is None:
            raise AcceptanceError("The fault case has not been prepared.")
        if kind == "unknown":
            require(case.remote_task_id is None, "Unknown state contains an invalid remote Task ID.")
        self.run_id = case.case_tag
        self.report["run_id"] = case.case_tag
        return case

    @staticmethod
    def remaining(deadline: float, maximum: float) -> float:
        value = deadline - time.monotonic()
        require(value > 0, "Fault recovery exceeded its 180-second wait bound.")
        return min(value, maximum)

    def snapshot(self, case: CaseIds, deadline: float) -> ResultSnapshot:
        # Every Dify read is by its own Invocation anchor, never by fixture Task ID.
        return ResultSnapshot.model_validate(
            self.call(
                "GET",
                f"/external-agents/{case.agent_id}/tests/{case.invocation_id}",
                timeout=self.remaining(deadline, 30),
            )
        )

    def evidence(self, case: CaseIds, deadline: float) -> FixtureEvidence:
        response = self.control.get(self.admin + "/stats", timeout=self.remaining(deadline, 10))
        require(response.status_code == 200, "Fixture statistics could not be read.")
        statistics = response.json()
        messages = [
            (identifier, row) for identifier, row in statistics["messages"].items() if row["run"] == case.case_tag
        ]
        require(len(messages) == 1, "The fault case has an unexpected business-message count.")
        identifier, message = messages[0]
        require(identifier == case.message_id, "The fault case changed its client message ID.")
        if case.remote_task_id is not None:
            require(message["created_task_id"] == case.remote_task_id, "Known Task belongs to another fixture message.")
        # Select values by the client-generated ID. The unknown server Task ID
        # is deliberately not extracted or forwarded to any Dify endpoint.
        tasks = [row for row in statistics["tasks"].values() if row.get("message_id") == case.message_id]
        require(len(tasks) == 1, "The fault case created an unexpected number of server Tasks.")
        evidence = FixtureEvidence.model_validate(
            {
                "message_id": identifier,
                "send_count": message["sends"],
                "task_count": len(tasks),
                "client_get_count": sum(row["gets"] for row in tasks),
                "cancel_count": sum(row["cancel_count"] for row in tasks),
                "receipt_barrier": tasks[0].get("receipt_barrier"),
                "receipt_started": tasks[0].get("receipt_started"),
            }
        )
        require(evidence.send_count == 1, "The fault case replayed its business POST.")
        return evidence

    def prepare(self, kind: FaultKind) -> dict[str, object]:
        self.phase = f"{kind}_prepare"
        scenario = "hold" if kind == "known" else "crash-before-receipt"
        self.run_id += f"-{kind}"
        self.report["run_id"] = self.run_id
        agent = self.create_asset()
        started, _payload = self.start(agent, scenario)
        self.phase = f"{kind}_prepare"
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            response = self.control.get(self.admin + "/stats", timeout=self.remaining(deadline, 10))
            require(response.status_code == 200, "Fixture statistics could not be read during preparation.")
            statistics = response.json()
            rows = [
                (identifier, row) for identifier, row in statistics["messages"].items() if row["run"] == self.run_id
            ]
            if rows:
                require(len(rows) == 1, "Preparation observed more than one business message.")
                message_id, message = rows[0]
                require(message["sends"] == 1, "Preparation observed a repeated business POST.")
                pending = CaseIds(
                    agent_id=agent, invocation_id=started["invocation_id"], message_id=message_id, case_tag=self.run_id
                )
                current = self.snapshot(pending, deadline)
                if kind == "known" and current.metadata.external_task_id:
                    case = pending.model_copy(update={"remote_task_id": current.metadata.external_task_id})
                    evidence = self.evidence(case, deadline)
                    self.save_case(kind, case)
                    self.report.update(
                        result="prepared",
                        case=case.model_dump(exclude_none=True),
                        fixture_evidence=evidence.model_dump(),
                        next_action="restart dedicated worker",
                    )
                    return self.report
                if kind == "unknown":
                    evidence = self.evidence(pending, deadline)
                    require(
                        evidence.receipt_barrier == "waiting" and evidence.receipt_started is False,
                        "Unknown preparation did not catch the pre-response barrier.",
                    )
                    require(
                        current.metadata.external_task_id is None, "Unknown preparation already received a Task ID."
                    )
                    require(evidence.client_get_count == 0, "Unknown preparation queried a secret server Task ID.")
                    self.save_case(kind, pending)
                    self.report.update(
                        result="prepared",
                        case=pending.model_dump(exclude_none=True),
                        fixture_evidence=evidence.model_dump(),
                        next_action="SIGKILL and restart dedicated worker",
                    )
                    return self.report
            time.sleep(0.1)
        raise AcceptanceError("Fault preparation exceeded its 180-second wait bound.")

    def assert_recovery(self, kind: FaultKind) -> dict[str, object]:
        self.phase = f"{kind}_assert"
        case = self.load_case(kind)
        deadline = time.monotonic() + 180
        if kind == "known":
            require(case.remote_task_id is not None, "Known case has no durably observed Task ID.")
            before = self.snapshot(case, deadline)
            require(before.metadata.external_task_id == case.remote_task_id, "Restart lost the known Task association.")
        else:
            before = self.snapshot(case, deadline)
            require(before.metadata.external_task_id is None, "Unknown recovery acquired a fixture Task ID.")
            evidence = self.evidence(case, deadline)
            require(
                evidence.client_get_count == 0 and evidence.cancel_count == 0,
                "Unknown recovery queried or canceled an undisclosed server Task.",
            )
        # Control traffic is isolated to the fixture. Unknown uses only the
        # original client message ID, never the fixture's secret Task ID.
        release = {"task_id": case.remote_task_id} if kind == "known" else {"message_id": case.message_id}
        response = self.control.post(self.admin + "/release", json=release, timeout=self.remaining(deadline, 10))
        require(response.status_code == 200, "Fixture barrier could not be released.")
        while time.monotonic() < deadline:
            current = self.snapshot(case, deadline)
            evidence = self.evidence(case, deadline)
            if kind == "known":
                require(current.metadata.external_task_id == case.remote_task_id, "Recovery switched to another Task.")
                if current.state == "succeeded":
                    require(
                        current.invocation_id == case.invocation_id and current.metadata.sequence == 0,
                        "Known recovery created another Invocation.",
                    )
                    require(
                        current.outputs == {"text": "task ok"}, "Known recovery did not publish the old Task result."
                    )
                    self.report.update(
                        result="passed",
                        case=case.model_dump(exclude_none=True),
                        fixture_evidence=evidence.model_dump(),
                        result_snapshot=current.model_dump(),
                    )
                    return self.report
            else:
                require(current.metadata.external_task_id is None, "Unknown recovery acquired a fixture Task ID.")
                require(
                    evidence.client_get_count == 0 and evidence.cancel_count == 0,
                    "Unknown recovery used an undisclosed server Task ID.",
                )
                if current.metadata.submission_state == "submission_unknown":
                    require(
                        current.state != "succeeded" and current.outputs is None,
                        "Unknown submission was revived as a successful result.",
                    )
                    self.report.update(
                        result="passed",
                        case=case.model_dump(exclude_none=True),
                        fixture_evidence=evidence.model_dump(),
                        result_snapshot=current.model_dump(),
                    )
                    return self.report
            time.sleep(0.5)
        raise AcceptanceError("Fault recovery exceeded its 180-second wait bound.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("known_prepare", "known_assert", "unknown_prepare", "unknown_assert"))
    args = parser.parse_args()
    runner = FaultAcceptance()
    try:
        runner.login()
        kind: FaultKind = "known" if args.phase.startswith("known_") else "unknown"
        result = runner.prepare(kind) if args.phase.endswith("_prepare") else runner.assert_recovery(kind)
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
    target = (
        os.environ.get("BYOA_FAULT_ACCEPTANCE_OUTPUT")
        or os.environ.get("BYOA_FAULT_OUTPUT")
        or os.environ.get("BYOA_ACCEPTANCE_OUTPUT")
    )
    if target:
        Path(target).write_text(encoded + "\n")
    print(encoded)
    if result["result"] not in {"passed", "prepared"}:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
