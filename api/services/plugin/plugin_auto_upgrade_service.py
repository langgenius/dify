"""Manage tenant plugin auto-upgrade strategies.

The storage is category-scoped: each tenant can have one strategy per plugin
category. Public mutation helpers require an explicit category so callers do
not accidentally overwrite every plugin type with one workspace-level policy.
"""

import logging
from dataclasses import dataclass
from hashlib import sha256

from sqlalchemy import select
from sqlalchemy.orm import Session, scoped_session

from core.plugin.impl.plugin import PluginInstaller
from models.account import TenantPluginAutoUpgradeStrategy

logger = logging.getLogger(__name__)

PluginCategory = TenantPluginAutoUpgradeStrategy.PluginCategory
PLUGIN_CATEGORIES = tuple(PluginCategory)
SECONDS_PER_DAY = 24 * 60 * 60
AUTO_UPGRADE_CHECK_SLOT_SECONDS = 15 * 60
AUTO_UPGRADE_CHECK_SLOT_COUNT = SECONDS_PER_DAY // AUTO_UPGRADE_CHECK_SLOT_SECONDS


@dataclass(frozen=True)
class PluginAutoUpgradeBackfillResult:
    created_count: int
    normalized: bool


class PluginAutoUpgradeService:
    @staticmethod
    def default_strategy_setting_for_category(
        category: PluginCategory,
    ) -> TenantPluginAutoUpgradeStrategy.StrategySetting:
        if category == PluginCategory.MODEL:
            return TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST
        return TenantPluginAutoUpgradeStrategy.StrategySetting.FIX_ONLY

    @staticmethod
    def default_upgrade_time_of_day(tenant_id: str) -> int:
        """Spread default checks across 15-minute aligned slots by tenant."""
        hash_input = tenant_id.encode()
        slot = int.from_bytes(sha256(hash_input).digest()[:8], "big") % AUTO_UPGRADE_CHECK_SLOT_COUNT
        return slot * AUTO_UPGRADE_CHECK_SLOT_SECONDS

    @staticmethod
    def _coerce_category(category: object) -> PluginCategory | None:
        """Accept daemon enum/string categories and ignore unknown values."""
        category_value = getattr(category, "value", category)
        if category_value is None:
            return None

        try:
            return PluginCategory(str(category_value))
        except ValueError:
            return None

    @staticmethod
    def _get_installed_plugin_categories(tenant_id: str) -> dict[str, PluginCategory]:
        """Build a plugin_id -> category map for splitting legacy include/exclude lists."""
        installed_plugins = PluginInstaller().list_plugins(tenant_id)
        plugin_categories: dict[str, PluginCategory] = {}

        for plugin in installed_plugins:
            plugin_category = PluginAutoUpgradeService._coerce_category(plugin.declaration.category)
            if plugin_category is not None:
                plugin_categories[plugin.plugin_id] = plugin_category

        return plugin_categories

    @staticmethod
    def _filter_plugin_ids_for_category(
        plugin_ids: list[str],
        category: PluginCategory,
        plugin_categories: dict[str, PluginCategory],
    ) -> list[str]:
        return [plugin_id for plugin_id in plugin_ids if plugin_categories.get(plugin_id) == category]

    @staticmethod
    def _log_unknown_plugin_ids(
        tenant_id: str,
        field_name: str,
        plugin_ids: list[str],
        plugin_categories: dict[str, PluginCategory],
    ) -> None:
        unknown_plugin_ids = [plugin_id for plugin_id in plugin_ids if plugin_id not in plugin_categories]
        if not unknown_plugin_ids:
            return

        logger.warning(
            "Skipped unknown plugin IDs while backfilling plugin auto-upgrade strategies: "
            "tenant_id=%s, field=%s, plugin_ids=%s",
            tenant_id,
            field_name,
            unknown_plugin_ids,
        )

    @staticmethod
    def _has_default_strategy(strategy: TenantPluginAutoUpgradeStrategy) -> bool:
        return (
            strategy.strategy_setting == TenantPluginAutoUpgradeStrategy.StrategySetting.FIX_ONLY
            and strategy.upgrade_time_of_day == 0
            and strategy.upgrade_mode == TenantPluginAutoUpgradeStrategy.UpgradeMode.EXCLUDE
            and not strategy.exclude_plugins
            and not strategy.include_plugins
        )

    @staticmethod
    def _strategy_setting_for_category(
        source_strategy: TenantPluginAutoUpgradeStrategy,
        category: PluginCategory,
        source_has_default_strategy: bool,
    ) -> TenantPluginAutoUpgradeStrategy.StrategySetting:
        # Only pure legacy defaults adopt the new model=latest default. User-edited
        # strategies keep their original setting across all categories.
        if source_has_default_strategy:
            return PluginAutoUpgradeService.default_strategy_setting_for_category(category)
        return source_strategy.strategy_setting

    @staticmethod
    def _upgrade_time_of_day_for_category(
        tenant_id: str,
        source_strategy: TenantPluginAutoUpgradeStrategy,
        source_has_default_strategy: bool,
    ) -> int:
        # Pure legacy defaults are spread by tenant so all default rows do not
        # concentrate in the same scheduler window. User-edited schedules keep their time.
        if source_has_default_strategy:
            return PluginAutoUpgradeService.default_upgrade_time_of_day(tenant_id)
        return source_strategy.upgrade_time_of_day

    @staticmethod
    def backfill_strategy_categories(
        tenant_id: str,
        *,
        session: scoped_session | Session,
    ) -> PluginAutoUpgradeBackfillResult:
        """Create missing category strategies and split include/exclude lists when needed.

        The historical row is treated as the workspace-level source strategy.
        New category rows copy it first, then plugin lists are narrowed by real
        plugin category when the source strategy contains include/exclude IDs.
        """
        strategies = list(
            session.scalars(
                select(TenantPluginAutoUpgradeStrategy).where(TenantPluginAutoUpgradeStrategy.tenant_id == tenant_id)
            ).all()
        )
        if not strategies:
            return PluginAutoUpgradeBackfillResult(created_count=0, normalized=False)

        # Schema migration marks the historical workspace-level row as tool.
        source_strategy = next(
            (strategy for strategy in strategies if strategy.category == PluginCategory.TOOL),
            strategies[0],
        )
        source_has_default_strategy = PluginAutoUpgradeService._has_default_strategy(source_strategy)
        strategies_by_category = {strategy.category: strategy for strategy in strategies}
        exclude_plugins = source_strategy.exclude_plugins
        include_plugins = source_strategy.include_plugins
        should_split_plugin_lists = bool(exclude_plugins or include_plugins)
        # Query daemon only for tenants that actually customized plugin lists.
        plugin_categories = (
            PluginAutoUpgradeService._get_installed_plugin_categories(tenant_id) if should_split_plugin_lists else {}
        )
        if should_split_plugin_lists:
            PluginAutoUpgradeService._log_unknown_plugin_ids(
                tenant_id,
                "exclude_plugins",
                exclude_plugins,
                plugin_categories,
            )
            PluginAutoUpgradeService._log_unknown_plugin_ids(
                tenant_id,
                "include_plugins",
                include_plugins,
                plugin_categories,
            )

        created_count = 0
        for category in PLUGIN_CATEGORIES:
            strategy = strategies_by_category.get(category)
            if strategy is None:
                # Start from the legacy workspace-level behavior before narrowing lists.
                strategy = TenantPluginAutoUpgradeStrategy(
                    tenant_id=tenant_id,
                    category=category,
                    strategy_setting=PluginAutoUpgradeService._strategy_setting_for_category(
                        source_strategy, category, source_has_default_strategy
                    ),
                    upgrade_time_of_day=PluginAutoUpgradeService._upgrade_time_of_day_for_category(
                        tenant_id, source_strategy, source_has_default_strategy
                    ),
                    upgrade_mode=source_strategy.upgrade_mode,
                    exclude_plugins=source_strategy.exclude_plugins.copy(),
                    include_plugins=source_strategy.include_plugins.copy(),
                )
                session.add(strategy)
                created_count += 1
            elif source_has_default_strategy:
                strategy.strategy_setting = PluginAutoUpgradeService.default_strategy_setting_for_category(
                    strategy.category
                )
                strategy.upgrade_time_of_day = PluginAutoUpgradeService.default_upgrade_time_of_day(tenant_id)

            if not should_split_plugin_lists:
                continue

            # Narrow include/exclude lists to the current category after all rows exist.
            strategy.exclude_plugins = PluginAutoUpgradeService._filter_plugin_ids_for_category(
                exclude_plugins,
                strategy.category,
                plugin_categories,
            )
            strategy.include_plugins = PluginAutoUpgradeService._filter_plugin_ids_for_category(
                include_plugins,
                strategy.category,
                plugin_categories,
            )

        session.commit()
        return PluginAutoUpgradeBackfillResult(created_count=created_count, normalized=should_split_plugin_lists)

    @staticmethod
    def _get_strategy(
        session: scoped_session | Session,
        tenant_id: str,
        category: PluginCategory,
    ) -> TenantPluginAutoUpgradeStrategy | None:
        return session.scalar(
            select(TenantPluginAutoUpgradeStrategy)
            .where(
                TenantPluginAutoUpgradeStrategy.tenant_id == tenant_id,
                TenantPluginAutoUpgradeStrategy.category == category,
            )
            .limit(1)
        )

    @staticmethod
    def get_strategy(
        tenant_id: str,
        category: PluginCategory,
        *,
        session: scoped_session | Session,
    ) -> TenantPluginAutoUpgradeStrategy | None:
        return PluginAutoUpgradeService._get_strategy(session, tenant_id, category)

    @staticmethod
    def get_strategies(tenant_id: str, *, session: scoped_session | Session) -> list[TenantPluginAutoUpgradeStrategy]:
        return list(
            session.scalars(
                select(TenantPluginAutoUpgradeStrategy).where(TenantPluginAutoUpgradeStrategy.tenant_id == tenant_id)
            ).all()
        )

    @staticmethod
    def _change_strategy(
        session: scoped_session | Session,
        tenant_id: str,
        category: PluginCategory,
        strategy_setting: TenantPluginAutoUpgradeStrategy.StrategySetting,
        upgrade_time_of_day: int,
        upgrade_mode: TenantPluginAutoUpgradeStrategy.UpgradeMode,
        exclude_plugins: list[str],
        include_plugins: list[str],
    ) -> None:
        exist_strategy = PluginAutoUpgradeService._get_strategy(session, tenant_id, category)
        if not exist_strategy:
            strategy = TenantPluginAutoUpgradeStrategy(
                tenant_id=tenant_id,
                category=category,
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

    @staticmethod
    def change_strategy(
        tenant_id: str,
        strategy_setting: TenantPluginAutoUpgradeStrategy.StrategySetting,
        upgrade_time_of_day: int,
        upgrade_mode: TenantPluginAutoUpgradeStrategy.UpgradeMode,
        exclude_plugins: list[str],
        include_plugins: list[str],
        category: PluginCategory,
        *,
        session: scoped_session | Session,
    ) -> bool:
        PluginAutoUpgradeService._change_strategy(
            session,
            tenant_id=tenant_id,
            category=category,
            strategy_setting=strategy_setting,
            upgrade_time_of_day=upgrade_time_of_day,
            upgrade_mode=upgrade_mode,
            exclude_plugins=exclude_plugins,
            include_plugins=include_plugins,
        )

        session.commit()
        return True

    @staticmethod
    def _exclude_plugin(
        session: scoped_session | Session,
        tenant_id: str,
        category: PluginCategory,
        plugin_id: str,
    ) -> None:
        """Remove one plugin from automatic updates for a single category strategy."""
        exist_strategy = PluginAutoUpgradeService._get_strategy(session, tenant_id, category)
        if not exist_strategy:
            PluginAutoUpgradeService._change_strategy(
                session,
                tenant_id,
                category,
                TenantPluginAutoUpgradeStrategy.StrategySetting.FIX_ONLY,
                0,
                TenantPluginAutoUpgradeStrategy.UpgradeMode.EXCLUDE,
                [plugin_id],
                [],
            )
        else:
            if exist_strategy.upgrade_mode == TenantPluginAutoUpgradeStrategy.UpgradeMode.EXCLUDE:
                # In exclude mode, disabling one plugin means adding it to exclude_plugins.
                if plugin_id not in exist_strategy.exclude_plugins:
                    new_exclude_plugins = exist_strategy.exclude_plugins.copy()
                    new_exclude_plugins.append(plugin_id)
                    exist_strategy.exclude_plugins = new_exclude_plugins
            elif exist_strategy.upgrade_mode == TenantPluginAutoUpgradeStrategy.UpgradeMode.PARTIAL:
                # In partial mode, disabling one plugin means removing it from include_plugins.
                if plugin_id in exist_strategy.include_plugins:
                    new_include_plugins = exist_strategy.include_plugins.copy()
                    new_include_plugins.remove(plugin_id)
                    exist_strategy.include_plugins = new_include_plugins
            elif exist_strategy.upgrade_mode == TenantPluginAutoUpgradeStrategy.UpgradeMode.ALL:
                # In all mode, switch to exclude mode so only this plugin is skipped.
                exist_strategy.upgrade_mode = TenantPluginAutoUpgradeStrategy.UpgradeMode.EXCLUDE
                exist_strategy.exclude_plugins = [plugin_id]

    @staticmethod
    def exclude_plugin(
        tenant_id: str,
        plugin_id: str,
        category: PluginCategory,
        *,
        session: scoped_session | Session,
    ) -> bool:
        PluginAutoUpgradeService._exclude_plugin(
            session,
            tenant_id,
            category,
            plugin_id,
        )

        session.commit()
        return True
