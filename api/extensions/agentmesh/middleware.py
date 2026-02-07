"""Trust middleware for Dify API requests."""

from __future__ import annotations

from functools import wraps
from typing import Any, Callable, Dict, List, Optional
import logging

from flask import request, g, jsonify

from extensions.agentmesh.identity import CMVKIdentity
from extensions.agentmesh.trust import TrustManager

logger = logging.getLogger(__name__)


class TrustMiddleware:
    """Middleware for trust verification in Dify API endpoints."""
    
    _instance: Optional["TrustMiddleware"] = None
    _trust_manager: Optional[TrustManager] = None
    
    def __new__(cls) -> "TrustMiddleware":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    @classmethod
    def initialize(
        cls,
        identity: Optional[CMVKIdentity] = None,
        min_trust_score: float = 0.5,
    ) -> "TrustMiddleware":
        """Initialize the trust middleware."""
        instance = cls()
        instance._trust_manager = TrustManager(
            identity=identity,
            min_trust_score=min_trust_score,
        )
        logger.info("TrustMiddleware initialized")
        return instance
    
    @classmethod
    def get_trust_manager(cls) -> Optional[TrustManager]:
        """Get the trust manager instance."""
        instance = cls()
        return instance._trust_manager
    
    @classmethod
    def require_trust(
        cls,
        min_score: float = 0.5,
        required_capabilities: Optional[List[str]] = None,
        require_headers: bool = False,
    ) -> Callable:
        """Decorator to require trust verification for an endpoint.
        
        Args:
            min_score: Minimum trust score required
            required_capabilities: List of capabilities the peer must have
            require_headers: If True, reject requests without trust headers.
                           If False (default), allow unauthenticated requests (backward compatible).
        """
        def decorator(f: Callable) -> Callable:
            @wraps(f)
            def decorated_function(*args: Any, **kwargs: Any) -> Any:
                trust_manager = cls.get_trust_manager()
                
                if not trust_manager:
                    # Trust not configured, allow through
                    return f(*args, **kwargs)
                
                # Extract trust headers
                peer_did = request.headers.get("X-Agent-DID")
                peer_public_key = request.headers.get("X-Agent-Public-Key")
                peer_capabilities = request.headers.get("X-Agent-Capabilities", "").split(",")
                peer_capabilities = [c.strip() for c in peer_capabilities if c.strip()]
                
                if not peer_did:
                    if require_headers:
                        # Strict mode: reject requests without trust headers
                        return jsonify({
                            "error": "Trust headers required",
                            "reason": "Missing X-Agent-DID header",
                        }), 401
                    # Permissive mode: allow through (backward compatible)
                    return f(*args, **kwargs)
                
                # Verify trust
                result = trust_manager.verify_peer(
                    peer_did=peer_did,
                    peer_public_key=peer_public_key or "",
                    required_capabilities=required_capabilities,
                    peer_capabilities=peer_capabilities,
                )
                
                if not result.verified:
                    return jsonify({
                        "error": "Trust verification failed",
                        "reason": result.reason,
                        "trust_score": result.trust_score,
                    }), 403
                
                if result.trust_score < min_score:
                    return jsonify({
                        "error": "Insufficient trust score",
                        "required": min_score,
                        "actual": result.trust_score,
                    }), 403
                
                # Store verification result in request context
                g.trust_verification = result
                g.peer_did = peer_did
                
                return f(*args, **kwargs)
            
            return decorated_function
        return decorator
    
    @classmethod
    def add_trust_headers(cls, response_headers: Dict[str, str]) -> Dict[str, str]:
        """Add trust headers to outgoing response."""
        trust_manager = cls.get_trust_manager()
        
        if trust_manager and trust_manager.identity:
            response_headers["X-Agent-DID"] = trust_manager.identity.did
            response_headers["X-Agent-Public-Key"] = trust_manager.identity.public_key
            response_headers["X-Agent-Capabilities"] = ",".join(
                trust_manager.identity.capabilities
            )
        
        return response_headers


def trust_required(
    min_score: float = 0.5,
    capabilities: Optional[List[str]] = None,
    require_headers: bool = False,
) -> Callable:
    """Convenience decorator for trust verification.
    
    Args:
        min_score: Minimum trust score required
        capabilities: List of capabilities the peer must have
        require_headers: If True, reject requests without trust headers (strict mode).
                        If False (default), allow unauthenticated requests (permissive).
    """
    return TrustMiddleware.require_trust(
        min_score=min_score,
        required_capabilities=capabilities,
        require_headers=require_headers,
    )
