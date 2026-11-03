"""Evaluate the OpenUI prompt with an existing workspace model configuration.

Run from the repository root with ``uv run --project api python
api/dev/evaluate_generative_ui.py --app-id UUID --output /tmp/openui-evaluation.json``.
This calls the configured model and incurs its normal usage. It evaluates prompt
output, not the Chatflow/Agent integration or browser rendering. Automated checks
cover UI presence and fence completion only; semantic rubrics remain for review.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
import time
from collections.abc import Sequence
from contextlib import chdir
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Literal
from uuid import UUID

from pydantic import BaseModel, Field, TypeAdapter

from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    SystemPromptMessage,
    UserPromptMessage,
)

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from libs.generative_ui import OpenUIContentBlock, OpenUIStreamParser  # noqa: E402
from libs.generative_ui_prompt import load_generative_ui_prompt  # noqa: E402

if TYPE_CHECKING:
    from core.model_manager import ModelInstance
    from dify_app import DifyApp

DEFAULT_CASES = API_ROOT / "resources/generative_ui/quality-cases.json"


class HistoryMessage(BaseModel):
    role: Literal["assistant", "user"]
    content: str


class QualityCase(BaseModel):
    id: str
    prompt: str
    history: list[HistoryMessage] = Field(default_factory=list)
    ui: Literal["required", "forbidden", "optional"]
    rubric: list[str]


class AutomatedChecks(BaseModel):
    ui_policy: bool
    fences_complete: bool

    @property
    def passed(self) -> bool:
        return self.ui_policy and self.fences_complete


class CaseResult(BaseModel):
    case: QualityCase
    raw_response: str
    prose: str
    content_blocks: list[OpenUIContentBlock]
    elapsed_seconds: float
    automated_checks: AutomatedChecks | None
    semantic_review: Literal["pending"] = "pending"
    error_type: str | None = None


class EvaluationReport(BaseModel):
    app_id: str
    provider: str
    model: str
    started_at: datetime
    system_prompt_sha256: str
    evaluation_scope: str = "Prompt output only; semantic quality and integration require separate review."
    results: list[CaseResult] = Field(default_factory=list)


def load_cases(path: Path, selected_ids: Sequence[str]) -> list[QualityCase]:
    cases = TypeAdapter(list[QualityCase]).validate_json(path.read_text(encoding="utf-8"))
    available_ids = {case.id for case in cases}
    if len(available_ids) != len(cases):
        raise ValueError("Evaluation case IDs must be unique")
    unknown_ids = set(selected_ids) - available_ids
    if unknown_ids:
        raise ValueError(f"Unknown evaluation cases: {', '.join(sorted(unknown_ids))}")
    return [case for case in cases if not selected_ids or case.id in selected_ids]


def build_prompt(case: QualityCase, system_prompt: str) -> list[PromptMessage]:
    messages: list[PromptMessage] = [SystemPromptMessage(content=system_prompt)]
    for message in case.history:
        if message.role == "assistant":
            messages.append(AssistantPromptMessage(content=message.content))
        else:
            messages.append(UserPromptMessage(content=message.content))
    messages.append(UserPromptMessage(content=case.prompt))
    return messages


def assess_response(case: QualityCase, response: str, elapsed_seconds: float) -> CaseResult:
    """Inspect transport shape without claiming that the UI source is valid or accurate."""
    parser = OpenUIStreamParser(case.id)
    parts = parser.feed(response) + parser.finish("completed")
    has_ui = bool(parser.blocks)
    ui_policy = case.ui == "optional" or (has_ui if case.ui == "required" else not has_ui)
    return CaseResult(
        case=case,
        raw_response=response,
        prose="".join(part for part in parts if isinstance(part, str)),
        content_blocks=parser.blocks,
        elapsed_seconds=elapsed_seconds,
        automated_checks=AutomatedChecks(
            ui_policy=ui_policy,
            fences_complete=all(block.status == "completed" for block in parser.blocks),
        ),
    )


def initialize_evaluation_app() -> DifyApp:
    """Initialize configured model dependencies without HTTP servers or background workers."""
    from app_factory import create_flask_app_with_configs
    from extensions import (
        ext_database,
        ext_hosting_provider,
        ext_key_provider,
        ext_redis,
        ext_session_factory,
        ext_storage,
    )

    app = create_flask_app_with_configs()
    for extension in (
        ext_database,
        ext_redis,
        ext_storage,
        ext_key_provider,
        ext_hosting_provider,
        ext_session_factory,
    ):
        extension.init_app(app)
    return app


def resolve_model(app_id: UUID, provider: str | None, model: str | None) -> ModelInstance:
    """Resolve the app's workspace and use only its existing provider credentials."""
    from core.db.session_factory import get_session_maker
    from core.model_manager import ModelManager
    from graphon.model_runtime.entities.model_entities import ModelType
    from repositories.app_definition_query_repository import AppDefinitionQueryRepository

    app_record = AppDefinitionQueryRepository(session_factory=get_session_maker()).get_service_api_record(str(app_id))
    if app_record is None:
        raise ValueError("The selected app does not exist")
    manager = ModelManager.for_tenant(app_record.tenant_id)
    if provider is not None and model is not None:
        return manager.get_model_instance(app_record.tenant_id, provider, ModelType.LLM, model)
    return manager.get_default_model_instance(app_record.tenant_id, ModelType.LLM)


def run_evaluation(
    app_id: UUID,
    model: ModelInstance,
    cases: Sequence[QualityCase],
    output: Path,
) -> EvaluationReport:
    """Save each completed result; record exception types without provider secrets."""
    system_prompt = load_generative_ui_prompt()
    report = EvaluationReport(
        app_id=str(app_id),
        provider=model.provider,
        model=model.model_name,
        started_at=datetime.now(UTC),
        system_prompt_sha256=hashlib.sha256(system_prompt.encode()).hexdigest(),
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    for case in cases:
        started = time.perf_counter()
        try:
            response = model.invoke_llm(prompt_messages=build_prompt(case, system_prompt), stream=False)
            result = assess_response(case, response.message.get_text_content(), time.perf_counter() - started)
        except Exception as error:
            result = CaseResult(
                case=case,
                raw_response="",
                prose="",
                content_blocks=[],
                elapsed_seconds=time.perf_counter() - started,
                automated_checks=None,
                error_type=type(error).__name__,
            )
        report.results.append(result)
        output.write_text(report.model_dump_json(indent=2) + "\n", encoding="utf-8")
    return report


def main(argv: Sequence[str] | None = None) -> int:
    """Use the API's native dotenv loader and resolve output paths before changing directory."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-id", required=True, type=UUID)
    parser.add_argument("--provider", help="Configured provider ID; requires --model")
    parser.add_argument("--model", help="Configured model name; requires --provider")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--case", action="append", default=[], help="Case ID to run; repeat to select multiple cases")
    args = parser.parse_args(argv)
    if (args.provider is None) != (args.model is None):
        parser.error("--provider and --model must be supplied together")
    try:
        cases = load_cases(DEFAULT_CASES, args.case)
    except ValueError as error:
        parser.error(str(error))
    output = args.output.resolve()
    try:
        with chdir(API_ROOT):
            app = initialize_evaluation_app()
            with app.app_context():
                model = resolve_model(args.app_id, args.provider, args.model)
                report = run_evaluation(args.app_id, model, cases, output)
    except Exception as error:
        sys.stderr.write(
            f"Evaluation setup failed ({type(error).__name__}); check app and configured runtime services.\n"
        )
        return 2
    failures = sum(result.automated_checks is None or not result.automated_checks.passed for result in report.results)
    sys.stdout.write(
        f"Saved {len(report.results)} cases to {args.output}; {failures} automated failures; semantic review pending.\n"
    )
    return int(failures > 0)


if __name__ == "__main__":
    raise SystemExit(main())
