"""Select the Console CSV writer for a trusted server operator's export target."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Protocol, TextIO

from services.agent.observability_contracts import AgentLogExportFilters
from services.entities.conversation_entities import (
    ConsoleConversationLogFilters,
    ConsoleConversationScope,
    ConversationAnnotationStatus,
)
from services.retention.log_export_csv import CsvRowProgress
from services.retention.workflow_run.log_export_service import WorkflowLogExportFilters, WorkflowLogExportScope

if TYPE_CHECKING:
    from services.retention.agent.log_export_csv import AgentLogCsvWriter
    from services.retention.conversation.log_export_service import ConversationLogExportService


@dataclass(frozen=True, slots=True)
class AppLogExportTarget:
    """A live App and its owner, with a bound Agent ID for New Agent apps."""

    app_id: str
    tenant_id: str
    mode: str
    agent_id: str | None


class LogExportApps(Protocol):
    def get_log_export_target(self, app_id: str) -> AppLogExportTarget:
        """Resolve a live app for an operator, or raise if the target is unavailable."""
        ...


class WriteWorkflowLogCsv(Protocol):
    def __call__(
        self,
        *,
        scope: WorkflowLogExportScope,
        filters: WorkflowLogExportFilters,
        output: TextIO,
        report_rows: CsvRowProgress,
    ) -> int:
        """Write the resolved Workflow app's CSV to the stream and return its row count."""
        ...


@dataclass(frozen=True, slots=True)
class LogExportCommandFilters:
    """Use a validated UTC interval, with no lower bound when start is absent."""

    start: datetime | None
    end_before: datetime
    end_user_ids: tuple[str, ...]
    account_ids: tuple[str, ...]
    annotation_status: ConversationAnnotationStatus


class UnsupportedLogExportFilterError(ValueError):
    """The selected CSV writer cannot apply a requested filter."""


class LogExportCommandService:
    """Write logs to an operator-owned stream using the same queries as the Console."""

    def __init__(
        self,
        *,
        apps: LogExportApps,
        conversations: ConversationLogExportService,
        write_workflow_csv: WriteWorkflowLogCsv,
        agents: AgentLogCsvWriter,
    ) -> None:
        self._apps = apps
        self._conversations = conversations
        self._write_workflow_csv = write_workflow_csv
        self._agents = agents

    def write_app_csv(
        self, app_id: str, *, filters: LogExportCommandFilters, output: TextIO, report_rows: CsvRowProgress
    ) -> int:
        """Resolve an operator's App ID and write its export with validated UTC bounds.

        Require a writable UTF-8 stream. Report cumulative rows as they are written
        and return the final count, leaving publication to the caller.
        """
        target = self._apps.get_log_export_target(app_id)
        if target.agent_id is not None:
            return self._agents.write_scoped_csv(
                tenant_id=target.tenant_id,
                agent_id=target.agent_id,
                filters=self._agent_filters(filters),
                output=output,
                report_rows=report_rows,
            )

        # These two writers use an inclusive upper bound; the command uses an exclusive bound.
        end = filters.end_before - timedelta(microseconds=1)
        if target.mode == "workflow":
            if filters.annotation_status != "all":
                raise UnsupportedLogExportFilterError("--annotation-status applies only to conversation logs.")
            return self._write_workflow_csv(
                scope=WorkflowLogExportScope(tenant_id=target.tenant_id, app_id=target.app_id),
                filters=WorkflowLogExportFilters(
                    created_at_after=filters.start,
                    created_at_before=end,
                    end_user_ids=filters.end_user_ids,
                    account_ids=filters.account_ids,
                ),
                output=output,
                report_rows=report_rows,
            )

        return self._conversations.write_scoped_csv(
            scope=ConsoleConversationScope(
                app_id=target.app_id, tenant_id=target.tenant_id, app_mode=target.mode, timezone="UTC"
            ),
            filters=ConsoleConversationLogFilters(
                keyword=None,
                start=filters.start,
                end=end,
                annotation_status=filters.annotation_status,
                sort_by="-created_at",
                end_user_ids=filters.end_user_ids,
                account_ids=filters.account_ids,
            ),
            output=output,
            report_rows=report_rows,
        )

    def write_agent_csv(
        self, agent_id: str, *, filters: LogExportCommandFilters, output: TextIO, report_rows: CsvRowProgress
    ) -> int:
        """Write a trusted operator's Agent export with UTC bounds, reporting the cumulative row count."""
        return self._agents.write_agent_csv(
            agent_id, filters=self._agent_filters(filters), output=output, report_rows=report_rows
        )

    @staticmethod
    def _agent_filters(filters: LogExportCommandFilters) -> AgentLogExportFilters:
        """Translate common filters to all Agent sources, rejecting conversation-only filters."""
        if filters.annotation_status != "all":
            raise UnsupportedLogExportFilterError("--annotation-status applies only to conversation logs.")
        return AgentLogExportFilters(
            sources=(),
            start=filters.start,
            end=filters.end_before,
            end_user_ids=filters.end_user_ids,
            account_ids=filters.account_ids,
        )
