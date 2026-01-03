import logging

from celery import shared_task
from sqlalchemy.orm import Session

from configs import dify_config
from core.helper import ssrf_proxy
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.tool import PluginToolManager
from extensions.ext_database import db
from models.provider_ids import ToolProviderID
from models.tools import BuiltinToolProvider
from services.tools.builtin_tools_manage_service import BuiltinToolManageService

logger = logging.getLogger(__name__)

ACEDATACLOUD_PLUGIN_ORG = "acedatacloud"
ACEDATACLOUD_CREDENTIAL_NAME = "AceDataCloud Auto"
ACEDATACLOUD_CREDENTIAL_FIELD = "acedata_bearer_token"


def _platform_headers(*, user_id: str, access_token: str) -> dict[str, str]:
    return {
        "Accept": "application/json",
        "Authorization": f"Bearer {access_token}",
        "X-User-Id": user_id,
    }


def _mask_token(token: str) -> str:
    if len(token) <= 12:
        return "***"
    return f"{token[:6]}...{token[-4:]}"


def _extract_latest_application(payload: dict) -> dict | None:
    items = payload.get("items")
    if isinstance(items, list) and items:
        first = items[0]
        return first if isinstance(first, dict) else None
    return None


def _extract_token_from_application(app: dict) -> str | None:
    credentials = app.get("credentials")
    if not isinstance(credentials, list) or not credentials:
        return None
    first = credentials[0]
    if not isinstance(first, dict):
        return None
    token = first.get("token")
    return token if isinstance(token, str) and token else None


def _extract_token_from_credential(payload: dict) -> str | None:
    token = payload.get("token")
    return token if isinstance(token, str) and token else None


def _get_or_create_platform_token(*, user_id: str, access_token: str) -> str:
    base = dify_config.ACEDATACLOUD_PLATFORM_API_BASE_URL.rstrip("/")
    list_url = f"{base}/api/v1/applications/?limit=10&user_id={user_id}&ordering=-created_at&type=Usage&scope=Global"

    logger.info("AceDataCloud token: listing applications. user_id=%s url=%s", user_id, list_url)
    resp = ssrf_proxy.get(
        list_url,
        follow_redirects=True,
        headers=_platform_headers(user_id=user_id, access_token=access_token),
    )
    resp.raise_for_status()
    payload = resp.json()
    logger.info(
        "AceDataCloud token: applications listed. user_id=%s status=%s keys=%s items=%s",
        user_id,
        resp.status_code,
        sorted(payload.keys()) if isinstance(payload, dict) else [],
        len(payload.get("items", [])) if isinstance(payload, dict) and isinstance(payload.get("items"), list) else 0,
    )

    app = _extract_latest_application(payload)
    if not app:
        create_url = f"{base}/api/v1/applications/"
        logger.info("AceDataCloud token: creating application. user_id=%s url=%s", user_id, create_url)
        create_resp = ssrf_proxy.post(
            create_url,
            follow_redirects=True,
            headers={
                **_platform_headers(user_id=user_id, access_token=access_token),
                "Content-Type": "application/json",
            },
            json={"type": "Usage", "scope": "Global", "user_id": user_id},
        )
        create_resp.raise_for_status()
        app = create_resp.json()
        logger.info(
            "AceDataCloud token: application created. user_id=%s status=%s application_id=%s",
            user_id,
            create_resp.status_code,
            app.get("id") if isinstance(app, dict) else None,
        )
    else:
        creds = app.get("credentials")
        logger.info(
            "AceDataCloud token: application found. user_id=%s application_id=%s credentials=%s",
            user_id,
            app.get("id"),
            len(creds) if isinstance(creds, list) else 0,
        )

    token = _extract_token_from_application(app)
    if token:
        logger.info(
            "AceDataCloud token: found token in application. user_id=%s application_id=%s token=%s",
            user_id,
            app.get("id"),
            _mask_token(token),
        )
        return token

    application_id = app.get("id")
    if not isinstance(application_id, str) or not application_id:
        raise ValueError("AceDataCloud token: application id is missing")

    credentials_url = f"{base}/api/v1/credentials/"
    logger.info(
        "AceDataCloud token: creating credential. user_id=%s application_id=%s url=%s",
        user_id,
        application_id,
        credentials_url,
    )
    cred_resp = ssrf_proxy.post(
        credentials_url,
        follow_redirects=True,
        headers={**_platform_headers(user_id=user_id, access_token=access_token), "Content-Type": "application/json"},
        json={"application_id": application_id},
    )
    cred_resp.raise_for_status()
    cred_payload = cred_resp.json()
    token = _extract_token_from_credential(cred_payload if isinstance(cred_payload, dict) else {})
    if not token:
        raise ValueError("AceDataCloud token: credential token is missing")
    logger.info(
        "AceDataCloud token: credential created. user_id=%s application_id=%s status=%s token=%s",
        user_id,
        application_id,
        cred_resp.status_code,
        _mask_token(token),
    )

    return token


def _upsert_provider_credentials(*, tenant_id: str, account_id: str, provider_id: str, token: str) -> None:
    credentials = {ACEDATACLOUD_CREDENTIAL_FIELD: token}
    provider_id_entity = ToolProviderID(provider_id)

    with Session(db.engine) as session:
        existing = (
            session.query(BuiltinToolProvider)
            .where(BuiltinToolProvider.tenant_id == tenant_id, BuiltinToolProvider.provider == provider_id)
            .order_by(BuiltinToolProvider.is_default.desc(), BuiltinToolProvider.created_at.asc())
            .first()
        )
        if not existing:
            existing = (
                session.query(BuiltinToolProvider)
                .where(
                    BuiltinToolProvider.tenant_id == tenant_id,
                    BuiltinToolProvider.provider == provider_id_entity.provider_name,
                )
                .order_by(BuiltinToolProvider.is_default.desc(), BuiltinToolProvider.created_at.asc())
                .first()
            )

    if existing:
        logger.info(
            "AceDataCloud credentials: updating. tenant_id=%s provider=%s credential_id=%s",
            tenant_id,
            provider_id,
            existing.id,
        )
        BuiltinToolManageService.update_builtin_tool_provider(
            user_id=account_id,
            tenant_id=tenant_id,
            provider=provider_id,
            credential_id=existing.id,
            credentials=credentials,
            name=existing.name,
            validate=False,
        )
        return

    logger.info("AceDataCloud credentials: creating. tenant_id=%s provider=%s", tenant_id, provider_id)
    BuiltinToolManageService.add_builtin_tool_provider(
        user_id=account_id,
        tenant_id=tenant_id,
        provider=provider_id,
        credentials=credentials,
        name=ACEDATACLOUD_CREDENTIAL_NAME,
        api_type=CredentialType.API_KEY,
        validate=False,
    )


@shared_task(
    queue="plugin",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=60,
    max_retries=20,
)
def provision_acedatacloud_plugin_credentials_task(
    self,
    *,
    tenant_id: str,
    account_id: str,
    acedatacloud_user_id: str,
    acedatacloud_access_token: str,
) -> None:
    if not dify_config.ACEDATACLOUD_AUTO_PROVISION_PLUGIN_CREDENTIALS:
        logger.info(
            "AceDataCloud credentials: disabled. tenant_id=%s account_id=%s",
            tenant_id,
            account_id,
        )
        return

    logger.info(
        "AceDataCloud credentials: start. tenant_id=%s account_id=%s user_id=%s",
        tenant_id,
        account_id,
        acedatacloud_user_id,
    )

    manager = PluginToolManager()
    providers = manager.fetch_tool_providers(tenant_id)
    all_plugin_ids = sorted({p.plugin_id for p in providers if isinstance(p.plugin_id, str) and p.plugin_id})
    discovered = [
        {
            "plugin_id": p.plugin_id,
            "provider_id": p.declaration.identity.name,
            "provider_name": p.declaration.identity.name.split("/", 2)[-1]
            if isinstance(p.declaration.identity.name, str)
            else None,
        }
        for p in providers
        if isinstance(p.plugin_id, str) and isinstance(p.declaration.identity.name, str)
    ]
    acedatacloud_provider_ids = [
        p.declaration.identity.name
        for p in providers
        if isinstance(p.plugin_id, str) and p.plugin_id.lower().startswith(f"{ACEDATACLOUD_PLUGIN_ORG}/")
    ]

    logger.info(
        "AceDataCloud credentials: discovered providers. tenant_id=%s total=%s plugins=%s acedatacloud=%s",
        tenant_id,
        len(providers),
        all_plugin_ids,
        len(acedatacloud_provider_ids),
    )
    logger.info("AceDataCloud credentials: provider details. tenant_id=%s providers=%s", tenant_id, discovered)
    if not acedatacloud_provider_ids:
        default_release_repos = dify_config.DEFAULT_TENANT_GITHUB_RELEASE_REPOS
        default_github_plugins = dify_config.DEFAULT_TENANT_GITHUB_PLUGINS
        default_identifiers = dify_config.DEFAULT_TENANT_PLUGIN_UNIQUE_IDENTIFIERS

        expects_acedatacloud_plugins = (
            any(
                isinstance(r, str) and r.lower().startswith(f"{ACEDATACLOUD_PLUGIN_ORG}/")
                for r in default_release_repos
            )
            or any(
                isinstance(getattr(p, "repo", None), str)
                and getattr(p, "repo", "").lower().startswith(f"{ACEDATACLOUD_PLUGIN_ORG}/")
                for p in default_github_plugins
            )
            or any(isinstance(i, str) and f"{ACEDATACLOUD_PLUGIN_ORG}/" in i.lower() for i in default_identifiers)
        )

        logger.info(
            "AceDataCloud credentials: no acedatacloud providers found. tenant_id=%s expects_acedatacloud_plugins=%s",
            tenant_id,
            expects_acedatacloud_plugins,
        )
        if expects_acedatacloud_plugins:
            raise RuntimeError("AceDataCloud providers not ready yet")
        return

    token = _get_or_create_platform_token(user_id=acedatacloud_user_id, access_token=acedatacloud_access_token)
    logger.info("AceDataCloud credentials: got token. tenant_id=%s user_id=%s", tenant_id, acedatacloud_user_id)

    logger.info(
        "AceDataCloud credentials: provisioning providers. tenant_id=%s providers=%s",
        tenant_id,
        sorted(acedatacloud_provider_ids),
    )
    for provider_id in acedatacloud_provider_ids:
        try:
            _upsert_provider_credentials(
                tenant_id=tenant_id, account_id=account_id, provider_id=provider_id, token=token
            )
        except Exception:
            logger.exception(
                "AceDataCloud credentials: failed to upsert provider. tenant_id=%s provider=%s",
                tenant_id,
                provider_id,
            )
