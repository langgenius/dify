import time

import click

import app
from extensions.ext_database import db
from models.account import TenantPluginAutoUpgradeStrategy
from tasks.process_tenant_plugin_autoupgrade_check_task import process_tenant_plugin_autoupgrade_check_task

AUTO_UPGRADE_MINIMAL_CHECKING_INTERVAL = 15 * 60  # 15 minutes


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

    for strategy in strategies:
        process_tenant_plugin_autoupgrade_check_task.delay(
            strategy.tenant_id,
            strategy.strategy_setting,
            strategy.upgrade_time_of_day,
            strategy.upgrade_mode,
            strategy.exclude_plugins,
            strategy.include_plugins,
        )

    end_at = time.perf_counter()
    click.echo(
        click.style(
            f"Checked upgradable plugin success latency: {end_at - start_at}",
            fg="green",
        )
    )
