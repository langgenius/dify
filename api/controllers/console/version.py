import json
import logging

import requests
from flask_restful import Resource, reqparse
from packaging import version

from configs import dify_config

from . import api


class VersionApi(Resource):
    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument("current_version", type=str, required=True, location="args")
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
            response = requests.get(check_update_url, {"current_version": args.get("current_version")})
        except Exception as error:
            logging.warning("Check update version error: {}.".format(str(error)))
            result["version"] = args.get("current_version")
            return result

        content = json.loads(response.content)
        if _has_new_version(latest_version=content["version"], current_version=f"{args.get('current_version')}"):
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
        logging.warning(f"Invalid version format: latest={latest_version}, current={current_version}")
        return False


api.add_resource(VersionApi, "/version")
