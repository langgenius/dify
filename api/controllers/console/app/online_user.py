import json
import time

from extensions.ext_redis import redis_client
from extensions.ext_socketio import sio
from libs.passport import PassportService
from services.account_service import AccountService


@sio.on("connect")
def socket_connect(sid, environ, auth):
    """
    WebSocket connect event, do authentication here.
    """
    token = None
    if auth and isinstance(auth, dict):
        token = auth.get("token")
    if not token:
        return False

    try:
        decoded = PassportService().verify(token)
        user_id = decoded.get("user_id")
        if not user_id:
            return False

        with sio.app.app_context():
            user = AccountService.load_logged_in_account(account_id=user_id)
            if not user:
                return False

            sio.save_session(sid, {"user_id": user.id, "username": user.name, "avatar": user.avatar})

            return True

    except Exception:
        return False


@sio.on("user_connect")
def handle_user_connect(sid, data):
    """
    Handle user connect event, check login and get user info.
    """

    workflow_id = data.get("workflow_id")
    if not workflow_id:
        return {"msg": "workflow_id is required"}, 400

    session = sio.get_session(sid)
    user_id = session.get("user_id")

    if not user_id:
        return {"msg": "unauthorized"}, 401

    old_info_json = redis_client.hget(f"workflow_online_users:{workflow_id}", user_id)
    if old_info_json:
        old_info = json.loads(old_info_json)
        old_sid = old_info.get("sid")
        if old_sid and old_sid != sid:
            sio.disconnect(sid=old_sid)

    user_info = {
        "user_id": user_id,
        "username": session.get("username", "Unknown"),
        "avatar": session.get("avatar", None),
        "sid": sid,
    }

    redis_client.hset(f"workflow_online_users:{workflow_id}", user_id, json.dumps(user_info))
    redis_client.set(f"ws_sid_map:{sid}", json.dumps({"workflow_id": workflow_id, "user_id": user_id}))

    sio.enter_room(sid, workflow_id)
    broadcast_online_users(workflow_id)

    return {"msg": "connected", "user_id": user_id, "sid": sid}


@sio.on("disconnect")
def handle_disconnect(sid):
    """
    Handle user disconnect event, remove user from workflow's online user list.
    """
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
    sio.emit("online_users", {"workflow_id": workflow_id, "users": users}, room=workflow_id)


@sio.on("collaboration_event")
def handle_collaboration_event(sid, data):
    """
    Handle general collaboration events, include:
    1. mouseMove
    2. varsAndFeaturesUpdate

    """
    mapping = redis_client.get(f"ws_sid_map:{sid}")

    if not mapping:
        return {"msg": "unauthorized"}, 401

    mapping_data = json.loads(mapping)
    workflow_id = mapping_data["workflow_id"]
    user_id = mapping_data["user_id"]

    event_type = data.get("type")
    event_data = data.get("data")
    timestamp = data.get("timestamp", int(time.time()))

    if not event_type:
        return {"msg": "invalid event type"}, 400

    sio.emit(
        "collaboration_update",
        {"type": event_type, "userId": user_id, "data": event_data, "timestamp": timestamp},
        room=workflow_id,
        skip_sid=sid,
    )

    return {"msg": "event_broadcasted"}


@sio.on("graph_event")
def handle_graph_event(sid, data):
    """
    Handle graph events - simple broadcast relay.
    """
    mapping = redis_client.get(f"ws_sid_map:{sid}")

    if not mapping:
        return {"msg": "unauthorized"}, 401

    mapping_data = json.loads(mapping)
    workflow_id = mapping_data["workflow_id"]

    sio.emit("graph_update", data, room=workflow_id, skip_sid=sid)

    return {"msg": "graph_update_broadcasted"}
