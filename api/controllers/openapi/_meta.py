"""Meta endpoint: `GET /openapi/v1/_version` — no auth.

Returns the server's project version and edition so the difyctl CLI can probe
compatibility without needing to be logged in. Mirrors the `_health` endpoint
in `index.py`.
"""

from flask_restx import Resource

from configs import dify_config
from controllers.openapi import openapi_ns
from controllers.openapi._contract import returns
from controllers.openapi._models import ServerVersionResponse


@openapi_ns.route("/_version")
class VersionApi(Resource):
    @returns(200, ServerVersionResponse, description="Server version")
    def get(self):
        edition = dify_config.EDITION if dify_config.EDITION in ("SELF_HOSTED", "CLOUD") else "SELF_HOSTED"
        return ServerVersionResponse(
            version=dify_config.project.version,
            edition=edition,
        )
