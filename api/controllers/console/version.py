import json
import logging

import httpx
from flask_restx import Resource, fields, reqparse
from packaging import version

from configs import dify_config

from . import api, console_ns

logger = logging.getLogger(__name__)


@console_ns.route("/version")
class VersionApi(Resource):
    @api.doc("check_version_update")
    @api.doc(description="Check for application version updates")
    @api.expect(
        api.parser().add_argument(
            "current_version", type=str, required=True, location="args", help="Current application version"
        )
    )
    @api.response(
        200,
        "Success",
        api.model(
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
        parser = reqparse.RequestParser().add_argument("current_version", type=str, required=True, location="args")
        args = parser.parse_args()
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
                params={"current_version": args["current_version"]},
                timeout=httpx.Timeout(connect=3, read=10),
            )
        except Exception as error:
            logger.warning("Check update version error: %s.", str(error))
            result["version"] = args["current_version"]
            return result

        content = json.loads(response.content)
        if _has_new_version(latest_version=content["version"], current_version=f"{args['current_version']}"):
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
