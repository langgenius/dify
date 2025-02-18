from flask_restful import Resource  # type: ignore

from controllers.console import api


class PingApi(Resource):
    def get(self):
        """
        For connection health check
        """
        return {"result": "pong"}


api.add_resource(PingApi, "/ping")
