from base64 import b64encode
from collections.abc import Callable
from functools import wraps
from hashlib import sha1
from hmac import compare_digest
from hmac import new as hmac_new
from typing import cast

from flask import abort, current_app, g, request
from werkzeug.local import LocalProxy

from configs import dify_config
from core.db.session_factory import session_factory
from libs.exception import BaseHTTPException
from models.model import EndUser


class InnerApiUnauthorizedError(BaseHTTPException):
    error_code = "inner_api_unauthorized"
    description = "Unauthorized."
    code = 401


def inner_api_only[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    """Restrict access to callers authenticated with the shared inner API key."""

    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
        if not dify_config.INNER_API:
            abort(404)

        inner_api_key = request.headers.get("X-Inner-Api-Key")
        if not inner_api_key or inner_api_key != dify_config.INNER_API_KEY:
            raise InnerApiUnauthorizedError()

        return view(*args, **kwargs)

    return decorated


def enterprise_inner_api_only[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    return inner_api_only(view)


def enterprise_inner_api_user_auth[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    """Inject an EndUser for valid inner API HMAC auth, otherwise pass the request through unchanged."""

    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
        if not dify_config.INNER_API:
            return view(*args, **kwargs)

        # get header 'X-Inner-Api-Key'
        authorization = request.headers.get("Authorization")
        if not authorization:
            return view(*args, **kwargs)

        parts = authorization.split(":")
        if len(parts) != 2:
            return view(*args, **kwargs)

        user_id, token = parts
        if " " in user_id:
            user_id = user_id.split(" ")[1]

        inner_api_key = request.headers.get("X-Inner-Api-Key", "")

        data_to_sign = f"DIFY {user_id}"

        signature = hmac_new(inner_api_key.encode("utf-8"), data_to_sign.encode("utf-8"), sha1)
        signature_base64 = b64encode(signature.digest()).decode("utf-8")

        if signature_base64 != token:
            return view(*args, **kwargs)

        with session_factory.create_session() as session:
            kwargs["user"] = session.get(EndUser, user_id)
            return view(*args, **kwargs)

    return decorated


def plugin_inner_api_only[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
        if not dify_config.PLUGIN_DAEMON_KEY:
            abort(404)

        # get header 'X-Inner-Api-Key'
        inner_api_key = request.headers.get("X-Inner-Api-Key")
        if not inner_api_key or inner_api_key != dify_config.INNER_API_KEY_FOR_PLUGIN:
            abort(404)

        return view(*args, **kwargs)

    return decorated


def agent_inner_api_only[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    """Temporary alias for agent-backend inner API callers.

    Agent tool and knowledge calls currently share the same trusted
    `dify-agent -> Dify API` transport credentials as the plugin inner bridge.
    Keep the wrapper name agent-specific so the controller surface does not grow
    more plugin-only semantics while auth settings stay shared.
    """

    return plugin_inner_api_only(view)


class AgentRuntimeRefused(BaseHTTPException):
    error_code = "native_agent_control_refused"
    description = "Native Agent control is unavailable."
    code = 409


def agent_endpoint_api_only[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    """Share a controller body between separately authenticated Resource wrappers.

    The runtime Resource's outer guard creates this request-local admission. A
    legacy Resource always uses its original plugin key and never calls lineage.
    """

    @wraps(view)
    def legacy(*args: P.args, **kwargs: P.kwargs) -> R:
        if "X-Dify-Agent-Dispatch" in request.headers:
            raise AgentRuntimeRefused()
        body = request.get_json(silent=True) if request.is_json else None
        if isinstance(body, dict) and (
            any(
                body.get(key) is not None
                for key in (
                    "native_dispatch",
                    "native_test_ref",
                    "native_parent_node",
                    "parent_node",
                    "ref",
                )
            )
            or body.get("execution_mode") == "builder_test"
        ):
            raise AgentRuntimeRefused()
        if any(
            key in request.args
            for key in (
                "native_dispatch",
                "native_test_ref",
                "native_parent_node",
                "parent_node",
                "ref",
            )
        ):
            raise AgentRuntimeRefused()
        return view(*args, **kwargs)

    authenticated_legacy = plugin_inner_api_only(legacy)

    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
        if (
            g.get("agent_runtime_admitted", False)
            and g.get("agent_runtime_request") is cast(LocalProxy, request)._get_current_object()
        ):
            return view(*args, **kwargs)
        return authenticated_legacy(*args, **kwargs)

    from libs.external_api import document_errors

    return document_errors(decorated, AgentRuntimeRefused)


def agent_runtime_api_only(boundary: str):
    """Authenticate the Agent service, then prove actual persisted Run lineage.

    Only used as the outer method decorator of explicit runtime Resources. No
    body flag, legacy credential, or absent envelope can select ordinary mode.
    """

    def decorate(view):
        @wraps(view)
        def guarded(*args, **kwargs):
            from controllers.inner_api.agent.runtime_selection import (
                parse_agent_run_selection,
            )
            from runtime_contracts.builder.execution import (
                BuilderExecutionPolicyError,
            )
            from services.dify_builder.native_testing.agent_lineage import (
                AgentServicePrincipal,
            )

            token = dify_config.AGENT_BACKEND_API_TOKEN
            other_credentials = (
                dify_config.INNER_API_KEY_FOR_PLUGIN,
                dify_config.INNER_API_KEY,
                dify_config.PLUGIN_DAEMON_KEY,
            )
            authorization = request.headers.get("Authorization", "")
            if (
                not token
                or not token.strip()
                or any(
                    credential and compare_digest(token.encode(), credential.encode())
                    for credential in other_credentials
                )
                or "X-Inner-Api-Key" in request.headers
                or len(request.headers.getlist("Authorization")) != 1
                or not authorization.startswith("Bearer ")
                or not compare_digest(authorization[7:].encode(), token.encode())
            ):
                raise InnerApiUnauthorizedError()
            principal = AgentServicePrincipal()
            try:
                selection = parse_agent_run_selection(request.headers)
                if boundary in {"prepare-run", "prepared-config"}:
                    from dify_agent.protocol.native_testing import (
                        MAX_AGENT_CONTROL_BYTES,
                        AgentPrepareRunPayload,
                        AgentReadPreparedConfigPayload,
                    )

                    from controllers.inner_api.agent.native_testing import _parse

                    _parse(
                        AgentPrepareRunPayload if boundary == "prepare-run" else AgentReadPreparedConfigPayload,
                        limit=MAX_AGENT_CONTROL_BYTES,
                    )
                lineage = current_app.extensions.get("native_agent_endpoint_lineage")
                if lineage is None:
                    raise BuilderExecutionPolicyError("native_endpoint_lineage_unavailable")
                body = request.get_json(silent=True) if request.is_json else None
                raw = body if isinstance(body, dict) else request.args.to_dict(flat=True)
                caller = raw.get("caller", raw)
                if not isinstance(caller, dict):
                    raise BuilderExecutionPolicyError("native_endpoint_owner_mismatch")
                context = lineage.resolve(
                    principal=principal,
                    selection=selection,
                    boundary=boundary,
                    caller=caller,
                )
                if context is None:
                    if (
                        boundary in {"prepare-run", "prepared-config", "native-control"}
                        or raw.get("native_dispatch") is not None
                        or "X-Dify-Agent-Dispatch" in request.headers
                    ):
                        raise BuilderExecutionPolicyError("native_endpoint_owner_mismatch")
                elif boundary == "config":
                    from controllers.inner_api.agent.runtime_selection import parse_agent_config_dispatch

                    if context.native_test_profile != "confirmed" or not (
                        request.method == "GET"
                        or (request.method == "POST" and request.path.endswith("/download-request"))
                    ):
                        raise BuilderExecutionPolicyError("native_endpoint_dependency_unavailable")
                    envelope = parse_agent_config_dispatch(request.headers)
                    if envelope.ref != context.ref:
                        raise BuilderExecutionPolicyError("native_endpoint_owner_mismatch")
                    g.agent_runtime_dispatch = envelope
                elif boundary in {"prepare-run", "prepared-config"}:
                    if selection.parent_node is None or raw.get("parent_node") != selection.parent_node.model_dump(
                        mode="json"
                    ):
                        raise BuilderExecutionPolicyError("native_endpoint_owner_mismatch")
                    if boundary == "prepare-run" and (
                        raw.get("agent_run_id") != selection.agent_run_id
                        or raw.get("request_digest") != selection.request_digest
                    ):
                        raise BuilderExecutionPolicyError("native_endpoint_owner_mismatch")
                    if boundary == "prepared-config" and raw.get("config_ref") != context.config.config_ref:
                        raise BuilderExecutionPolicyError("native_endpoint_owner_mismatch")
                elif boundary == "native-control":
                    if raw.get("ref") != context.ref.model_dump(mode="json"):
                        raise BuilderExecutionPolicyError("native_endpoint_owner_mismatch")
                elif boundary in {
                    "model",
                    "core_tool",
                    "knowledge",
                    "file_upload",
                    "file_download",
                }:
                    from dify_agent.adapters.native_testing.client import (
                        AgentPhysicalDispatchPayload,
                    )

                    try:
                        envelope = AgentPhysicalDispatchPayload.model_validate(raw.get("native_dispatch"))
                    except ValueError:
                        raise BuilderExecutionPolicyError("native_endpoint_owner_mismatch") from None
                    if envelope.ref != context.ref:
                        raise BuilderExecutionPolicyError("native_endpoint_owner_mismatch")
                    # The inherited controller validates final target/arguments
                    # at its shared preflight; its physical owner remains closed.
                else:
                    raise BuilderExecutionPolicyError("native_endpoint_dependency_unavailable")
            except BuilderExecutionPolicyError:
                raise AgentRuntimeRefused() from None
            # g can outlive one request under an explicitly pushed app context.
            # Bind this admission to the actual request object, not only g.
            g.agent_runtime_request = cast(LocalProxy, request)._get_current_object()
            g.agent_runtime_principal = principal
            g.agent_runtime_selection = selection
            g.agent_runtime_context = context
            g.agent_runtime_admitted = True
            return view(*args, **kwargs)

        return guarded

    return decorate
