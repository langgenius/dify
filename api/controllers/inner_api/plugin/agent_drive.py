"""Inner API for the agent drive (agent 网盘) control plane.

These endpoints are called by the dify-agent server (not the sandbox) with the
inner API key. The drive ref is the URL segment ``agent-<agent_id>``; the
path-like file key travels in the query/body, never as a URL path segment (so
its ``/`` characters do not collide with routing). Drive-owned semantics:
tenant scoped, no user-level FileAccessScope. Commit still canonicalizes the
trusted execution-context user through the same EndUser lookup as plugin file
upload before validating ToolFile ownership.
"""

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, ValidationError

from controllers.console.wraps import setup_required
from controllers.inner_api import inner_api_ns
from controllers.inner_api.plugin.wraps import get_user
from controllers.inner_api.wraps import plugin_inner_api_only
from services.agent_drive_service import (
    AgentDriveError,
    AgentDriveService,
    DriveCommitItem,
    parse_agent_drive_ref,
)


class _CommitRequest(BaseModel):
    tenant_id: str
    user_id: str
    items: list[DriveCommitItem]


def _error_response(exc: AgentDriveError) -> tuple[dict[str, str], int]:
    return {"code": exc.code, "message": exc.message}, exc.status_code


@inner_api_ns.route("/drive/<string:drive_ref>/manifest")
class AgentDriveManifestApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @inner_api_ns.doc("agent_drive_manifest")
    @inner_api_ns.doc(description="List an agent drive (optionally with download URLs)")
    def get(self, drive_ref: str):
        try:
            agent_id = parse_agent_drive_ref(drive_ref)
            tenant_id = (request.args.get("tenant_id") or "").strip()
            if not tenant_id:
                raise AgentDriveError("missing_tenant_id", "tenant_id is required", status_code=400)
            include_download_url = (request.args.get("include_download_url") or "").lower() in ("1", "true", "yes")
            items = AgentDriveService().manifest(
                tenant_id=tenant_id,
                agent_id=agent_id,
                prefix=request.args.get("prefix", ""),
                include_download_url=include_download_url,
            )
        except AgentDriveError as exc:
            return _error_response(exc)
        return {"items": items}


@inner_api_ns.route("/drive/<string:drive_ref>/skills")
class AgentDriveSkillsApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @inner_api_ns.doc("agent_drive_skills")
    @inner_api_ns.doc(description="List the skill catalog of an agent drive")
    def get(self, drive_ref: str):
        try:
            agent_id = parse_agent_drive_ref(drive_ref)
            tenant_id = (request.args.get("tenant_id") or "").strip()
            if not tenant_id:
                raise AgentDriveError("missing_tenant_id", "tenant_id is required", status_code=400)
            items = AgentDriveService().list_skills(tenant_id=tenant_id, agent_id=agent_id)
        except AgentDriveError as exc:
            return _error_response(exc)
        return {"items": items}


@inner_api_ns.route("/drive/<string:drive_ref>/commit")
class AgentDriveCommitApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @inner_api_ns.doc("agent_drive_commit")
    @inner_api_ns.doc(description="Commit a batch of file refs into an agent drive")
    def post(self, drive_ref: str):
        try:
            agent_id = parse_agent_drive_ref(drive_ref)
            try:
                body = _CommitRequest.model_validate(request.get_json(silent=True) or {})
            except ValidationError as exc:
                raise AgentDriveError("invalid_request", str(exc), status_code=400) from exc
            user = get_user(body.tenant_id, body.user_id)
            items = AgentDriveService().commit(
                tenant_id=body.tenant_id,
                user_id=user.id,
                agent_id=agent_id,
                items=body.items,
            )
        except AgentDriveError as exc:
            return _error_response(exc)
        return {"items": items}
