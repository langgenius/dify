"""Inner API for published workspace Skills.

These endpoints are called by trusted runtime services. They expose only
published Skill artifacts, never draft files or editable metadata.
"""

from __future__ import annotations

import io

from flask import request, send_file
from flask_restx import Resource
from pydantic import BaseModel, ValidationError

from controllers.console.wraps import setup_required
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import plugin_inner_api_only
from services.skill_management_service import SkillManagementService, SkillManagementServiceError


class _SkillTargetQuery(BaseModel):
    tenant_id: str


def _target_query_from_request() -> _SkillTargetQuery:
    return _SkillTargetQuery.model_validate({"tenant_id": request.args.get("tenant_id")})


def _error_response(exc: SkillManagementServiceError) -> tuple[dict[str, str], int]:
    return {"code": exc.code, "message": exc.message}, exc.status_code


@inner_api_ns.route("/skills/<string:skill_id>/pull")
class PublishedSkillPullApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @inner_api_ns.doc("published_skill_pull")
    def get(self, skill_id: str):
        try:
            query = _target_query_from_request()
            result = SkillManagementService().pull_published_archive(tenant_id=query.tenant_id, skill_id=skill_id)
            return send_file(
                io.BytesIO(result.payload),
                mimetype=result.mime_type,
                as_attachment=True,
                download_name=result.filename,
            )
        except ValidationError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except SkillManagementServiceError as exc:
            return _error_response(exc)


__all__ = ["PublishedSkillPullApi"]
