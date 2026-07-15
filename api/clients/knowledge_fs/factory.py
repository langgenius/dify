"""Factory for the pooled HTTP KnowledgeFS client."""

from __future__ import annotations

import httpx

from clients.knowledge_fs.client import KnowledgeFSClient, OpenAPIKnowledgeFSClient
from clients.knowledge_fs.credentials import KnowledgeFSCredentialProvider, KnowledgeFSRequestAuth
from core.helper.http_client_pooling import get_pooled_http_client


def create_knowledge_fs_client(
    *,
    base_url: str,
    credential_provider: KnowledgeFSCredentialProvider,
    timeout_seconds: float,
) -> KnowledgeFSClient:
    """Create a per-request authenticated client over a shared connection pool."""
    normalized_base_url = base_url.rstrip("/")
    pool_key = f"knowledge-fs:{normalized_base_url}:{timeout_seconds}"
    http_client = get_pooled_http_client(
        pool_key,
        lambda: httpx.Client(
            base_url=normalized_base_url,
            headers={"Accept": "application/json", "Accept-Encoding": "identity"},
            auth=KnowledgeFSRequestAuth(),
            timeout=httpx.Timeout(timeout_seconds, connect=min(3.0, timeout_seconds)),
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=50),
        ),
    )
    return OpenAPIKnowledgeFSClient(
        http_client=http_client,
        credential_provider=credential_provider,
    )
