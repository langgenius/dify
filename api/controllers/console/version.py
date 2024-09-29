import json
import logging

import requests
from flask_restful import Resource, reqparse

from configs import dify_config

from . import api


class VersionApi(Resource):
    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument("current_version", type=str, required=True, location="args")
        args = parser.parse_args()
        check_update_url = dify_config.CHECK_UPDATE_URL

        result = {
            "version": dify_config.CURRENT_VERSION,
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
    def parse_version(version: str) -> tuple:
        # Split version into parts and pre-release suffix if any
        parts = version.split("-")
        version_parts = parts[0].split(".")
        pre_release = parts[1] if len(parts) > 1 else None

        # Validate version format
        if len(version_parts) != 3:
            raise ValueError(f"Invalid version format: {version}")

        try:
            # Convert version parts to integers
            major, minor, patch = map(int, version_parts)
            return (major, minor, patch, pre_release)
        except ValueError:
            raise ValueError(f"Invalid version format: {version}")

    latest = parse_version(latest_version)
    current = parse_version(current_version)

    # Compare major, minor, and patch versions
    for latest_part, current_part in zip(latest[:3], current[:3]):
        if latest_part > current_part:
            return True
        elif latest_part < current_part:
            return False

    # If versions are equal, check pre-release suffixes
    if latest[3] is None and current[3] is not None:
        return True
    elif latest[3] is not None and current[3] is None:
        return False
    elif latest[3] is not None and current[3] is not None:
        # Simple string comparison for pre-release versions
        return latest[3] > current[3]

    return False


api.add_resource(VersionApi, "/version")
