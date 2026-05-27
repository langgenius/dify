from __future__ import annotations

from collections import Counter

from services.data_migration.entities import ReportContext, ResourceReportItem


class MigrationReportService:
    """Render structured migration resource results into CLI-friendly summary lines."""

    def render(self, items: list[ResourceReportItem], *, context: ReportContext | None = None) -> list[str]:
        counts = Counter((item.resource_type.value, item.status) for item in items)
        lines = self._render_context(context)
        lines.extend(
            [
                f"{resource_type} {status}: {count}"
                for (resource_type, status), count in sorted(counts.items())
            ]
        )
        actionable_items = [
            item for item in items if item.status in {"dependency-only", "skipped", "unresolved"} and item.message
        ]
        for item in actionable_items:
            lines.append(f"{item.resource_type.value} {item.identifier}: {item.message}")
        return lines

    def _render_context(self, context: ReportContext | None) -> list[str]:
        if context is None:
            return []
        lines: list[str] = []
        if context.output_path:
            lines.append(f"output: {context.output_path}")
        if context.source_scope:
            lines.append(f"source scope: {context.source_scope}")
        if context.selected_app_count is not None:
            lines.append(f"selected apps: {context.selected_app_count}")
        if context.include_secrets is not None:
            lines.append(f"include secrets: {str(context.include_secrets).lower()}")
        if context.target_tenant:
            lines.append(f"target tenant: {context.target_tenant}")
        if context.operator_email:
            lines.append(f"operator: {context.operator_email}")
        if context.app_api_tokens_created or context.app_api_tokens_reused:
            lines.append(
                f"app api tokens: {context.app_api_tokens_created} created, "
                f"{context.app_api_tokens_reused} reused"
            )
        if context.id_mapping_count:
            lines.append(f"id mappings: {context.id_mapping_count}")
        return lines
