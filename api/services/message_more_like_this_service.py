"""Regenerate an owned completion using its historical configuration.

HTTP callers admit the app and actor. This service checks the current feature
setting before loading the historical model configuration, then releases all
query sessions before the generator restores files or resolves a model.
"""

import json
from collections.abc import Iterator, Mapping
from copy import deepcopy
from dataclasses import dataclass
from typing import Protocol

from pydantic import JsonValue

from services.entities.message_entities import MessageActor
from services.errors.app import MoreLikeThisDisabledError
from services.errors.app_model_config import AppModelConfigBrokenError


@dataclass(frozen=True, slots=True)
class MoreLikeThisFile:
    """Persisted attachment reference, without metadata or content I/O.

    ``url`` is absent for local uploads; ``upload_file_id`` is absent for remote
    URLs and some historical tool files whose identifier is encoded in the URL.
    """

    id: str
    type: str
    transfer_method: str
    url: str | None
    upload_file_id: str | None


@dataclass(frozen=True, slots=True)
class MoreLikeThisSource:
    """Authorized source data detached from its database session.

    A null current feature configuration means the feature is disabled. A null
    historical model configuration id means the original configuration is no
    longer available, including when its conversation is missing or out of scope.
    """

    app_id: str
    tenant_id: str
    query: str
    inputs: dict[str, JsonValue]
    files: tuple[MoreLikeThisFile, ...]
    current_feature_config: str | None
    historical_model_config_id: str | None


class MoreLikeThisNotCompletionError(ValueError):
    """The current app mode cannot regenerate a completion."""


class MoreLikeThisConfigNotFoundError(LookupError):
    """The source message's historical model configuration is unavailable."""


class MoreLikeThisStream(Protocol):
    def __iter__(self) -> Iterator[str]: ...

    def __next__(self) -> str: ...

    def close(self) -> None: ...


type MoreLikeThisResponse = Mapping[str, object] | MoreLikeThisStream


class MoreLikeThisRepository(Protocol):
    def get_more_like_this_source(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        actor: MessageActor,
        message_id: str,
    ) -> MoreLikeThisSource: ...

    def get_more_like_this_model_config(
        self, *, app_id: str, app_owner_tenant_id: str, model_config_id: str
    ) -> dict[str, JsonValue] | None:
        """Return the app-owned historical configuration, or None when unavailable."""
        ...


class MoreLikeThisGenerator(Protocol):
    def generate(
        self,
        *,
        source: MoreLikeThisSource,
        actor: MessageActor,
        model_config: dict[str, JsonValue],
        streaming: bool,
    ) -> MoreLikeThisResponse: ...


class MessageMoreLikeThisService:
    def __init__(self, *, repository: MoreLikeThisRepository, generator: MoreLikeThisGenerator) -> None:
        self._repository: MoreLikeThisRepository = repository
        self._generator: MoreLikeThisGenerator = generator

    def generate(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        actor: MessageActor,
        message_id: str,
        streaming: bool,
    ) -> MoreLikeThisResponse:
        source = self._repository.get_more_like_this_source(
            app_id=app_id,
            app_owner_tenant_id=app_owner_tenant_id,
            actor=actor,
            message_id=message_id,
        )
        feature = source.current_feature_config
        if not feature:
            raise MoreLikeThisDisabledError()
        try:
            feature_config: JsonValue = json.loads(feature)
        except json.JSONDecodeError as error:
            raise AppModelConfigBrokenError(
                f"App {app_id}, message {message_id}: current more_like_this configuration is not valid JSON"
            ) from error
        if not isinstance(feature_config, dict):
            raise AppModelConfigBrokenError(
                f"App {app_id}, message {message_id}: current more_like_this configuration must be an object"
            )
        if feature_config.get("enabled", False) is False:
            raise MoreLikeThisDisabledError()

        if source.historical_model_config_id is None:
            raise MoreLikeThisConfigNotFoundError(f"Historical model configuration for message {message_id} is missing")
        model_config = self._repository.get_more_like_this_model_config(
            app_id=source.app_id,
            app_owner_tenant_id=source.tenant_id,
            model_config_id=source.historical_model_config_id,
        )
        if model_config is None:
            raise MoreLikeThisConfigNotFoundError(f"Historical model configuration for message {message_id} is missing")

        # Regeneration changes only sampling temperature, keeping the historical
        # model, prompt and inputs independent of the app's current configuration.
        model_config = deepcopy(model_config)
        model = model_config.get("model")
        if not isinstance(model, dict) or not model:
            raise AppModelConfigBrokenError(
                f"App {app_id}, message {message_id}, configuration {source.historical_model_config_id}: "
                "historical configuration must contain a model object"
            )
        parameters = model.get("completion_params", {})
        if not isinstance(parameters, dict):
            raise AppModelConfigBrokenError(
                f"App {app_id}, message {message_id}, configuration {source.historical_model_config_id}: "
                "historical model.completion_params must be an object"
            )
        parameters["temperature"] = 0.9
        model["completion_params"] = parameters
        return self._generator.generate(source=source, actor=actor, model_config=model_config, streaming=streaming)
