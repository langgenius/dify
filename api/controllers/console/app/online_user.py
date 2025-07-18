import json

from flask import request
from flask_restful import Resource, marshal_with, reqparse
from flask_socketio import join_room

from controllers.console import api
from controllers.console.wraps import account_initialization_required, setup_required
from extensions.ext_redis import redis_client
from extensions.ext_socketio import ext_socketio
from fields.online_user_fields import online_user_list_fields
from libs.login import login_required


@ext_socketio.on("user_connect")
def handle_user_connect(data):
    """
    Handle user connect event, check login and get user info.
    """
    sid = request.sid
    workflow_id = data.get("workflow_id")
    if not (current_user := request.environ.get("ws_user")):
        return {"msg": "unauthorized"}, 401

    old_info_json = redis_client.hget(f"workflow_online_users:{workflow_id}", current_user.id)
    if old_info_json:
        old_info = json.loads(old_info_json)
        old_sid = old_info.get("sid")
        if old_sid and old_sid != sid:
            ext_socketio.server.disconnect(sid=old_sid)

    user_info = {
        "user_id": current_user.id,
        "username": current_user.name,
        "avatar": current_user.avatar,
        "sid": sid,
    }

    redis_client.hset(f"workflow_online_users:{workflow_id}", current_user.id, json.dumps(user_info))
    redis_client.set(f"ws_sid_map:{sid}", json.dumps({"workflow_id": workflow_id, "user_id": current_user.id}))

    join_room(workflow_id)
    broadcast_online_users(workflow_id)

    return {"msg": "connected", "user_id": current_user.id, "sid": sid}


@ext_socketio.on("disconnect")
def handle_disconnect():
    """
    Handle user disconnect event, remove user from workflow's online user list.
    """
    sid = request.sid
    mapping = redis_client.get(f"ws_sid_map:{sid}")
    if mapping:
        data = json.loads(mapping)
        workflow_id = data["workflow_id"]
        user_id = data["user_id"]
        redis_client.hdel(f"workflow_online_users:{workflow_id}", user_id)
        redis_client.delete(f"ws_sid_map:{sid}")

        broadcast_online_users(workflow_id)

def broadcast_online_users(workflow_id):
    """
    broadcast online users to the workflow room
    """
    users_json = redis_client.hgetall(f"workflow_online_users:{workflow_id}")
    users = []
    for _, user_info_json in users_json.items():
        try:
            users.append(json.loads(user_info_json))
        except Exception:
            continue
    ext_socketio.emit(
        "online_users",
        {"workflow_id": workflow_id, "users": users},
        room=workflow_id
    )


class OnlineUserApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(online_user_list_fields)
    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument("workflow_ids", type=str, required=True, location="args")
        args = parser.parse_args()

        workflow_ids = [id.strip() for id in args["workflow_ids"].split(",")]
        
        results = {}
        for workflow_id in workflow_ids:
            users_json = redis_client.hgetall(f"workflow_online_users:{workflow_id}")
            
            users = []
            for _, user_info_json in users_json.items():
                try:
                    users.append(json.loads(user_info_json))
                except Exception:
                    continue
            results[workflow_id] = users
            
        return {"data": results}

api.add_resource(OnlineUserApi, "/online-users")
