"""CMVK Identity for Dify agents."""

from __future__ import annotations

import base64
import hashlib
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

# Try to import real cryptography
try:
    from cryptography.hazmat.primitives.asymmetric import ed25519
    from cryptography.exceptions import InvalidSignature
    CRYPTO_AVAILABLE = True
except ImportError:
    CRYPTO_AVAILABLE = False

logger = logging.getLogger(__name__)


def capability_matches(owned_capability: str, required_capability: str) -> bool:
    """Check if an owned capability matches a required capability.
    
    Supports:
    - Exact match: "workflow:execute" matches "workflow:execute"
    - Universal wildcard: "*" matches anything
    - Prefix wildcard: "workflow:*" matches "workflow:execute"
    
    Args:
        owned_capability: The capability the entity has
        required_capability: The capability being checked for
        
    Returns:
        True if owned_capability grants required_capability
    """
    # Universal wildcard
    if owned_capability == "*":
        return True
    # Exact match
    if owned_capability == required_capability:
        return True
    # Prefix wildcard (e.g., "workflow:*" matches "workflow:execute")
    if owned_capability.endswith(":*"):
        prefix = owned_capability[:-1]  # "workflow:"
        if required_capability.startswith(prefix):
            return True
    return False


@dataclass
class CMVKSignature:
    """Cryptographic signature from a CMVK identity."""
    
    public_key: str
    signature: str
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "public_key": self.public_key,
            "signature": self.signature,
            "timestamp": self.timestamp.isoformat(),
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CMVKSignature":
        timestamp = data.get("timestamp")
        if isinstance(timestamp, str):
            timestamp = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        elif timestamp is None:
            timestamp = datetime.now(timezone.utc)
        
        return cls(
            public_key=data.get("public_key", ""),
            signature=data.get("signature", ""),
            timestamp=timestamp,
        )


@dataclass
class CMVKIdentity:
    """Cryptographic identity for a Dify agent/workflow using CMVK (Ed25519)."""
    
    did: str
    name: str
    public_key: str
    private_key: Optional[str] = None
    capabilities: List[str] = field(default_factory=list)
    tenant_id: Optional[str] = None  # Dify workspace binding
    app_id: Optional[str] = None     # Dify app binding
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    
    @classmethod
    def generate(
        cls,
        name: str,
        capabilities: Optional[List[str]] = None,
        tenant_id: Optional[str] = None,
        app_id: Optional[str] = None,
    ) -> "CMVKIdentity":
        """Generate a new CMVK identity."""
        seed = f"{name}:{tenant_id or ''}:{app_id or ''}:{time.time_ns()}"
        did_hash = hashlib.sha256(seed.encode()).hexdigest()[:32]
        did = f"did:cmvk:{did_hash}"
        
        if CRYPTO_AVAILABLE:
            private_key_obj = ed25519.Ed25519PrivateKey.generate()
            public_key_obj = private_key_obj.public_key()
            
            private_key_b64 = base64.b64encode(
                private_key_obj.private_bytes_raw()
            ).decode('ascii')
            public_key_b64 = base64.b64encode(
                public_key_obj.public_bytes_raw()
            ).decode('ascii')
        else:
            key_seed = hashlib.sha256(f"{did}:key".encode()).hexdigest()
            private_key_b64 = base64.b64encode(key_seed[:32].encode()).decode('ascii')
            public_key_b64 = base64.b64encode(key_seed[32:].encode()).decode('ascii')
        
        return cls(
            did=did,
            name=name,
            public_key=public_key_b64,
            private_key=private_key_b64,
            capabilities=capabilities or [],
            tenant_id=tenant_id,
            app_id=app_id,
        )
    
    def sign(self, data: str) -> CMVKSignature:
        """Sign data with this identity's private key."""
        if not self.private_key:
            raise ValueError("Cannot sign without private key")
        
        if CRYPTO_AVAILABLE:
            private_key_bytes = base64.b64decode(self.private_key)
            private_key_obj = ed25519.Ed25519PrivateKey.from_private_bytes(private_key_bytes)
            signature_bytes = private_key_obj.sign(data.encode('utf-8'))
            signature_b64 = base64.b64encode(signature_bytes).decode('ascii')
        else:
            sig_input = f"{self.private_key}:{data}"
            signature_b64 = base64.b64encode(
                hashlib.sha256(sig_input.encode()).digest()
            ).decode('ascii')
        
        return CMVKSignature(public_key=self.public_key, signature=signature_b64)
    
    def verify_signature(self, data: str, signature: CMVKSignature) -> bool:
        """Verify a signature."""
        if signature.public_key != self.public_key:
            return False
        
        if not CRYPTO_AVAILABLE:
            # Fail securely - require cryptography library for signature verification
            logger.warning("Cryptography library not available - signature verification disabled")
            return False
        
        try:
            public_key_bytes = base64.b64decode(self.public_key)
            public_key_obj = ed25519.Ed25519PublicKey.from_public_bytes(public_key_bytes)
            signature_bytes = base64.b64decode(signature.signature)
            public_key_obj.verify(signature_bytes, data.encode('utf-8'))
            return True
        except (InvalidSignature, ValueError):
            return False
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary (excludes private key)."""
        return {
            "did": self.did,
            "name": self.name,
            "public_key": self.public_key,
            "capabilities": self.capabilities,
            "tenant_id": self.tenant_id,
            "app_id": self.app_id,
            "created_at": self.created_at.isoformat(),
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CMVKIdentity":
        """Create from dictionary."""
        created_at = data.get("created_at")
        if isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        elif created_at is None:
            created_at = datetime.now(timezone.utc)
        
        return cls(
            did=data.get("did", ""),
            name=data.get("name", ""),
            public_key=data.get("public_key", ""),
            private_key=data.get("private_key"),
            capabilities=data.get("capabilities", []),
            tenant_id=data.get("tenant_id"),
            app_id=data.get("app_id"),
            created_at=created_at,
        )
    
    def has_capability(self, capability: str) -> bool:
        """Check if identity has a capability (supports wildcards)."""
        for own_capability in self.capabilities:
            if capability_matches(own_capability, capability):
                return True
        return False
