from __future__ import annotations

from collections.abc import Callable
from functools import partial, wraps
from typing import Any
from uuid import UUID

from flask import request
from werkzeug.exceptions import HTTPException, NotFound, Unauthorized

from configs import dify_config
from constants.oauth_bearer import TokenType
from controllers.openapi import api
from controllers.openapi._audit import emit_personal_request
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.personal_access import authenticate_personal_token
from controllers.openapi.auth.pipelines import pipeline_for_subject
from controllers.openapi.auth.requirements import assert_license_valid
from controllers.openapi.auth.resource_access import authenticate_resource_token
from controllers.openapi.auth.spec import EndpointSpec, Kind
from controllers.openapi.auth.subjects import subject_from_auth
from core.db.session_factory import session_factory
from core.logging.context import get_trace_id
from enums import DeploymentEdition
from libs.oauth_bearer import InvalidBearerError, assert_bearer_feature_enabled, extract_bearer, get_authenticator
from services.auth.resource_access_token_contracts import is_resource_access_token


class AuthRouter:
    def guard(self, spec: EndpointSpec) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        def decorator(view: Callable[..., Any]) -> Callable[..., Any]:
            @wraps(view)
            def decorated(*args: Any, **kwargs: Any) -> Any:
                return self._execute(spec, partial(view, *args, **kwargs))

            return decorated

        return decorator

    def _execute(self, spec: EndpointSpec, call: Callable[..., Any]) -> Any:
        """The order is the contract. An endpoint the edition does not expose
        answers 404 before anything reveals whether the bearer was valid, and
        an enterprise deployment's licence answers 403 before the missing-bearer
        401. The licence is a fact about the deployment, not the route or the
        caller, so this is the one place it is checked. The bearer feature flag
        is the same kind of fact and answers 503 next.
        """
        if not spec.allows(dify_config.DEPLOYMENT_EDITION):
            raise NotFound()
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.ENTERPRISE:
            assert_license_valid()
        assert_bearer_feature_enabled()

        token = extract_bearer(request)
        is_resource_token = bool(token and is_resource_access_token(token))
        if not token:
            raise Unauthorized("bearer required")

        try:
            if token.startswith(TokenType.PERSONAL_ACCESS.prefix):
                auth = authenticate_personal_token(token)
            elif is_resource_token:
                auth = authenticate_resource_token(token)
            else:
                auth = get_authenticator().authenticate(token)
        except InvalidBearerError as caught_error:
            # One answer for every rejection reason - unknown prefix, no live row,
            # expired - so a caller cannot probe which one it hit. Same reasoning as
            # the 404-not-403 elsewhere on this surface.
            raise Unauthorized("invalid bearer") from caught_error
        subject = subject_from_auth(auth)
        pipeline = pipeline_for_subject(subject)

        # The pipeline closes the admission session before handlers that use only
        # identity values or no context; ORM handlers keep sharing it.
        with session_factory.create_session() as session:
            ctx = Context(
                subject,
                session,
                dict(request.view_args or {}),
                trace_id=get_trace_id() or request.headers.get("X-Trace-Id"),
            )
            status = 500
            try:
                result = pipeline.run(
                    subject=subject,
                    auth=auth,
                    spec=spec,
                    ctx=ctx,
                    session=session,
                    call=call,
                )
                session.commit()
                status = result.status_code if hasattr(result, "status_code") else 200
                if isinstance(result, tuple) and len(result) > 1 and isinstance(result[1], int):
                    status = result[1]
                return result
            except Exception as error:
                if isinstance(error, HTTPException):
                    status = error.code or 500
                else:
                    try:
                        status, _ = api.resolve_error(type(error))
                    except ValueError:
                        status = 500
                session.rollback()  # guard-ignore: no-new-controller-sqlalchemy -- the router owns the rollback
                raise
            finally:
                if auth.token_type is TokenType.PERSONAL_ACCESS:
                    # Route templates and UUID-only identifiers prevent raw request
                    # data, form tokens, headers or secrets entering audit records.
                    target_ids = {}
                    targets = {"workspace_id": request.args.get("workspace_id"), **(request.view_args or {})}
                    for key, value in targets.items():
                        if not key.endswith("_id"):
                            continue
                        try:
                            target_ids[key] = str(UUID(str(value)))
                        except ValueError:
                            continue
                    emit_personal_request(
                        token_id=str(auth.token_id),
                        account_id=str(auth.account_id),
                        operation=spec.catalog.op,
                        target_route=request.url_rule.rule if request.url_rule else "",
                        target_ids=target_ids,
                        http_status=status,
                        streaming=spec.catalog.kind is Kind.SSE,
                        trace_id=get_trace_id(),
                    )


subject_router = AuthRouter()
