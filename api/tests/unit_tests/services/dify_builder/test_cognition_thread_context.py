"""Builder's fresh admission remains available in generation worker threads."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from threading import get_ident

import pytest
from flask import Flask, current_app, has_app_context
from flask_sqlalchemy import SQLAlchemy

from core.dify_builder.models import Actor
from core.model_manager import ModelInstance
from extensions.application_services import dify_builder_cognition_policy as composition
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from services.dify_builder.application.cognition_policy import (
    CognitionModel,
    CognitionPolicy,
    CognitionPolicyDeniedError,
)
from services.dify_builder.cognition_model_gateway import PolicyModelInstance
from services.workflow_generation.runner import WorkflowGenerator
from tests.helpers.unit.core.model_fixtures import make_model_instance
from tests.unit_tests.services.dify_builder.test_cognition_policy import MODEL, Models, Policies


@pytest.mark.parametrize("provider_fails", [False, True])
def test_threaded_generation_rechecks_current_policy_without_losing_application_context(
    monkeypatch: pytest.MonkeyPatch, provider_fails: bool
) -> None:
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite://"
    database = SQLAlchemy(app)
    monkeypatch.setattr(composition, "db", database)
    policies = Policies()
    policies.policy = CognitionPolicy(True, (MODEL,), MODEL.id, (), 1, "explicit")
    native = make_model_instance(provider=MODEL.provider, model=MODEL.name)
    calls: list[tuple[int, dict[str, object], bool]] = []

    class Native(Models):
        def resolve(self, _actor: Actor, _model: CognitionModel) -> ModelInstance:
            return native

    def feature(_actor: Actor | None) -> None:
        assert current_app.name == app.name

    def invoke(**kwargs: object) -> LLMResult:
        calls.append((get_ident(), kwargs, has_app_context()))
        if provider_fails:
            raise RuntimeError("unknown request outcome")
        return LLMResult(model=MODEL.name, message=AssistantPromptMessage(content="ok"), usage=LLMUsage.empty_usage())

    monkeypatch.setattr(composition, "_require_feature", feature)
    monkeypatch.setattr(composition, "SqlDifyBuilderRepository", lambda _sessions: policies)
    monkeypatch.setattr(composition, "NativeCognitionModels", lambda _credentials: Native())
    monkeypatch.setattr(native.model_type_instance, "invoke", invoke)
    from services.dify_builder import wiring

    monkeypatch.setattr(wiring, "_authorize_app", lambda *_args: feature(None))

    def complete(model: PolicyModelInstance) -> LLMResult:
        return WorkflowGenerator._invoke_with_retry(
            model_instance=model, prompt_messages=[], model_parameters={}, stage="Builder"
        )

    with app.app_context():
        parent_thread = get_ident()
        model = composition.guarded_cognition_model("tenant", None, account_id="member", app_id="app")
        with ThreadPoolExecutor(max_workers=1) as pool:
            if provider_fails:
                with pytest.raises(CognitionPolicyDeniedError, match="model_invocation_failed"):
                    pool.submit(complete, model).result()
                assert len(calls) == 1
            else:
                assert complete(model).message.content == "ok"
                assert pool.submit(complete, model).result().message.content == "ok"
                assert len(calls) == 2
                assert calls[0][0] == parent_thread
                assert calls[1][0] != parent_thread
                assert calls[1][1]["model_parameters"] == {"temperature": 0.2}
                # Native ModelInstance's provider dispatch itself works without
                # Flask; fresh policy admission is the thread-context consumer.
                assert calls[1][2] is False
                policies.policy = replace(policies.policy, enabled=False, revision=2)
                with pytest.raises(CognitionPolicyDeniedError, match="builder_disabled"):
                    pool.submit(complete, model).result()
                assert len(calls) == 2
