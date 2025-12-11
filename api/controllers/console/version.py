import json
import logging

import httpx
from flask import request
from flask_restx import Resource, fields
from packaging import version
from pydantic import BaseModel, Field

from configs import dify_config

from . import console_ns

logger = logging.getLogger(__name__)


class VersionQuery(BaseModel):
    current_version: str = Field(..., description="Current application version")


console_ns.schema_model(
    VersionQuery.__name__,
    VersionQuery.model_json_schema(ref_template="#/definitions/{model}"),
)


@console_ns.route("/version")
class VersionApi(Resource):
    @console_ns.doc("check_version_update")
    @console_ns.doc(description="Check for application version updates")
    @console_ns.expect(console_ns.models[VersionQuery.__name__])
    @console_ns.response(
        200,
        "Success",
        console_ns.model(
            "VersionResponse",
            {
                "version": fields.String(description="Latest version number"),
                "release_date": fields.String(description="Release date of latest version"),
                "release_notes": fields.String(description="Release notes for latest version"),
                "can_auto_update": fields.Boolean(description="Whether auto-update is supported"),
                "features": fields.Raw(description="Feature flags and capabilities"),
            },
        ),
    )
    def get(self):
        """Check for application version updates"""
        args = VersionQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore
        check_update_url = dify_config.CHECK_UPDATE_URL

        result = {
            "version": dify_config.project.version,
            "release_date": "",
            "release_notes": "",
            "can_auto_update": False,
            "features": {
                "can_replace_logo": dify_config.CAN_REPLACE_LOGO,
                "model_load_balancing_enabled": dify_config.MODEL_LB_ENABLED,
            },
        }

        if not check_update_url:
            return result

        try:
            response = httpx.get(
                check_update_url,
                params={"current_version": args.current_version},
                timeout=httpx.Timeout(timeout=10.0, connect=3.0),
            )
        except Exception as error:
            logger.warning("Check update version error: %s.", str(error))
            result["version"] = args.current_version
            return result

        content = json.loads(response.content)
        if _has_new_version(latest_version=content["version"], current_version=f"{args.current_version}"):
            result["version"] = content["version"]
            result["release_date"] = content["releaseDate"]
            result["release_notes"] = content["releaseNotes"]
            result["can_auto_update"] = content["canAutoUpdate"]
        return result


def _has_new_version(*, latest_version: str, current_version: str) -> bool:
    try:
        latest = version.parse(latest_version)
        current = version.parse(current_version)

        # Compare versions
        return latest > current
    except version.InvalidVersion:
        logger.warning("Invalid version format: latest=%s, current=%s", latest_version, current_version)
        return False
