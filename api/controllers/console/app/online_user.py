import json

from flask import request
from flask_login import current_user, login_required

from extensions.ext_redis import redis_client
from extensions.ext_socketio import ext_socketio


@ext_socketio.on("user_connect")
@login_required
def handle_user_connect(data):
    """
    Handle user connect event, check login and get user info.
    """

    sid = request.sid
    workflow_id = data.get("workflow_id")

    old_info_json = redis_client.hget(f"workflow_online_users:{workflow_id}", current_user.id)
    if old_info_json:
        old_info = json.loads(old_info_json)
        old_sid = old_info.get("sid")
        if old_sid and old_sid != sid:
            ext_socketio.server.disconnect(sid=old_sid)

    user_info = {
        "user_id": current_user.id,
        "username": getattr(current_user, "username", ""),
        "avatar": getattr(current_user, "avatar", ""),
        "sid": sid,
    }

    redis_client.hset(f"workflow_online_users:{workflow_id}", current_user.id, json.dumps(user_info))

    redis_client.set(f"ws_sid_map:{sid}", json.dumps({"workflow_id": workflow_id, "user_id": current_user.id}))
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
