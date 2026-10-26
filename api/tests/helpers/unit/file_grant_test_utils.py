import time
from collections.abc import Sequence

from configs import dify_config
from services.entities.file_grant_entities import FileGrantContext, FileGrantScope
from services.file_grant_gateways import FileGrantTokenGateway


def token_gateway() -> FileGrantTokenGateway:
    return FileGrantTokenGateway(
        secret_key=dify_config.SECRET_KEY,
        external_files_url=dify_config.FILES_URL,
        internal_files_url=dify_config.INTERNAL_FILES_URL or dify_config.FILES_URL,
        content_token_ttl_seconds=dify_config.FILES_ACCESS_TIMEOUT,
        now=lambda: int(time.time()),
    )


def issue_file_grant(
    *,
    end_user_id: str,
    tenant_id: str,
    app_id: str,
    scopes: Sequence[FileGrantScope],
    ttl_seconds: int,
) -> tuple[str, int]:
    return token_gateway().issue_grant(
        context=FileGrantContext(tenant_id=tenant_id, app_id=app_id, end_user_id=end_user_id),
        scopes=scopes,
        ttl_seconds=ttl_seconds,
    )
