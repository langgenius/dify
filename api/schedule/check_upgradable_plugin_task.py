import logging
import math
import time
from datetime import UTC, datetime

import click
from celery import Task, shared_task
from kombu.exceptions import OperationalError
from redis import RedisError
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.helper.marketplace import fetch_global_plugin_manifest
from extensions.ext_database import db
from models.account import TenantPluginAutoUpgradeStrategy, TenantPluginAutoUpgradeStrategySetting
from tasks import process_tenant_plugin_autoupgrade_check_task as check_task
from tasks.plugin_autoupgrade_coordination import MAX_CONCURRENT_CHECK_TASKS, get_upgrade_check_coordinator

logger = logging.getLogger(__name__)

AUTO_UPGRADE_MINIMAL_CHECKING_INTERVAL = 15 * 60  # 15 minutes
DISPATCH_BATCH_SIZE = MAX_CONCURRENT_CHECK_TASKS
SCHEDULE_ANCHOR_HEADER = "plugin_autoupgrade_scheduled_at"

# Import cache constants from the task module
CACHE_REDIS_KEY_PREFIX = check_task.CACHE_REDIS_KEY_PREFIX
CACHE_REDIS_TTL = check_task.CACHE_REDIS_TTL


@shared_task(
    bind=True, queue="plugin", max_retries=3, default_retry_delay=30, acks_late=True, reject_on_worker_lost=True
)
def check_upgradable_plugin_task(self: Task) -> None:
    """Dispatch the scheduled window once per strategy, preserving its original anchor on retry.

    Preconditions: Beat supplies no arguments; retries retain their scheduling timestamp in a header.
    Postconditions: one logical check executes once, even if ambiguous publication replays
    the same reservation. Dispatch time is included in the interval budget. Redis/broker
    failures retry the same window; other errors propagate. Child execution is globally bounded.
    """
    headers = dict(self.request.headers or {})
    anchor = float(headers.get(SCHEDULE_ANCHOR_HEADER, time.time()))
    try:
        if self.request.id is not None:
            anchor = get_upgrade_check_coordinator().schedule_anchor(self.request.id, anchor)
        _dispatch_upgrade_checks(anchor, producer_id=self.request.id)
    except (RedisError, OperationalError) as exc:
        headers[SCHEDULE_ANCHOR_HEADER] = anchor
        raise self.retry(exc=exc, headers=headers) from exc


def _dispatch_upgrade_checks(scheduled_at: float, producer_id: str | None = None) -> None:
    """Read one anchored window and publish its eligible checks at absolute deadlines.

    Preconditions: scheduled_at is the original Unix timestamp of this Beat invocation.
    Postconditions: no database transaction spans marketplace I/O or publication, and the
    producer never sleeps between batches; later batches are published with a countdown.
    A publish failure cancels only its own pending reservation and propagates, allowing
    the caller to retry without redoing completed or already queued strategies.
    """
    click.echo(click.style("Start check upgradable plugin.", fg="green"))
    start_at = time.perf_counter()

    now_seconds_of_day = scheduled_at % 86400 - 30  # we assume the tz is UTC
    click.echo(click.style(f"Now seconds of day: {now_seconds_of_day}", fg="green"))

    with Session(db.engine) as session:
        strategies = session.scalars(
            select(TenantPluginAutoUpgradeStrategy).where(
                TenantPluginAutoUpgradeStrategy.upgrade_time_of_day >= now_seconds_of_day,
                TenantPluginAutoUpgradeStrategy.upgrade_time_of_day
                < now_seconds_of_day + AUTO_UPGRADE_MINIMAL_CHECKING_INTERVAL,
                TenantPluginAutoUpgradeStrategy.strategy_setting != TenantPluginAutoUpgradeStrategySetting.DISABLED,
            )
        ).all()

    total_strategies = len(strategies)
    click.echo(click.style(f"Total strategies: {total_strategies}", fg="green"))

    batch_chunk_count = math.ceil(
        total_strategies / DISPATCH_BATCH_SIZE
    )  # make sure all strategies are checked in this interval
    batch_interval_time = (AUTO_UPGRADE_MINIMAL_CHECKING_INTERVAL / batch_chunk_count) if batch_chunk_count > 0 else 0

    if total_strategies == 0:
        click.echo(click.style("no strategies to process, skipping plugin manifest fetch.", fg="green"))
        return

    # Fetch and cache all plugin manifests before processing tenants
    # This reduces load on marketplace from 300k requests to 1 request per check cycle
    logger.info("fetching global plugin manifest from marketplace")
    try:
        cached_count = fetch_global_plugin_manifest(CACHE_REDIS_KEY_PREFIX, CACHE_REDIS_TTL)
    except Exception as e:
        # The marketplace is unreachable, so the per-plugin fallback would fail as well.
        # Skip this cycle instead of issuing one doomed request per tenant.
        logger.exception("failed to fetch global plugin manifest")
        click.echo(click.style(f"failed to fetch global plugin manifest: {e}", fg="red"))
        click.echo(click.style("skipping plugin upgrade check for this cycle", fg="yellow"))
        return

    if cached_count == 0:
        # The snapshot was served but carries no plugins. The marketplace itself is reachable,
        # so let the per-tenant tasks fall back to the batch API rather than upgrading nothing.
        logger.warning("global plugin manifest contained no plugins; falling back to per-plugin marketplace lookups")
        click.echo(click.style("global plugin manifest is empty, falling back to batch lookups", fg="yellow"))
    else:
        logger.info("successfully fetched and cached %d plugin manifests", cached_count)

    coordinator = get_upgrade_check_coordinator()
    for batch_index, i in enumerate(range(0, total_strategies, DISPATCH_BATCH_SIZE), start=1):
        batch_strategies = strategies[i : i + DISPATCH_BATCH_SIZE]
        # Preserve absolute batch pacing without holding a worker execution slot during
        # the interval. Celery owns the delayed delivery, including redelivery, and
        # publishing time consumes the budget instead of being added to every delay.
        batch_target = start_at + (batch_index - 1) * batch_interval_time
        for strategy in batch_strategies:
            reservation = coordinator.reserve(
                tenant_id=strategy.tenant_id,
                category=strategy.category.value,
                upgrade_time_of_day=strategy.upgrade_time_of_day,
                scheduled_at=scheduled_at,
                producer_id=producer_id,
            )
            if reservation is not None:
                try:
                    check_task.process_tenant_plugin_autoupgrade_check_task.apply_async(
                        args=(
                            strategy.tenant_id,
                            strategy.strategy_setting,
                            strategy.upgrade_time_of_day,
                            strategy.upgrade_mode,
                            strategy.exclude_plugins,
                            strategy.include_plugins,
                            strategy.category,
                        ),
                        headers={check_task.COORDINATION_HEADER: reservation.model_dump_json()},
                        expires=datetime.fromtimestamp(reservation.deadline, UTC),
                        countdown=max(0.0, batch_target - time.perf_counter()),
                    )
                except Exception:
                    try:
                        coordinator.cancel(reservation)
                    except RedisError:
                        logger.exception("failed to cancel plugin check reservation for tenant %s", strategy.tenant_id)
                    raise
                coordinator.mark_queued(reservation)

    end_at = time.perf_counter()
    click.echo(
        click.style(
            f"Checked upgradable plugin success latency: {end_at - start_at}",
            fg="green",
        )
    )
