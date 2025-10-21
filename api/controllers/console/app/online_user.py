import json
import time

from werkzeug.wrappers import Request as WerkzeugRequest

from extensions.ext_redis import redis_client
from extensions.ext_socketio import sio
from libs.passport import PassportService
from libs.token import extract_access_token
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
        try:
            request_environ = WerkzeugRequest(environ)
            token = extract_access_token(request_environ)
        except Exception:
            token = None

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
    Handle user connect event. Each session (tab) is treated as an independent collaborator.
    """

    workflow_id = data.get("workflow_id")
    if not workflow_id:
        return {"msg": "workflow_id is required"}, 400

    session = sio.get_session(sid)
    user_id = session.get("user_id")

    if not user_id:
        return {"msg": "unauthorized"}, 401

    # Each session is stored independently with sid as key
    session_info = {
        "user_id": user_id,
        "username": session.get("username", "Unknown"),
        "avatar": session.get("avatar", None),
        "sid": sid,
        "connected_at": int(time.time()),  # Add timestamp to differentiate tabs
    }

    # Store session info with sid as key
    redis_client.hset(f"workflow_online_users:{workflow_id}", sid, json.dumps(session_info))
    redis_client.set(f"ws_sid_map:{sid}", json.dumps({"workflow_id": workflow_id, "user_id": user_id}))

    # Leader election: first session becomes the leader
    leader_sid = get_or_set_leader(workflow_id, sid)
    is_leader = leader_sid == sid

    sio.enter_room(sid, workflow_id)
    broadcast_online_users(workflow_id)

    # Notify this session of their leader status
    sio.emit("status", {"isLeader": is_leader}, room=sid)

    return {"msg": "connected", "user_id": user_id, "sid": sid, "isLeader": is_leader}


@sio.on("disconnect")
def handle_disconnect(sid):
    """
    Handle session disconnect event. Remove the specific session from online users.
    """
    mapping = redis_client.get(f"ws_sid_map:{sid}")
    if mapping:
        data = json.loads(mapping)
        workflow_id = data["workflow_id"]

        # Remove this specific session
        redis_client.hdel(f"workflow_online_users:{workflow_id}", sid)
        redis_client.delete(f"ws_sid_map:{sid}")

        # Handle leader re-election if the leader session disconnected
        handle_leader_disconnect(workflow_id, sid)

        broadcast_online_users(workflow_id)


def _clear_session_state(workflow_id: str, sid: str) -> None:
    redis_client.hdel(f"workflow_online_users:{workflow_id}", sid)
    redis_client.delete(f"ws_sid_map:{sid}")


def _is_session_active(workflow_id: str, sid: str) -> bool:
    if not sid:
        return False

    try:
        if not sio.manager.is_connected(sid, "/"):
            return False
    except AttributeError:
        return False

    if not redis_client.hexists(f"workflow_online_users:{workflow_id}", sid):
        return False

    if not redis_client.exists(f"ws_sid_map:{sid}"):
        return False

    return True


def get_or_set_leader(workflow_id: str, sid: str) -> str:
    """
    Get current leader session or set this session as leader if no valid leader exists.
    Returns the leader session id (sid).
    """
    leader_key = f"workflow_leader:{workflow_id}"
    raw_leader = redis_client.get(leader_key)
    current_leader = raw_leader.decode("utf-8") if isinstance(raw_leader, bytes) else raw_leader
    leader_replaced = False

    if current_leader and not _is_session_active(workflow_id, current_leader):
        _clear_session_state(workflow_id, current_leader)
        redis_client.delete(leader_key)
        current_leader = None
        leader_replaced = True

    if not current_leader:
        redis_client.set(leader_key, sid, ex=3600)  # Expire in 1 hour
        if leader_replaced:
            broadcast_leader_change(workflow_id, sid)
        return sid

    return current_leader


def handle_leader_disconnect(workflow_id, disconnected_sid):
    """
    Handle leader re-election when a session disconnects.
    If the disconnected session was the leader, elect a new leader from remaining sessions.
    """
    leader_key = f"workflow_leader:{workflow_id}"
    current_leader = redis_client.get(leader_key)

    if current_leader:
        current_leader = current_leader.decode("utf-8") if isinstance(current_leader, bytes) else current_leader

        if current_leader == disconnected_sid:
            # Leader session disconnected, elect a new leader
            sessions_json = redis_client.hgetall(f"workflow_online_users:{workflow_id}")

            if sessions_json:
                # Get the first remaining session as new leader
                new_leader_sid = list(sessions_json.keys())[0]
                if isinstance(new_leader_sid, bytes):
                    new_leader_sid = new_leader_sid.decode("utf-8")

                redis_client.set(leader_key, new_leader_sid, ex=3600)

                # Notify all sessions about the new leader
                broadcast_leader_change(workflow_id, new_leader_sid)
            else:
                # No sessions left, remove leader
                redis_client.delete(leader_key)


def broadcast_leader_change(workflow_id, new_leader_sid):
    """
    Broadcast leader change to all sessions in the workflow.
    """
    sessions_json = redis_client.hgetall(f"workflow_online_users:{workflow_id}")

    for sid, session_info_json in sessions_json.items():
        try:
            sid_str = sid.decode("utf-8") if isinstance(sid, bytes) else sid
            is_leader = sid_str == new_leader_sid
            # Emit to each session whether they are the new leader
            sio.emit("status", {"isLeader": is_leader}, room=sid_str)
        except Exception:
            continue


def get_current_leader(workflow_id):
    """
    Get the current leader for a workflow.
    """
    leader_key = f"workflow_leader:{workflow_id}"
    leader = redis_client.get(leader_key)
    return leader.decode("utf-8") if leader and isinstance(leader, bytes) else leader


def broadcast_online_users(workflow_id):
    """
    Broadcast online users to the workflow room.
    Each session is shown as a separate user (even if same person has multiple tabs).
    """
    sessions_json = redis_client.hgetall(f"workflow_online_users:{workflow_id}")
    users = []

    for sid, session_info_json in sessions_json.items():
        try:
            session_info = json.loads(session_info_json)
            # Each session appears as a separate "user" in the UI
            users.append(
                {
                    "user_id": session_info["user_id"],
                    "username": session_info["username"],
                    "avatar": session_info.get("avatar"),
                    "sid": session_info["sid"],
                    "connected_at": session_info.get("connected_at"),
                }
            )
        except Exception:
            continue

    # Sort by connection time to maintain consistent order
    users.sort(key=lambda x: x.get("connected_at") or 0)

    # Get current leader session
    leader_sid = get_current_leader(workflow_id)

    sio.emit("online_users", {"workflow_id": workflow_id, "users": users, "leader": leader_sid}, room=workflow_id)


@sio.on("collaboration_event")
def handle_collaboration_event(sid, data):
    """
    Handle general collaboration events, include:
    1. mouse_move
    2. vars_and_features_update
    3. sync_request (ask leader to update graph)
    4. app_state_update
    5. mcp_server_update
    6. workflow_update
    7. comments_update
    8. node_panel_presence

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
