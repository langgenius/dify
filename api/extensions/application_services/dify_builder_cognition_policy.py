"""Composition of the Builder policy service and native invocation guard."""

from sqlalchemy.orm import sessionmaker

from core.dify_builder.models import Actor
from extensions.ext_database import db
from repositories.credentials.query_repository import CredentialQueryRepository
from services.dify_builder.application.cognition_policy import CognitionPolicyDeniedError, CognitionPolicyService
from services.dify_builder.cognition_model_gateway import NativeCognitionModels, PolicyModelInstance
from services.dify_builder.repository import SqlDifyBuilderRepository


def build_cognition_policy_service() -> CognitionPolicyService:
    sessions = sessionmaker(bind=db.engine, expire_on_commit=False)
    return CognitionPolicyService(
        SqlDifyBuilderRepository(sessions),
        NativeCognitionModels(
            CredentialQueryRepository(session_factory=sessions),
        ),
    )


def select_cognition_config(actor: Actor, requested: dict | None) -> dict:
    try:
        _require_feature(actor)
        return build_cognition_policy_service().select(actor, requested).config()
    except CognitionPolicyDeniedError:
        raise
    except Exception as exc:
        raise CognitionPolicyDeniedError("model_availability_unknown") from exc


def guarded_cognition_model(tenant_id: str, requested: dict | None, *, account_id: str | None, app_id: str | None):
    """A proxy retains identities/configuration, never cached authorization/keys."""
    if not account_id:
        raise CognitionPolicyDeniedError("policy_permission_denied")
    actor = Actor(tenant_id=tenant_id, account_id=account_id)

    def resolve():
        try:
            _require_feature(actor)
            sessions = sessionmaker(bind=db.engine, expire_on_commit=False)
            repository = SqlDifyBuilderRepository(sessions)
            native = NativeCognitionModels(CredentialQueryRepository(session_factory=sessions))
            policy = CognitionPolicyService(repository, native)
            selected = policy.select(actor, requested)
            instance = native.resolve(actor, selected)
            # External model metadata may take time. Recheck local admission
            # after it, immediately before returning the invocation target.
            policy.authorize_selected(actor, selected)
            if app_id is not None:
                from services.dify_builder.service import AppAccess
                from services.dify_builder.wiring import _authorize_app

                try:
                    _authorize_app(actor, app_id, AppAccess.EDIT)
                except Exception as exc:
                    raise CognitionPolicyDeniedError("policy_permission_denied") from exc
            _require_feature(actor)
            return _ConfiguredInvocation(instance, selected.completion_params)
        except CognitionPolicyDeniedError:
            raise
        except Exception as exc:
            raise CognitionPolicyDeniedError("model_availability_unknown") from exc

    return PolicyModelInstance(resolve)


class _ConfiguredInvocation:
    def __init__(self, instance, parameters):
        self._instance = instance
        self.provider = instance.provider
        self.model_name = instance.model_name
        self._parameters = dict(parameters)

    def get_model_schema(self):
        """Expose native public limits to trusted generation budget clamps."""
        return self._instance.get_model_schema()

    def invoke_llm(self, *, owner_defaults: dict | None = None, **kwargs):
        from services.dify_builder.agent.model_resolver import normalize_completion_params

        # Copied session parameters can belong to a different configured option
        # after fallback. Start clean from the selected policy and accept only
        # defaults explicitly supplied by the trusted generation owner.
        defaults, default_stop = normalize_completion_params(owner_defaults or {})
        parameters, stop = normalize_completion_params(self._parameters)
        merged = {**defaults, **parameters}
        owner_limit = defaults.get("max_tokens")
        policy_limit = parameters.get("max_tokens")
        if isinstance(owner_limit, (int, float)) and isinstance(policy_limit, (int, float)):
            merged["max_tokens"] = min(owner_limit, policy_limit)
        kwargs.update(model_parameters=merged, stop=stop if "stop" in self._parameters else default_stop)
        return self._instance.invoke_llm(**kwargs)


def policy_projection(status) -> dict[str, object]:
    import dataclasses

    result: dict[str, object] = dataclasses.asdict(status.policy)
    result["models"] = [
        {**dataclasses.asdict(model), "health": status.health[model.id]} for model in status.policy.models
    ]
    return {**result, "available": status.available, "reason_code": status.reason_code}


def _require_feature(actor: Actor) -> None:
    from services.feature_service import FeatureService

    if not FeatureService.get_features(actor.tenant_id).dify_builder_enabled:
        raise CognitionPolicyDeniedError("feature_unavailable")
