from __future__ import annotations

from collections.abc import Callable
from functools import partial, wraps
from typing import Any

from flask import request
from werkzeug.exceptions import NotFound, Unauthorized

from configs import dify_config
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.pipelines import pipeline_for_subject
from controllers.openapi.auth.requirements import assert_license_valid
from controllers.openapi.auth.spec import EndpointSpec
from controllers.openapi.auth.subjects import subject_from_auth
from core.db.session_factory import session_factory
from enums import DeploymentEdition
from libs.oauth_bearer import InvalidBearerError, extract_bearer, get_authenticator


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
        its licence check answers 403 before the missing-bearer 401.
        """
        if spec.edition is not None:
            if dify_config.DEPLOYMENT_EDITION not in spec.edition:
                raise NotFound()
            if DeploymentEdition.ENTERPRISE in spec.edition:
                assert_license_valid()

        token = extract_bearer(request)
        if not token:
            raise Unauthorized("bearer required")

        try:
            auth = get_authenticator().authenticate(token)
        except InvalidBearerError:
            # One answer for every rejection reason - unknown prefix, no live row,
            # expired - so a caller cannot probe which one it hit. Same reasoning as
            # the 404-not-403 elsewhere on this surface.
            raise Unauthorized("invalid bearer")
        subject = subject_from_auth(auth)
        pipeline = pipeline_for_subject(subject)

        with session_factory.create_session() as session:
            ctx = Context(subject, session, dict(request.view_args or {}))
            try:
                result = pipeline.run(
                    subject=subject,
                    auth=auth,
                    spec=spec,
                    ctx=ctx,
                    session=session,
                    call=call,
                )
            except Exception:
                if spec.write:
                    session.rollback()  # guard-ignore: no-new-controller-sqlalchemy -- spec.write owns the rollback
                raise
            if spec.write:
                session.commit()
            return result


subject_router = AuthRouter()
