from datetime import datetime

from commands.retrieval_weights import format_report
from domain.retrieval_weight_tuning.weight_recommendation import (
    InsufficientEvidence,
    RecommendWeightChange,
    WeightAnalysis,
)
from services.knowledge.retrieval.weight_recommendations import RetrievalWeightReport, TuningUnit, UnitRecommendation


def _unit(dataset_id: str | None) -> TuningUnit:
    return TuningUnit(
        node_id="knowledge",
        stage="dataset" if dataset_id else "cross_dataset",
        dataset_id=dataset_id,
        embedding_provider_name="provider",
        embedding_model_name="embedding",
    )


def test_report_states_each_verdict_and_that_nothing_was_applied() -> None:
    analysis = WeightAnalysis(
        liked_runs=40,
        disliked_runs=35,
        best_vector_weight=0.5,
        curve=((0.5, 0.2), (0.7, 0.0)),
        improvement=0.2,
        interval=(0.05, 0.31),
        stability=0.8,
        affected_share=0.25,
    )
    report = RetrievalWeightReport(
        app_id="app",
        window_start=datetime(2026, 9, 30),
        rated_runs=75,
        units=(
            UnitRecommendation(
                unit=_unit(None),
                current_vector_weight=0.7,
                weights_changed_in_window=True,
                recommendation=RecommendWeightChange(
                    current_vector_weight=0.7, recommended_vector_weight=0.5, analysis=analysis
                ),
            ),
            UnitRecommendation(
                unit=_unit("ds-1"),
                current_vector_weight=0.7,
                weights_changed_in_window=False,
                recommendation=InsufficientEvidence(liked_runs=3, disliked_runs=1, required_per_rating=30),
            ),
        ),
    )

    text = format_report(report)

    assert "Advisory only; no weights were changed." in text
    assert "cross-dataset merge" in text
    assert "(weights changed during the window)" in text
    assert "Recommend vector weight 0.50 (keyword 0.50)." in text
    assert "improvement +0.200 [+0.050, +0.310], stability 80%" in text
    assert "Not enough evidence: 3 liked / 1 disliked runs, need 30 of each." in text


def test_report_explains_an_empty_result() -> None:
    report = RetrievalWeightReport(app_id="app", window_start=datetime(2026, 9, 30), rated_runs=0, units=())

    assert "RETRIEVAL_WEIGHT_TRACE_ENABLED" in format_report(report)
