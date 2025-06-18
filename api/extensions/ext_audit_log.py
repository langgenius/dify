import logging
import time
from datetime import datetime
from typing import Optional

from flask import Flask, g, has_request_context, request
from flask.signals import request_finished, request_started

from configs import dify_config

_logger = logging.getLogger(__name__)


class AuditLogContext:

    def __init__(self):
        self.start_time = time.time()
        
        # basic user info
        self.user: Optional[str] = None
        
        # operation info
        self.action: Optional[str] = None
        self.resource: Optional[str] = None
        
        # ip info
        self.ip: Optional[str] = None

    def get_duration(self) -> float:
        return time.time() - self.start_time


def _get_genai_ip() -> Optional[str]:
    """get X-GENAI-IP"""
    return request.headers.get("X-GENAI-IP")


def _get_genai_user() -> Optional[str]:
    """get X-GENAI-USER"""
    return request.headers.get("X-GENAI-USER")


def _determine_action() -> str:
    """get action by http method"""
    return request.method.upper()


def _determine_resource() -> str:
    """get resource by path"""
    path = request.path.lower()

    if "/api/apps/" in path:
        return "APP"
    elif "/api/datasets/" in path:
        return "DATASET"
    elif "/api/messages/" in path:
        return "MESSAGE"
    elif "/api/conversations/" in path:
        return "CONVERSATION"
    elif "/api/users/" in path:
        return "USER"
    else:
        return "UNKNOWN"


def _should_log_request() -> bool:
    if not has_request_context():
        return False
    
    # check if audit log is enab    
    if not getattr(dify_config, "ENABLE_AUDIT_LOG", False):
        return False
    
    
    static_extensions = [".css", ".js", ".png", ".jpg", ".ico", ".svg"]
    if any(request.path.lower().endswith(ext) for ext in static_extensions):
        return False
    
    # skip OPTIONS request
    if request.method == "OPTIONS":
        return False
    
    return True


def _log_request_started(_sender, **_extra):
    if not _should_log_request():
        return

    g.audit_log = AuditLogContext()

    # get user and ip
    g.audit_log.user = _get_genai_user()
    g.audit_log.ip = _get_genai_ip()
    
    g.audit_log.action = _determine_action()
    g.audit_log.resource = _determine_resource()


def _log_request_finished(_sender, response, **_extra):
    if not hasattr(g, "audit_log") or not g.audit_log:
        return

    log_str = _format_audit_log(g.audit_log, response)
    _logger.info(log_str)


def _format_audit_log(audit_context: AuditLogContext, response) -> str:
    who = audit_context.user or "unknown"
    ip = audit_context.ip or "unknown"
    timestamp = datetime.utcnow().isoformat()
    target_object = audit_context.resource or "unknown_resource"
    action = audit_context.action or "unknown_action"
    result = f"HTTP {response.status_code}"
    
    return (
        f"AUDIT | who={who} | ip={ip} | time={timestamp} | "
        f"target={target_object} | action={action} | result={result}"
    )


def is_enabled() -> bool:
    return getattr(dify_config, "ENABLE_AUDIT_LOG", False)


def init_app(app: Flask):
    """init audit log extension"""
    if not is_enabled():
        return

    # flask signals
    request_started.connect(_log_request_started, app)
    request_finished.connect(_log_request_finished, app)

    _logger.info("Audit log extension initialized")


def get_audit_context() -> Optional[AuditLogContext]:
    return getattr(g, "audit_log", None)