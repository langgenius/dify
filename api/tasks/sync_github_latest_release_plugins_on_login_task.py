import json
import logging

from celery import shared_task
from sqlalchemy.orm import Session

from configs import dify_config
from core.helper.encrypter import decrypt_token
from extensions.ext_database import db
from extensions.ext_storage import storage
from models import AccountIntegrate
from services.plugin.plugin_service import PluginService

logger = logging.getLogger(__name__)


def _mask_token(token: str) -> str:
    if len(token) <= 12:
        return "***"
    return f"{token[:6]}...{token[-4:]}"


def _load_acedatacloud_access_token(*, tenant_id: str, account_id: str) -> tuple[str | None, str | None]:
    """
    Returns (acedatacloud_user_id, access_token) if available for this account; otherwise (None, None).
    """
    with Session(db.engine) as session:
        account_integrate: AccountIntegrate | None = (
            session.query(AccountIntegrate).filter_by(account_id=account_id, provider="acedatacloud").first()
        )
        if not account_integrate:
            return None, None

        token_file = account_integrate.encrypted_token or ""
        if not token_file:
            return None, None

        try:
            raw = storage.load(token_file)
            token_doc = json.loads(raw.decode("utf-8"))
            encrypted_payload = token_doc.get("encrypted_payload")
            decrypt_tenant_id = token_doc.get("tenant_id") or tenant_id
            if not encrypted_payload or not decrypt_tenant_id:
                return None, None

            payload_raw = decrypt_token(str(decrypt_tenant_id), encrypted_payload)
            payload = json.loads(payload_raw) if payload_raw else {}
            access_token = payload.get("access_token")
            if not isinstance(access_token, str) or not access_token:
                return None, None
        except Exception:
            logger.exception(
                "GitHub latest release sync on login: failed to load AceDataCloud token. tenant_id=%s account_id=%s",
                tenant_id,
                account_id,
            )
            return None, None

        return account_integrate.open_id, access_token


@shared_task(queue="plugin")
def sync_github_latest_release_plugins_on_login_task(*, tenant_id: str, account_id: str) -> None:
    if not dify_config.PLUGIN_SYNC_GITHUB_LATEST_RELEASE_ON_LOGIN_ENABLED:
        logger.info(
            "GitHub latest release sync on login: disabled. tenant_id=%s account_id=%s",
            tenant_id,
            account_id,
        )
        return

    repos = (
        dify_config.PLUGIN_SYNC_GITHUB_LATEST_RELEASE_ON_LOGIN_REPOS or dify_config.DEFAULT_TENANT_GITHUB_RELEASE_REPOS
    )
    repos = [r.strip() for r in repos if isinstance(r, str) and r.strip()]
    if not repos:
        logger.info(
            "GitHub latest release sync on login: no repos configured. tenant_id=%s account_id=%s",
            tenant_id,
            account_id,
        )
        return
    logger.info(
        "GitHub latest release sync on login: resolved repos. tenant_id=%s account_id=%s repos=%s",
        tenant_id,
        account_id,
        repos,
    )

    logger.info(
        "GitHub latest release sync on login: start. tenant_id=%s account_id=%s repos=%s",
        tenant_id,
        account_id,
        repos,
    )
    installed_total = 0
    for repo in repos:
        try:
            logger.info(
                "GitHub latest release sync on login: syncing repo. tenant_id=%s account_id=%s repo=%s",
                tenant_id,
                account_id,
                repo,
            )
            installed_count = PluginService.sync_latest_release_plugins_for_tenant(tenant_id=tenant_id, repo=repo)
            installed_total += installed_count
            logger.info(
                "GitHub latest release sync on login: repo synced. tenant_id=%s account_id=%s repo=%s installed=%s",
                tenant_id,
                account_id,
                repo,
                installed_count,
            )
        except Exception:
            logger.exception(
                "GitHub latest release sync on login: repo failed. tenant_id=%s account_id=%s repo=%s",
                tenant_id,
                account_id,
                repo,
            )

    logger.info(
        "GitHub latest release sync on login: finished. tenant_id=%s account_id=%s repos=%s installed_total=%s",
        tenant_id,
        account_id,
        repos,
        installed_total,
    )

    if installed_total <= 0:
        logger.info(
            "GitHub latest release sync on login: skip AceDataCloud provision (no plugin changes). "
            "tenant_id=%s account_id=%s",
            tenant_id,
            account_id,
        )
        return

    if not dify_config.ACEDATACLOUD_AUTO_PROVISION_PLUGIN_CREDENTIALS:
        return

    acedatacloud_user_id, acedatacloud_access_token = _load_acedatacloud_access_token(
        tenant_id=tenant_id,
        account_id=account_id,
    )
    if not acedatacloud_user_id or not acedatacloud_access_token:
        logger.info(
            "GitHub latest release sync on login: skip AceDataCloud provision (no token). tenant_id=%s account_id=%s",
            tenant_id,
            account_id,
        )
        return

    try:
        from tasks.provision_acedatacloud_plugin_credentials_task import provision_acedatacloud_plugin_credentials_task

        logger.info(
            "GitHub latest release sync on login: enqueue AceDataCloud provision. "
            "tenant_id=%s account_id=%s user_id=%s token=%s",
            tenant_id,
            account_id,
            acedatacloud_user_id,
            _mask_token(acedatacloud_access_token),
        )
        provision_acedatacloud_plugin_credentials_task.delay(
            tenant_id=str(tenant_id),
            account_id=str(account_id),
            acedatacloud_user_id=str(acedatacloud_user_id),
            acedatacloud_access_token=str(acedatacloud_access_token),
        )
    except Exception:
        logger.exception(
            "GitHub latest release sync on login: failed to enqueue AceDataCloud provision. tenant_id=%s account_id=%s",
            tenant_id,
            account_id,
        )
