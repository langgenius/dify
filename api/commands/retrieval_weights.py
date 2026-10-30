"""Operator report of recommend-only keyword/vector weight tuning for one app."""

import json
from dataclasses import asdict

import click

from core.db.session_factory import get_session_maker
from domain.retrieval_weight_tuning.weight_recommendation import (
    InsufficientEvidence,
    KeepCurrentWeight,
    RecommendWeightChange,
    WeightAnalysis,
    WeightRecommendation,
)
from extensions.application_services.retrieval_weight_traces import build_retrieval_weight_recommendation_service
from services.knowledge.retrieval.weight_recommendations import (
    RecommendationAppNotFoundError,
    RetrievalWeightReport,
    UnitRecommendation,
)


@click.command("retrieval-weight-report", help="Recommend keyword/vector weights for an app from message feedback.")
@click.option("--tenant-id", required=True, help="Workspace that owns the app.")
@click.option("--app-id", required=True, help="Chatflow app to analyse.")
@click.option("--json", "as_json", is_flag=True, default=False, help="Print the report as JSON.")
def retrieval_weight_report(tenant_id: str, app_id: str, as_json: bool) -> None:
    try:
        report = build_retrieval_weight_recommendation_service(database_client=get_session_maker()).recommend(
            tenant_id=tenant_id, app_id=app_id
        )
    except RecommendationAppNotFoundError as error:
        raise click.ClickException(str(error)) from error
    click.echo(json.dumps(asdict(report), default=str, indent=2) if as_json else format_report(report))


def format_report(report: RetrievalWeightReport) -> str:
    """Render the report for a terminal. Advisory only: nothing is applied."""
    header = [
        f"App {report.app_id}: {report.rated_runs} rated runs since {report.window_start:%Y-%m-%d} (UTC).",
        "Advisory only; no weights were changed.",
    ]
    body = [line for unit in report.units for line in _format_unit(unit)] or [
        "No weighted-score traces for rated runs. Is RETRIEVAL_WEIGHT_TRACE_ENABLED on?"
    ]
    return "\n".join([*header, "", *body])


def _format_unit(entry: UnitRecommendation) -> list[str]:
    unit = entry.unit
    scope = f"dataset {unit.dataset_id}" if unit.dataset_id else "cross-dataset merge"
    title = (
        f"Node {unit.node_id}, {scope} "
        f"({unit.embedding_provider_name}/{unit.embedding_model_name}), "
        f"current vector weight {entry.current_vector_weight:.2f}"
        + (" (weights changed during the window)" if entry.weights_changed_in_window else "")
    )
    return [title, *_format_verdict(entry.recommendation), ""]


def _format_verdict(recommendation: WeightRecommendation) -> list[str]:
    match recommendation:
        case InsufficientEvidence(liked_runs=liked, disliked_runs=disliked, required_per_rating=required):
            return [f"  Not enough evidence: {liked} liked / {disliked} disliked runs, need {required} of each."]
        case KeepCurrentWeight(analysis=analysis):
            return ["  Keep current weight.", _format_analysis(analysis)]
        case RecommendWeightChange(recommended_vector_weight=weight, analysis=analysis):
            return [
                f"  Recommend vector weight {weight:.2f} (keyword {1 - weight:.2f}).",
                _format_analysis(analysis),
            ]


def _format_analysis(analysis: WeightAnalysis) -> str:
    low, high = analysis.interval
    return (
        f"  Best weight {analysis.best_vector_weight:.2f}: improvement {analysis.improvement:+.3f} "
        f"[{low:+.3f}, {high:+.3f}], stability {analysis.stability:.0%}, "
        f"changes results for {analysis.affected_share:.0%} of rated runs "
        f"({analysis.liked_runs} liked / {analysis.disliked_runs} disliked)."
    )
