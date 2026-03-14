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


def _already_imported(*, tenant_id: str, template_name: str) -> bool:
    key = f"{REDIS_KEY_PREFIX}{tenant_id}:{template_name}"
    return bool(redis_client.exists(key))


def _mark_imported(*, tenant_id: str, template_name: str, app_id: str) -> None:
    key = f"{REDIS_KEY_PREFIX}{tenant_id}:{template_name}"
    redis_client.setex(key, REDIS_EXPIRY, app_id)


def _check_imported_by_name(*, session: Session, tenant_id: str, app_name: str) -> bool:
    """Fallback check: see if an app with this exact name already exists in the tenant."""
    stmt = (
        select(App.id)
        .where(
            App.tenant_id == tenant_id,
            App.name == app_name,
        )
        .limit(1)
    )
    return session.execute(stmt).first() is not None


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

    try:
        parsed = yaml.safe_load(yaml_content)
        app_name = parsed.get("app", {}).get("name", "") if isinstance(parsed, dict) else ""
    except Exception:
        app_name = ""

    if app_name and _check_imported_by_name(session=session, tenant_id=tenant_id, app_name=app_name):
        _mark_imported(tenant_id=tenant_id, template_name=template_name, app_id="exists")
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
        logger.info("AceDataCloud workflows: imported %s app_id=%s tenant=%s", template_name, result.app_id, tenant_id)
        return str(result.app_id) if result.app_id else None

    if result.status == ImportStatus.PENDING:
        confirm_result = dsl_service.confirm_import(import_id=result.id, account=account)
        if confirm_result.status in (ImportStatus.COMPLETED, ImportStatus.COMPLETED_WITH_WARNINGS):
            session.commit()
            _mark_imported(
                tenant_id=tenant_id, template_name=template_name, app_id=str(confirm_result.app_id or "")
            )
            logger.info(
                "AceDataCloud workflows: imported (confirmed) %s app_id=%s tenant=%s",
                template_name,
                confirm_result.app_id,
                tenant_id,
            )
            return str(confirm_result.app_id) if confirm_result.app_id else None
        session.rollback()
        logger.warning("AceDataCloud workflows: confirm failed %s status=%s", template_name, confirm_result.status)
        return None

    session.rollback()
    logger.warning("AceDataCloud workflows: import failed %s status=%s error=%s", template_name, result.status, result.error)
    return None


def _ensure_explore_apps(*, session: Session, account: Account, tenant_id: str, workflow_files: list[Path]) -> None:
    """Import workflows into the given tenant and register them in Explore.

    Idempotent: uses a Redis key to avoid re-running on every login.
    """
    if redis_client.exists(REDIS_EXPLORE_KEY):
        return

    logger.info("AceDataCloud workflows: setting up Explore apps in tenant=%s", tenant_id)

    for position, wf_file in enumerate(workflow_files):
        template_name = wf_file.stem

        # Try to import; returns app_id if newly created, None if already exists
        app_id = _import_single_workflow(
            session=session,
            account=account,
            tenant_id=tenant_id,
            wf_file=wf_file,
        )

        # If we didn't get an app_id from import, look up the existing one
        if not app_id:
            try:
                parsed = yaml.safe_load(wf_file.read_text(encoding="utf-8"))
                app_name = parsed.get("app", {}).get("name", "") if isinstance(parsed, dict) else ""
            except Exception:
                app_name = ""

            if app_name:
                existing = session.execute(
                    select(App.id).where(App.tenant_id == tenant_id, App.name == app_name).limit(1)
                ).scalar_one_or_none()
                if existing:
                    app_id = str(existing)

        if not app_id:
            logger.warning("AceDataCloud workflows: could not get app_id for %s, skipping Explore", template_name)
            continue

        # Check if already in Explore
        already_recommended = session.execute(
            select(RecommendedApp.id).where(RecommendedApp.app_id == app_id).limit(1)
        ).first()
        if already_recommended:
            continue

        # Mark app as public and add RecommendedApp
        app = session.get(App, app_id)
        if app:
            app.is_public = True
            try:
                parsed = yaml.safe_load(wf_file.read_text(encoding="utf-8"))
                description = parsed.get("app", {}).get("description", "") if isinstance(parsed, dict) else ""
            except Exception:
                description = ""

            recommended = RecommendedApp(
                app_id=app_id,
                description={"text": description},
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
            logger.info("AceDataCloud workflows: added %s to Explore (app_id=%s)", template_name, app_id)

    # Mark setup as done so we don't repeat on next login
    redis_client.setex(REDIS_EXPLORE_KEY, REDIS_EXPIRY, "1")
    logger.info("AceDataCloud workflows: Explore setup complete")


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
    is_new_user: bool = False,
) -> None:
    workflow_files = _get_workflow_files()
    if not workflow_files:
        logger.info("AceDataCloud workflows: no files found in %s", WORKFLOWS_DIR)
        return

    logger.info(
        "AceDataCloud workflows: found %d files. tenant=%s is_new_user=%s",
        len(workflow_files),
        tenant_id,
        is_new_user,
    )

    try:
        with Session(db.engine) as session:
            account: Account | None = session.get(Account, account_id)
            if not account:
                logger.error("AceDataCloud workflows: account not found. account_id=%s", account_id)
                return

            # 1) Always ensure Explore apps exist (idempotent, uses Redis guard)
            _ensure_explore_apps(
                session=session,
                account=account,
                tenant_id=tenant_id,
                workflow_files=workflow_files,
            )

            # 2) For new users only: import workflows into their personal workspace
            if is_new_user:
                imported = 0
                for wf_file in workflow_files:
                    app_id = _import_single_workflow(
                        session=session,
                        account=account,
                        tenant_id=tenant_id,
                        wf_file=wf_file,
                    )
                    if app_id:
                        imported += 1
                logger.info("AceDataCloud workflows: new user import done. tenant=%s imported=%d", tenant_id, imported)
            else:
                logger.info("AceDataCloud workflows: existing user, skip workspace import. tenant=%s", tenant_id)

    except Exception:
        logger.exception("AceDataCloud workflows: task failed. tenant=%s", tenant_id)
