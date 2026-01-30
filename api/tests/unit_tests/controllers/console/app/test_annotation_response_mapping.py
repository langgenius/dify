from types import SimpleNamespace

from controllers.console.app import annotation as annotation_controller


def test_annotation_to_response_maps_content_to_answer():
    annotation = SimpleNamespace(
        id="ann-1",
        question="Q",
        content="A",
        hit_count=3,
        created_at=1700000000,
    )

    result = annotation_controller._annotation_to_response(annotation)

    assert result.model_dump() == {
        "id": "ann-1",
        "question": "Q",
        "answer": "A",
        "hit_count": 3,
        "created_at": 1700000000,
    }


def test_hit_history_to_response_maps_match_and_response_fields():
    hit = SimpleNamespace(
        id="hit-1",
        source="source",
        score=0.75,
        question="user question",
        created_at=1700000000,
        annotation_question="matched question",
        annotation_content="matched content",
    )

    result = annotation_controller._hit_history_to_response(hit)

    assert result.model_dump() == {
        "id": "hit-1",
        "source": "source",
        "score": 0.75,
        "question": "user question",
        "created_at": 1700000000,
        "match": "matched question",
        "response": "matched content",
    }


def test_annotation_setting_response_excludes_none_fields():
    model = annotation_controller.AnnotationSettingResponse.model_validate({"enabled": False})
    assert model.model_dump() == {"enabled": False}


def test_job_status_response_excludes_error_msg_when_none():
    model = annotation_controller.AnnotationJobStatusResponse(job_id="job-1", job_status="waiting")
    assert model.model_dump() == {"job_id": "job-1", "job_status": "waiting"}


def test_annotation_setting_response_excludes_embedding_model_when_none():
    model = annotation_controller.AnnotationSettingResponse.model_validate(
        {
            "enabled": True,
            "id": "setting-1",
            "score_threshold": 0.5,
            "embedding_model": None,
        }
    )
    assert model.model_dump() == {"enabled": True, "id": "setting-1", "score_threshold": 0.5}


def test_response_model_prunes_none_recursively():
    class Dummy(annotation_controller.ResponseModel):
        payload: dict[str, object]

    model = Dummy(payload={"a": 1, "b": None, "c": {"d": None, "e": 2}, "f": [None, 3]})
    assert model.model_dump() == {"payload": {"a": 1, "c": {"e": 2}, "f": [None, 3]}}
