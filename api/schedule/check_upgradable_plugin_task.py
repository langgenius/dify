import math
import time

import click

import app
from extensions.ext_database import db
from models.account import TenantPluginAutoUpgradeStrategy
from tasks import process_tenant_plugin_autoupgrade_check_task as check_task

AUTO_UPGRADE_MINIMAL_CHECKING_INTERVAL = 15 * 60  # 15 minutes
MAX_CONCURRENT_CHECK_TASKS = 20


@app.celery.task(queue="plugin")
def check_upgradable_plugin_task():
    click.echo(click.style("Start check upgradable plugin.", fg="green"))
    start_at = time.perf_counter()

    now_seconds_of_day = time.time() % 86400 - 30  # we assume the tz is UTC
    click.echo(click.style(f"Now seconds of day: {now_seconds_of_day}", fg="green"))

    strategies = (
        db.session.query(TenantPluginAutoUpgradeStrategy)
        .where(
            TenantPluginAutoUpgradeStrategy.upgrade_time_of_day >= now_seconds_of_day,
            TenantPluginAutoUpgradeStrategy.upgrade_time_of_day
            < now_seconds_of_day + AUTO_UPGRADE_MINIMAL_CHECKING_INTERVAL,
            TenantPluginAutoUpgradeStrategy.strategy_setting
            != TenantPluginAutoUpgradeStrategy.StrategySetting.DISABLED,
        )
        .all()
    )

    total_strategies = len(strategies)
    click.echo(click.style(f"Total strategies: {total_strategies}", fg="green"))

    batch_chunk_count = math.ceil(
        total_strategies / MAX_CONCURRENT_CHECK_TASKS
    )  # make sure all strategies are checked in this interval
    batch_interval_time = (AUTO_UPGRADE_MINIMAL_CHECKING_INTERVAL / batch_chunk_count) if batch_chunk_count > 0 else 0

    for i in range(0, total_strategies, MAX_CONCURRENT_CHECK_TASKS):
        batch_strategies = strategies[i : i + MAX_CONCURRENT_CHECK_TASKS]
        for strategy in batch_strategies:
            check_task.process_tenant_plugin_autoupgrade_check_task.delay(
                strategy.tenant_id,
                strategy.strategy_setting,
                strategy.upgrade_time_of_day,
                strategy.upgrade_mode,
                strategy.exclude_plugins,
                strategy.include_plugins,
            )

        # Only sleep if batch_interval_time > 0.0001 AND current batch is not the last one
        if batch_interval_time > 0.0001 and i + MAX_CONCURRENT_CHECK_TASKS < total_strategies:
            time.sleep(batch_interval_time)

    end_at = time.perf_counter()
    click.echo(
        click.style(
            f"Checked upgradable plugin success latency: {end_at - start_at}",
            fg="green",
        )
    )
