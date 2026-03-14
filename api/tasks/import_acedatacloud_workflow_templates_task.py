import logging
from pathlib import Path

import yaml
from celery import shared_task
from sqlalchemy import select
from sqlalchemy.orm import Session

from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models import Account, App
from models.model import RecommendedApp

logger = logging.getLogger(__name__)

WORKFLOWS_DIR = Path(__file__).resolve().parent.parent.parent / "workflows"
REDIS_KEY_PREFIX = "acedatacloud_workflow_imported:"
REDIS_EXPLORE_KEY = "acedatacloud_explore_setup_done"
REDIS_EXPIRY = 365 * 24 * 3600  # 1 year

EXPLORE_CATEGORY = "AceDataCloud"
EXPLORE_LANGUAGE = "en-US"


def _get_workflow_files() -> list[Path]:
    if not WORKFLOWS_DIR.is_dir():
        return []
    return sorted(WORKFLOWS_DIR.glob("*.yml"))


def _parse_workflow_yaml(wf_file: Path) -> dict:
    """Parse a workflow YAML file and return the parsed dict, or empty dict on failure."""
    try:
        parsed = yaml.safe_load(wf_file.read_text(encoding="utf-8"))
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _already_imported(*, tenant_id: str, template_name: str) -> bool:
    key = f"{REDIS_KEY_PREFIX}{tenant_id}:{template_name}"
    return bool(redis_client.exists(key))


def _mark_imported(*, tenant_id: str, template_name: str, app_id: str) -> None:
    key = f"{REDIS_KEY_PREFIX}{tenant_id}:{template_name}"
    redis_client.setex(key, REDIS_EXPIRY, app_id)


def _import_single_workflow(
    *,
    session: Session,
    account: Account,
    tenant_id: str,
    wf_file: Path,
) -> str | None:
    """Import a single workflow YAML into the given tenant.

    Returns the created app_id on success, or None on skip/failure.
    """
    from services.app_dsl_service import AppDslService, ImportStatus

    template_name = wf_file.stem

    if _already_imported(tenant_id=tenant_id, template_name=template_name):
        return None

    yaml_content = wf_file.read_text(encoding="utf-8")
    if not yaml_content.strip():
        return None

    parsed = _parse_workflow_yaml(wf_file)
    app_name = parsed.get("app", {}).get("name", "")

    # Check if an app with the same name already exists in this tenant
    if app_name:
        existing = session.execute(
            select(App.id).where(App.tenant_id == tenant_id, App.name == app_name).limit(1)
        ).scalar_one_or_none()
        if existing:
            _mark_imported(tenant_id=tenant_id, template_name=template_name, app_id=str(existing))
            return None

    account.current_tenant_id = tenant_id
    dsl_service = AppDslService(session)

    result = dsl_service.import_app(
        account=account,
        import_mode="yaml-content",
        yaml_content=yaml_content,
    )

    if result.status in (ImportStatus.COMPLETED, ImportStatus.COMPLETED_WITH_WARNINGS):
        session.commit()
        _mark_imported(tenant_id=tenant_id, template_name=template_name, app_id=str(result.app_id or ""))
        logger.info("AceDataCloud: imported %s app_id=%s tenant=%s", template_name, result.app_id, tenant_id)
        return str(result.app_id) if result.app_id else None

    if result.status == ImportStatus.PENDING:
        confirm_result = dsl_service.confirm_import(import_id=result.id, account=account)
        if confirm_result.status in (ImportStatus.COMPLETED, ImportStatus.COMPLETED_WITH_WARNINGS):
            session.commit()
            _mark_imported(
                tenant_id=tenant_id, template_name=template_name, app_id=str(confirm_result.app_id or "")
            )
            logger.info("AceDataCloud: imported (confirmed) %s app_id=%s", template_name, confirm_result.app_id)
            return str(confirm_result.app_id) if confirm_result.app_id else None
        session.rollback()
        logger.warning("AceDataCloud: confirm failed %s status=%s", template_name, confirm_result.status)
        return None

    session.rollback()
    logger.warning("AceDataCloud: import failed %s status=%s error=%s", template_name, result.status, result.error)
    return None


def _register_explore_apps(*, session: Session, tenant_id: str, workflow_files: list[Path]) -> None:
    """Register already-imported workflows in Explore. Does NOT import anything.

    Idempotent: uses a Redis key so this only runs once.
    """
    if redis_client.exists(REDIS_EXPLORE_KEY):
        return

    logger.info("AceDataCloud: registering Explore apps from tenant=%s", tenant_id)

    for position, wf_file in enumerate(workflow_files):
        parsed = _parse_workflow_yaml(wf_file)
        app_name = parsed.get("app", {}).get("name", "")
        if not app_name:
            continue

        # Find the app that was already imported into this tenant
        app_id = session.execute(
            select(App.id).where(App.tenant_id == tenant_id, App.name == app_name).limit(1)
        ).scalar_one_or_none()
        if not app_id:
            logger.warning("AceDataCloud: app not found for Explore: %s", wf_file.stem)
            continue

        app_id_str = str(app_id)

        # Skip if already registered
        if session.execute(
            select(RecommendedApp.id).where(RecommendedApp.app_id == app_id_str).limit(1)
        ).first():
            continue

        app = session.get(App, app_id_str)
        if not app:
            continue

        app.is_public = True
        recommended = RecommendedApp(
            app_id=app_id_str,
            description={"text": parsed.get("app", {}).get("description", "")},
            copyright="AceDataCloud",
            privacy_policy="https://acedata.cloud/privacy",
            custom_disclaimer="",
            language=EXPLORE_LANGUAGE,
            category=EXPLORE_CATEGORY,
            position=position,
            is_listed=True,
        )
        session.add(recommended)
        session.commit()
        logger.info("AceDataCloud: added %s to Explore (app_id=%s)", wf_file.stem, app_id_str)

    redis_client.setex(REDIS_EXPLORE_KEY, REDIS_EXPIRY, "1")
    logger.info("AceDataCloud: Explore setup complete")


@shared_task(
    queue="plugin",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=120,
    max_retries=5,
)
def import_acedatacloud_workflow_templates_task(
    self,
    *,
    tenant_id: str,
    account_id: str,
) -> None:
    """Import workflow templates for a new user and register them in Explore.

    Only called once per new user from the OAuth callback.
    """
    workflow_files = _get_workflow_files()
    if not workflow_files:
        logger.info("AceDataCloud: no workflow files found in %s", WORKFLOWS_DIR)
        return

    logger.info("AceDataCloud: importing %d workflows for tenant=%s", len(workflow_files), tenant_id)

    with Session(db.engine) as session:
        account: Account | None = session.get(Account, account_id)
        if not account:
            logger.error("AceDataCloud: account not found: %s", account_id)
            return

        # 1) Import all workflows into user's workspace
        imported = 0
        for wf_file in workflow_files:
            if _import_single_workflow(session=session, account=account, tenant_id=tenant_id, wf_file=wf_file):
                imported += 1
        logger.info("AceDataCloud: imported %d workflows for tenant=%s", imported, tenant_id)

        # 2) Register in Explore if not done yet (idempotent, only runs once)
        _register_explore_apps(session=session, tenant_id=tenant_id, workflow_files=workflow_files)
