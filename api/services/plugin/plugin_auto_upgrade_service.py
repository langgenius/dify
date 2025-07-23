from sqlalchemy.orm import Session

from extensions.ext_database import db
from models.account import TenantPluginAutoUpgradeStrategy


class PluginAutoUpgradeService:
    @staticmethod
    def get_strategy(tenant_id: str) -> TenantPluginAutoUpgradeStrategy | None:
        with Session(db.engine) as session:
            return (
                session.query(TenantPluginAutoUpgradeStrategy)
                .filter(TenantPluginAutoUpgradeStrategy.tenant_id == tenant_id)
                .first()
            )

    @staticmethod
    def change_strategy(
        tenant_id: str,
        strategy_setting: TenantPluginAutoUpgradeStrategy.StrategySetting,
        upgrade_time_of_day: int,
        upgrade_mode: TenantPluginAutoUpgradeStrategy.UpgradeMode,
        exclude_plugins: list[str],
        include_plugins: list[str],
    ) -> None:
        with Session(db.engine) as session:
            exist_strategy = (
                session.query(TenantPluginAutoUpgradeStrategy)
                .filter(TenantPluginAutoUpgradeStrategy.tenant_id == tenant_id)
                .first()
            )
            if not exist_strategy:
                strategy = TenantPluginAutoUpgradeStrategy(
                    tenant_id=tenant_id,
                    strategy_setting=strategy_setting,
                    upgrade_time_of_day=upgrade_time_of_day,
                    upgrade_mode=upgrade_mode,
                    exclude_plugins=exclude_plugins,
                    include_plugins=include_plugins,
                )
                session.add(strategy)
            else:
                exist_strategy.strategy_setting = strategy_setting
                exist_strategy.upgrade_time_of_day = upgrade_time_of_day
                exist_strategy.upgrade_mode = upgrade_mode
                exist_strategy.exclude_plugins = exclude_plugins
                exist_strategy.include_plugins = include_plugins

            session.commit()
            return True
