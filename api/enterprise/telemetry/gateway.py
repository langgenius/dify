"""Telemetry gateway routing configuration.

This module defines the routing table that maps telemetry cases to their
processing routes (trace vs metric/log) and customer engagement eligibility.
"""

from __future__ import annotations

from enterprise.telemetry.contracts import CaseRoute, TelemetryCase

CASE_ROUTING: dict[TelemetryCase, CaseRoute] = {
    TelemetryCase.WORKFLOW_RUN: CaseRoute(signal_type="trace", ce_eligible=True),
    TelemetryCase.MESSAGE_RUN: CaseRoute(signal_type="trace", ce_eligible=True),
    TelemetryCase.NODE_EXECUTION: CaseRoute(signal_type="trace", ce_eligible=False),
    TelemetryCase.DRAFT_NODE_EXECUTION: CaseRoute(signal_type="trace", ce_eligible=False),
    TelemetryCase.PROMPT_GENERATION: CaseRoute(signal_type="trace", ce_eligible=False),
    TelemetryCase.APP_CREATED: CaseRoute(signal_type="metric_log", ce_eligible=False),
    TelemetryCase.APP_UPDATED: CaseRoute(signal_type="metric_log", ce_eligible=False),
    TelemetryCase.APP_DELETED: CaseRoute(signal_type="metric_log", ce_eligible=False),
    TelemetryCase.FEEDBACK_CREATED: CaseRoute(signal_type="metric_log", ce_eligible=False),
    TelemetryCase.TOOL_EXECUTION: CaseRoute(signal_type="metric_log", ce_eligible=False),
    TelemetryCase.MODERATION_CHECK: CaseRoute(signal_type="metric_log", ce_eligible=False),
    TelemetryCase.SUGGESTED_QUESTION: CaseRoute(signal_type="metric_log", ce_eligible=False),
    TelemetryCase.DATASET_RETRIEVAL: CaseRoute(signal_type="metric_log", ce_eligible=False),
    TelemetryCase.GENERATE_NAME: CaseRoute(signal_type="metric_log", ce_eligible=False),
}
