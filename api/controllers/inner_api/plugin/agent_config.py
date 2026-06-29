"""Inner API for Agent Soul-backed config assets.

These endpoints are called by the dify-agent server with the inner API key.
They resolve the requested Agent config version directly from Agent Soul JSON
and never expose signed download URLs or drive-owned metadata.
"""

from __future__ import annotations

import io

from flask import request, send_file
from flask_restx import Resource
from pydantic import BaseModel, ValidationError

from controllers.console.wraps import setup_required
from controllers.inner_api import inner_api_ns
from controllers.inner_api.plugin.wraps import get_user
from controllers.inner_api.wraps import plugin_inner_api_only
from services.agent_config_service import (
    AgentConfigService,
    AgentConfigServiceError,
    AgentConfigVersionKind,
    ConfigPushPayload,
)


class _ConfigTargetQuery(BaseModel):
    tenant_id: str
    user_id: str | None = None
    config_version_id: str
    config_version_kind: AgentConfigVersionKind


class _ConfigPushRequest(_ConfigTargetQuery):
    user_id: str
    files: list[dict] = []
    skills: list[dict] = []
    env_text: str | None = None
    note: str | None = None

    def to_payload(self) -> ConfigPushPayload:
        return ConfigPushPayload.model_validate(
            {
                "files": self.files,
                "skills": self.skills,
                "env_text": self.env_text,
                "note": self.note,
            }
        )


class _ConfigEnvUpdateRequest(_ConfigTargetQuery):
    user_id: str
    env_text: str


class _ConfigNoteUpdateRequest(_ConfigTargetQuery):
    user_id: str
    note: str


def _target_query_from_request() -> _ConfigTargetQuery:
    return _ConfigTargetQuery.model_validate(
        {
            "tenant_id": request.args.get("tenant_id"),
            "user_id": request.args.get("user_id"),
            "config_version_id": request.args.get("config_version_id"),
            "config_version_kind": request.args.get("config_version_kind"),
        }
    )


def _error_response(exc: AgentConfigServiceError) -> tuple[dict[str, str], int]:
    return {"code": exc.code, "message": exc.message}, exc.status_code


@inner_api_ns.route("/agent-config/<string:agent_id>/manifest")
class AgentConfigManifestApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @inner_api_ns.doc("agent_config_manifest")
    def get(self, agent_id: str):
        try:
            query = _target_query_from_request()
            return AgentConfigService().manifest(
                tenant_id=query.tenant_id,
                agent_id=agent_id,
                user_id=query.user_id,
                config_version_id=query.config_version_id,
                config_version_kind=query.config_version_kind,
            )
        except ValidationError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except AgentConfigServiceError as exc:
            return _error_response(exc)


@inner_api_ns.route("/agent-config/<string:agent_id>/skills/<string:name>/pull")
class AgentConfigSkillPullApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @inner_api_ns.doc("agent_config_skill_pull")
    def get(self, agent_id: str, name: str):
        try:
            query = _target_query_from_request()
            result = AgentConfigService().pull_skill(
                tenant_id=query.tenant_id,
                agent_id=agent_id,
                user_id=query.user_id,
                config_version_id=query.config_version_id,
                config_version_kind=query.config_version_kind,
                name=name,
            )
            return send_file(
                io.BytesIO(result.payload),
                mimetype=result.mime_type,
                as_attachment=True,
                download_name=result.filename,
            )
        except ValidationError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except AgentConfigServiceError as exc:
            return _error_response(exc)


@inner_api_ns.route("/agent-config/<string:agent_id>/skills/<string:name>/inspect")
class AgentConfigSkillInspectApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @inner_api_ns.doc("agent_config_skill_inspect")
    def get(self, agent_id: str, name: str):
        try:
            query = _target_query_from_request()
            return AgentConfigService().inspect_skill(
                tenant_id=query.tenant_id,
                agent_id=agent_id,
                user_id=query.user_id,
                config_version_id=query.config_version_id,
                config_version_kind=query.config_version_kind,
                name=name,
            )
        except ValidationError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except AgentConfigServiceError as exc:
            return _error_response(exc)


@inner_api_ns.route("/agent-config/<string:agent_id>/files/<string:name>/pull")
class AgentConfigFilePullApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @inner_api_ns.doc("agent_config_file_pull")
    def get(self, agent_id: str, name: str):
        try:
            query = _target_query_from_request()
            result = AgentConfigService().pull_file(
                tenant_id=query.tenant_id,
                agent_id=agent_id,
                user_id=query.user_id,
                config_version_id=query.config_version_id,
                config_version_kind=query.config_version_kind,
                name=name,
            )
            return send_file(
                io.BytesIO(result.payload),
                mimetype=result.mime_type,
                as_attachment=True,
                download_name=result.filename,
            )
        except ValidationError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except AgentConfigServiceError as exc:
            return _error_response(exc)


@inner_api_ns.route("/agent-config/<string:agent_id>/push")
class AgentConfigPushApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @inner_api_ns.doc("agent_config_push")
    def post(self, agent_id: str):
        try:
            body = _ConfigPushRequest.model_validate(request.get_json(silent=True) or {})
            user = get_user(body.tenant_id, body.user_id)
            return AgentConfigService().push(
                tenant_id=body.tenant_id,
                agent_id=agent_id,
                user_id=user.id,
                config_version_id=body.config_version_id,
                config_version_kind=body.config_version_kind,
                payload=body.to_payload(),
            )
        except ValidationError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except AgentConfigServiceError as exc:
            return _error_response(exc)


@inner_api_ns.route("/agent-config/<string:agent_id>/env")
class AgentConfigEnvApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @inner_api_ns.doc("agent_config_env")
    def patch(self, agent_id: str):
        try:
            body = _ConfigEnvUpdateRequest.model_validate(request.get_json(silent=True) or {})
            user = get_user(body.tenant_id, body.user_id)
            return AgentConfigService().update_env(
                tenant_id=body.tenant_id,
                agent_id=agent_id,
                user_id=user.id,
                config_version_id=body.config_version_id,
                config_version_kind=body.config_version_kind,
                env_text=body.env_text,
            )
        except ValidationError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except AgentConfigServiceError as exc:
            return _error_response(exc)


@inner_api_ns.route("/agent-config/<string:agent_id>/note")
class AgentConfigNoteApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @inner_api_ns.doc("agent_config_note")
    def put(self, agent_id: str):
        try:
            body = _ConfigNoteUpdateRequest.model_validate(request.get_json(silent=True) or {})
            user = get_user(body.tenant_id, body.user_id)
            return AgentConfigService().update_note(
                tenant_id=body.tenant_id,
                agent_id=agent_id,
                user_id=user.id,
                config_version_id=body.config_version_id,
                config_version_kind=body.config_version_kind,
                note=body.note,
            )
        except ValidationError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except AgentConfigServiceError as exc:
            return _error_response(exc)
