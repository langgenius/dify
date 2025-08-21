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

    # Leader election: first user becomes the leader
    leader_id = get_or_set_leader(workflow_id, user_id)
    is_leader = leader_id == user_id

    sio.enter_room(sid, workflow_id)
    broadcast_online_users(workflow_id)
    
    # Notify user of their status
    sio.emit("status", {"isLeader": is_leader}, room=sid)

    return {"msg": "connected", "user_id": user_id, "sid": sid, "isLeader": is_leader}


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

        # Handle leader re-election if the leader disconnected
        handle_leader_disconnect(workflow_id, user_id)
        
        broadcast_online_users(workflow_id)


def get_or_set_leader(workflow_id, user_id):
    """
    Get current leader or set the user as leader if no leader exists.
    Returns the leader user_id.
    """
    leader_key = f"workflow_leader:{workflow_id}"
    current_leader = redis_client.get(leader_key)
    
    if not current_leader:
        # No leader exists, make this user the leader
        redis_client.set(leader_key, user_id, ex=3600)  # Expire in 1 hour
        return user_id
    
    return current_leader.decode('utf-8') if isinstance(current_leader, bytes) else current_leader


def handle_leader_disconnect(workflow_id, disconnected_user_id):
    """
    Handle leader re-election when a user disconnects.
    """
    leader_key = f"workflow_leader:{workflow_id}"
    current_leader = redis_client.get(leader_key)
    
    if current_leader:
        current_leader = current_leader.decode('utf-8') if isinstance(current_leader, bytes) else current_leader
        
        if current_leader == disconnected_user_id:
            # Leader disconnected, elect a new leader
            users_json = redis_client.hgetall(f"workflow_online_users:{workflow_id}")
            
            if users_json:
                # Get the first remaining user as new leader
                new_leader_id = list(users_json.keys())[0]
                if isinstance(new_leader_id, bytes):
                    new_leader_id = new_leader_id.decode('utf-8')
                    
                redis_client.set(leader_key, new_leader_id, ex=3600)
                
                # Notify all users about the new leader
                broadcast_leader_change(workflow_id, new_leader_id)
            else:
                # No users left, remove leader
                redis_client.delete(leader_key)


def broadcast_leader_change(workflow_id, new_leader_id):
    """
    Broadcast leader change to all users in the workflow.
    """
    users_json = redis_client.hgetall(f"workflow_online_users:{workflow_id}")
    
    for user_id, user_info_json in users_json.items():
        try:
            user_info = json.loads(user_info_json)
            user_sid = user_info.get("sid")
            if user_sid:
                is_leader = (user_id.decode('utf-8') if isinstance(user_id, bytes) else user_id) == new_leader_id
                sio.emit("status", {"isLeader": is_leader}, room=user_sid)
        except Exception:
            continue


def get_current_leader(workflow_id):
    """
    Get the current leader for a workflow.
    """
    leader_key = f"workflow_leader:{workflow_id}"
    leader = redis_client.get(leader_key)
    return leader.decode('utf-8') if leader and isinstance(leader, bytes) else leader


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
    
    # Get current leader
    leader_id = get_current_leader(workflow_id)
    
    sio.emit("online_users", {
        "workflow_id": workflow_id, 
        "users": users,
        "leader": leader_id
    }, room=workflow_id)


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
