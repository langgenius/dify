import json
import logging

from celery import shared_task
from packaging.version import InvalidVersion, Version
from sqlalchemy.orm import Session

from configs import dify_config
from core.helper import encrypter, ssrf_proxy
from core.helper.model_provider_cache import ProviderCredentialsCache, ProviderCredentialsCacheType
from core.plugin.entities.plugin import PluginEntity
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.tool import PluginToolManager
from extensions.ext_database import db
from models.provider import Provider, ProviderCredential, ProviderType
from models.provider_ids import ToolProviderID
from models.tools import BuiltinToolProvider
from services.plugin.plugin_service import PluginService
from services.tools.builtin_tools_manage_service import BuiltinToolManageService

logger = logging.getLogger(__name__)

ACEDATACLOUD_PLUGIN_ORG = "acedatacloud"
ACEDATACLOUD_CREDENTIAL_NAME = "AceDataCloud Auto"
ACEDATACLOUD_CREDENTIAL_FIELD = "acedata_bearer_token"

ACEDATACLOUD_OFFICIAL_MODEL_PROVIDER_PLUGIN_IDS = (
    "langgenius/openai",
    "langgenius/gemini",
    "langgenius/anthropic",
    "langgenius/deepseek",
    "langgenius/x",
)

ACEDATACLOUD_OFFICIAL_MODEL_PROVIDER_IDS = (
    "langgenius/openai/openai",
    "langgenius/gemini/google",
    "langgenius/anthropic/anthropic",
    "langgenius/deepseek/deepseek",
    "langgenius/x/x",
)

ACEDATACLOUD_MODEL_PROVIDER_SECRET_FIELDS = frozenset(
    {
        "openai_api_key",
        "google_api_key",
        "anthropic_api_key",
        "api_key",
    }
)


def _normalize_base_url(url: str) -> str:
    url = (url or "").strip()
    if not url:
        return "https://api.acedata.cloud"
    if not (url.startswith("http://") or url.startswith("https://")):
        url = f"https://{url}"
    return url.rstrip("/")


def _is_version_newer(*, latest: str, current: str) -> bool:
    try:
        return Version(latest) > Version(current)
    except InvalidVersion:
        return latest != current


def _ensure_official_model_provider_plugins(*, tenant_id: str) -> None:
    if not dify_config.MARKETPLACE_ENABLED:
        logger.info(
            "AceDataCloud model providers: marketplace disabled, skip plugin install/upgrade. tenant_id=%s",
            tenant_id,
        )
        return

    plugin_ids = list(ACEDATACLOUD_OFFICIAL_MODEL_PROVIDER_PLUGIN_IDS)
    plugin_id_set = set(plugin_ids)
    try:
        installed = PluginService.list(tenant_id)
    except Exception:
        logger.exception(
            "AceDataCloud model providers: failed to list installed plugins, skip install/upgrade. tenant_id=%s",
            tenant_id,
        )
        return

    installed_by_plugin_id: dict[str, PluginEntity] = {}
    for plugin in installed:
        if plugin.plugin_id not in plugin_id_set:
            continue

        previous = installed_by_plugin_id.get(plugin.plugin_id)
        if not previous or _is_version_newer(latest=plugin.version, current=previous.version):
            installed_by_plugin_id[plugin.plugin_id] = plugin

    latest_map = PluginService.fetch_latest_plugin_version(plugin_ids)
    to_install: list[str] = []

    for plugin_id in plugin_ids:
        latest = latest_map.get(plugin_id)
        if not latest:
            logger.warning(
                "AceDataCloud model providers: no latest manifest from marketplace. tenant_id=%s plugin_id=%s",
                tenant_id,
                plugin_id,
            )
            continue

        installed_plugin = installed_by_plugin_id.get(plugin_id)
        if not installed_plugin:
            to_install.append(latest.unique_identifier)
            continue

        if _is_version_newer(latest=latest.version, current=installed_plugin.version):
            logger.info(
                "AceDataCloud model providers: upgrading plugin. tenant_id=%s plugin_id=%s %s->%s",
                tenant_id,
                plugin_id,
                installed_plugin.version,
                latest.version,
            )
            try:
                PluginService.upgrade_plugin_with_marketplace(
                    tenant_id=tenant_id,
                    original_plugin_unique_identifier=installed_plugin.plugin_unique_identifier,
                    new_plugin_unique_identifier=latest.unique_identifier,
                )
            except Exception:
                logger.exception(
                    "AceDataCloud model providers: upgrade failed, skip. tenant_id=%s plugin_id=%s",
                    tenant_id,
                    plugin_id,
                )

    if not to_install:
        return

    logger.info(
        "AceDataCloud model providers: installing missing plugins. tenant_id=%s plugins=%s",
        tenant_id,
        to_install,
    )
    try:
        PluginService.install_from_marketplace_pkg(tenant_id=tenant_id, plugin_unique_identifiers=to_install)
    except Exception:
        logger.exception(
            "AceDataCloud model providers: failed to install missing plugins. tenant_id=%s",
            tenant_id,
        )


def _encrypt_model_provider_credentials(*, tenant_id: str, credentials: dict[str, str]) -> dict[str, str]:
    encrypted: dict[str, str] = {}
    for key, value in credentials.items():
        if key in ACEDATACLOUD_MODEL_PROVIDER_SECRET_FIELDS:
            encrypted[key] = encrypter.encrypt_token(tenant_id, value)
            continue
        encrypted[key] = value
    return encrypted


def _model_provider_credentials(*, token: str) -> dict[str, dict[str, str]]:
    base_url = _normalize_base_url(dify_config.ACEDATACLOUD_MODEL_PROVIDER_API_BASE_URL)
    return {
        "langgenius/openai/openai": {
            "openai_api_key": token,
            "openai_api_base": base_url,
        },
        "langgenius/gemini/google": {
            "google_api_key": token,
            "google_base_url": base_url,
        },
        "langgenius/anthropic/anthropic": {
            "anthropic_api_key": token,
            "anthropic_api_url": base_url,
        },
        "langgenius/deepseek/deepseek": {
            "api_key": token,
            "endpoint_url": base_url,
        },
        "langgenius/x/x": {
            "api_key": token,
            "endpoint_url": base_url,
        },
    }


def _upsert_model_provider_credentials(*, tenant_id: str, provider: str, credentials: dict[str, str]) -> None:
    encrypted = _encrypt_model_provider_credentials(tenant_id=tenant_id, credentials=credentials)
    encrypted_config = json.dumps(encrypted)

    with Session(db.engine) as session:
        existing_credential: ProviderCredential | None = (
            session.query(ProviderCredential)
            .where(
                ProviderCredential.tenant_id == tenant_id,
                ProviderCredential.provider_name == provider,
                ProviderCredential.credential_name == ACEDATACLOUD_CREDENTIAL_NAME,
            )
            .order_by(ProviderCredential.created_at.desc())
            .first()
        )

        if existing_credential:
            logger.info(
                "AceDataCloud model providers: updating credentials. tenant_id=%s provider=%s credential_id=%s",
                tenant_id,
                provider,
                existing_credential.id,
            )
            existing_credential.encrypted_config = encrypted_config
            credential_id = existing_credential.id
        else:
            logger.info(
                "AceDataCloud model providers: creating credentials. tenant_id=%s provider=%s", tenant_id, provider
            )
            record = ProviderCredential(
                tenant_id=tenant_id,
                provider_name=provider,
                credential_name=ACEDATACLOUD_CREDENTIAL_NAME,
                encrypted_config=encrypted_config,
            )
            session.add(record)
            session.flush()
            credential_id = record.id

        provider_record: Provider | None = (
            session.query(Provider)
            .where(
                Provider.tenant_id == tenant_id,
                Provider.provider_name == provider,
                Provider.provider_type == ProviderType.CUSTOM,
            )
            .order_by(Provider.created_at.desc())
            .first()
        )

        if not provider_record:
            provider_record = Provider(
                tenant_id=tenant_id,
                provider_name=provider,
                provider_type=ProviderType.CUSTOM,
                is_valid=True,
                credential_id=credential_id,
            )
            session.add(provider_record)
            session.flush()
        else:
            provider_record.is_valid = True
            provider_record.credential_id = credential_id

        session.commit()

        ProviderCredentialsCache(
            tenant_id=tenant_id,
            identity_id=provider_record.id,
            cache_type=ProviderCredentialsCacheType.PROVIDER,
        ).delete()


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
    provider_name = provider_id_entity.provider_name

    def _set_default(*, credential_id: str) -> None:
        with Session(db.engine) as session:
            session.query(BuiltinToolProvider).where(
                BuiltinToolProvider.tenant_id == tenant_id,
                (BuiltinToolProvider.provider == provider_id) | (BuiltinToolProvider.provider == provider_name),
            ).update({"is_default": False})
            session.query(BuiltinToolProvider).where(BuiltinToolProvider.id == credential_id).update(
                {"is_default": True}
            )
            session.commit()

    def _log_effective_state(*, credential_id: str, action: str) -> None:
        with Session(db.engine) as session:
            rows = (
                session.query(BuiltinToolProvider)
                .where(
                    BuiltinToolProvider.tenant_id == tenant_id,
                    (BuiltinToolProvider.provider == provider_id) | (BuiltinToolProvider.provider == provider_name),
                )
                .order_by(BuiltinToolProvider.is_default.desc(), BuiltinToolProvider.created_at.asc())
                .all()
            )
        logger.info(
            "AceDataCloud credentials: %s done. tenant_id=%s provider=%s provider_name=%s credential_id=%s "
            "credentials_total=%s default_id=%s providers=%s",
            action,
            tenant_id,
            provider_id,
            provider_name,
            credential_id,
            len(rows),
            next((r.id for r in rows if r.is_default), None),
            [{"id": r.id, "provider": r.provider, "name": r.name, "is_default": r.is_default} for r in rows],
        )

    with Session(db.engine) as session:
        existing_auto = (
            session.query(BuiltinToolProvider)
            .where(BuiltinToolProvider.tenant_id == tenant_id, BuiltinToolProvider.provider == provider_id)
            .where(BuiltinToolProvider.name == ACEDATACLOUD_CREDENTIAL_NAME)
            .order_by(BuiltinToolProvider.is_default.desc(), BuiltinToolProvider.created_at.asc())
            .first()
        )
        existing_legacy_auto = None
        if not existing_auto:
            existing_legacy_auto = (
                session.query(BuiltinToolProvider)
                .where(
                    BuiltinToolProvider.tenant_id == tenant_id,
                    BuiltinToolProvider.provider == provider_name,
                )
                .where(BuiltinToolProvider.name == ACEDATACLOUD_CREDENTIAL_NAME)
                .order_by(BuiltinToolProvider.is_default.desc(), BuiltinToolProvider.created_at.asc())
                .first()
            )

    if existing_auto:
        logger.info(
            "AceDataCloud credentials: updating. tenant_id=%s provider=%s credential_id=%s",
            tenant_id,
            provider_id,
            existing_auto.id,
        )
        BuiltinToolManageService.update_builtin_tool_provider(
            user_id=account_id,
            tenant_id=tenant_id,
            provider=provider_id,
            credential_id=existing_auto.id,
            credentials=credentials,
            name=existing_auto.name,
            validate=False,
        )
        _set_default(credential_id=existing_auto.id)
        _log_effective_state(credential_id=existing_auto.id, action="update")
        return

    if existing_legacy_auto:
        logger.info(
            "AceDataCloud credentials: legacy credential exists under provider_name; "
            "will create canonical and override. "
            "tenant_id=%s provider=%s provider_name=%s legacy_credential_id=%s",
            tenant_id,
            provider_id,
            provider_name,
            existing_legacy_auto.id,
        )

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

    with Session(db.engine) as session:
        created = (
            session.query(BuiltinToolProvider)
            .where(
                BuiltinToolProvider.tenant_id == tenant_id,
                BuiltinToolProvider.provider == provider_id,
                BuiltinToolProvider.name == ACEDATACLOUD_CREDENTIAL_NAME,
            )
            .order_by(BuiltinToolProvider.created_at.desc())
            .first()
        )
    if not created:
        logger.error(
            "AceDataCloud credentials: created credential not found after insert. tenant_id=%s provider=%s name=%s",
            tenant_id,
            provider_id,
            ACEDATACLOUD_CREDENTIAL_NAME,
        )
        return

    _set_default(credential_id=created.id)
    _log_effective_state(credential_id=created.id, action="create")


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

    _ensure_official_model_provider_plugins(tenant_id=tenant_id)

    token = _get_or_create_platform_token(user_id=acedatacloud_user_id, access_token=acedatacloud_access_token)
    logger.info("AceDataCloud credentials: got token. tenant_id=%s user_id=%s", tenant_id, acedatacloud_user_id)

    model_provider_credentials = _model_provider_credentials(token=token)
    for provider in ACEDATACLOUD_OFFICIAL_MODEL_PROVIDER_IDS:
        creds = model_provider_credentials.get(provider)
        if not creds:
            continue
        try:
            _upsert_model_provider_credentials(tenant_id=tenant_id, provider=provider, credentials=creds)
        except Exception:
            logger.exception(
                "AceDataCloud model providers: failed to upsert credentials. tenant_id=%s provider=%s",
                tenant_id,
                provider,
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

    logger.info(
        "AceDataCloud credentials: provisioning providers. tenant_id=%s providers=%s",
        tenant_id,
        sorted(acedatacloud_provider_ids),
    )
    provisioned: list[str] = []
    failed: list[str] = []
    for provider_id in acedatacloud_provider_ids:
        try:
            _upsert_provider_credentials(
                tenant_id=tenant_id, account_id=account_id, provider_id=provider_id, token=token
            )
            provisioned.append(provider_id)
        except Exception:
            failed.append(provider_id)
            logger.exception(
                "AceDataCloud credentials: failed to upsert provider. tenant_id=%s provider=%s",
                tenant_id,
                provider_id,
            )

    logger.info(
        "AceDataCloud credentials: finished. tenant_id=%s provisioned=%s failed=%s",
        tenant_id,
        provisioned,
        failed,
    )
