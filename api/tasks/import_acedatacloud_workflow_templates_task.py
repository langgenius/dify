import logging
from pathlib import Path

import yaml
from celery import shared_task
from sqlalchemy import select
from sqlalchemy.orm import Session

from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models import Account, App

logger = logging.getLogger(__name__)

WORKFLOWS_DIR = Path(__file__).resolve().parent.parent.parent / "workflows"
REDIS_KEY_PREFIX = "acedatacloud_workflow_imported:"
REDIS_EXPIRY = 365 * 24 * 3600  # 1 year


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
    workflow_files = _get_workflow_files()
    if not workflow_files:
        logger.info(
            "AceDataCloud workflows: no workflow files found in %s. tenant_id=%s",
            WORKFLOWS_DIR,
            tenant_id,
        )
        return

    logger.info(
        "AceDataCloud workflows: found %d workflow files. tenant_id=%s",
        len(workflow_files),
        tenant_id,
    )

    # Lazy import to avoid circular dependency at module level
    from services.app_dsl_service import AppDslService, ImportStatus

    imported_count = 0
    skipped_count = 0
    failed_count = 0

    for wf_file in workflow_files:
        template_name = wf_file.stem

        if _already_imported(tenant_id=tenant_id, template_name=template_name):
            logger.debug(
                "AceDataCloud workflows: already imported (redis), skip. tenant_id=%s template=%s",
                tenant_id,
                template_name,
            )
            skipped_count += 1
            continue

        yaml_content = wf_file.read_text(encoding="utf-8")
        if not yaml_content.strip():
            logger.warning(
                "AceDataCloud workflows: empty file, skip. tenant_id=%s template=%s",
                tenant_id,
                template_name,
            )
            skipped_count += 1
            continue

        # Parse app name for fallback duplicate check
        try:
            parsed = yaml.safe_load(yaml_content)
            app_name = parsed.get("app", {}).get("name", "") if isinstance(parsed, dict) else ""
        except Exception:
            app_name = ""

        try:
            with Session(db.engine) as session:
                if app_name and _check_imported_by_name(session=session, tenant_id=tenant_id, app_name=app_name):
                    logger.debug(
                        "AceDataCloud workflows: already exists by name, skip. tenant_id=%s template=%s name=%s",
                        tenant_id,
                        template_name,
                        app_name,
                    )
                    _mark_imported(tenant_id=tenant_id, template_name=template_name, app_id="exists")
                    skipped_count += 1
                    continue

                account: Account | None = session.get(Account, account_id)
                if not account:
                    logger.error(
                        "AceDataCloud workflows: account not found. account_id=%s",
                        account_id,
                    )
                    return

                account.current_tenant_id = tenant_id

                dsl_service = AppDslService(session)
                result = dsl_service.import_app(
                    account=account,
                    import_mode="yaml-content",
                    yaml_content=yaml_content,
                )

                if result.status == ImportStatus.COMPLETED or result.status == ImportStatus.COMPLETED_WITH_WARNINGS:
                    session.commit()
                    _mark_imported(
                        tenant_id=tenant_id, template_name=template_name, app_id=str(result.app_id or "")
                    )
                    imported_count += 1
                    logger.info(
                        "AceDataCloud workflows: imported. tenant_id=%s template=%s app_id=%s",
                        tenant_id,
                        template_name,
                        result.app_id,
                    )
                elif result.status == ImportStatus.PENDING:
                    confirm_result = dsl_service.confirm_import(
                        import_id=result.id,
                        account=account,
                    )
                    if confirm_result.status in (
                        ImportStatus.COMPLETED,
                        ImportStatus.COMPLETED_WITH_WARNINGS,
                    ):
                        session.commit()
                        _mark_imported(
                            tenant_id=tenant_id,
                            template_name=template_name,
                            app_id=str(confirm_result.app_id or ""),
                        )
                        imported_count += 1
                        logger.info(
                            "AceDataCloud workflows: imported (confirmed). tenant_id=%s template=%s app_id=%s",
                            tenant_id,
                            template_name,
                            confirm_result.app_id,
                        )
                    else:
                        session.rollback()
                        failed_count += 1
                        logger.warning(
                            "AceDataCloud workflows: confirm failed. tenant_id=%s template=%s status=%s error=%s",
                            tenant_id,
                            template_name,
                            confirm_result.status,
                            confirm_result.error,
                        )
                else:
                    session.rollback()
                    failed_count += 1
                    logger.warning(
                        "AceDataCloud workflows: import failed. tenant_id=%s template=%s status=%s error=%s",
                        tenant_id,
                        template_name,
                        result.status,
                        result.error,
                    )

        except Exception:
            failed_count += 1
            logger.exception(
                "AceDataCloud workflows: exception during import. tenant_id=%s template=%s",
                tenant_id,
                template_name,
            )

    logger.info(
        "AceDataCloud workflows: done. tenant_id=%s imported=%d skipped=%d failed=%d",
        tenant_id,
        imported_count,
        skipped_count,
        failed_count,
    )
