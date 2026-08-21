import json
import threading
from concurrent.futures import ThreadPoolExecutor
from types import TracebackType
from unittest.mock import call, patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from configs import dify_config
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.models.document import AttachmentDocument, ChildDocument, Document
from enums import CloudPlan, DeploymentEdition
from models.dataset import Dataset
from services.vector_space_admission_service import (
    VECTOR_SPACE_ADMISSION_ERROR_CODE,
    VectorSpaceAdmissionError,
    VectorSpaceAdmissionService,
    VectorStorageWorkload,
    build_document_workload,
    build_pipeline_workload,
    estimate_tidb_storage_bytes,
    format_vector_space_admission_error,
    get_vector_space_admission_error_fields,
    parse_vector_space_estimate_limits,
)

_MEBIBYTE = 1024 * 1024
_ESTIMATE_LIMITS = "sandbox:60,professional:6400,team:25600"


class _FakeRedisLock:
    def __init__(self, lock: threading.Lock) -> None:
        self._lock = lock

    def __enter__(self) -> "_FakeRedisLock":
        self._lock.acquire()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self._lock.release()


class _FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.ttls: dict[str, int] = {}
        self._locks: dict[str, threading.Lock] = {}

    def lock(self, key: str, **_kwargs: object) -> _FakeRedisLock:
        return _FakeRedisLock(self._locks.setdefault(key, threading.Lock()))

    def get(self, key: str) -> str | None:
        return self.values.get(key)

    def setex(self, key: str, ttl: int, value: str) -> None:
        self.values[key] = value
        self.ttls[key] = ttl


def _dataset(session: Session) -> Dataset:
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id="tenant-1",
        name="Dataset",
        created_by=str(uuid4()),
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        embedding_model_provider="provider",
        embedding_model="model",
        index_struct=json.dumps({"type": VectorType.TIDB_ON_QDRANT}),
    )
    session.add(dataset)
    session.flush()
    return dataset


def _workload() -> VectorStorageWorkload:
    return VectorStorageWorkload(text_points=1, summary_points=0, probe_text="probe")


def _check_estimate(
    session: Session,
    plan: CloudPlan,
    estimated_mb: float,
    *,
    usage_mb: float = 0,
    plan_limit_mb: int = 50,
    service: VectorSpaceAdmissionService | None = None,
    document_id: str = "document-1",
    redis: _FakeRedis | None = None,
) -> VectorSpaceAdmissionService:
    service = service or VectorSpaceAdmissionService()
    redis = redis or _FakeRedis()
    with (
        patch.object(service, "_get_plan", return_value=plan),
        patch.object(service, "_get_embedding_dimension", return_value=3072),
        patch.object(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
        patch(
            "services.vector_space_admission_service.dify_config.TIDB_ON_QDRANT_ESTIMATED_STORAGE_LIMITS_MB",
            _ESTIMATE_LIMITS,
        ),
        patch(
            "services.vector_space_admission_service.Vector.resolve_vector_type",
            return_value=VectorType.TIDB_ON_QDRANT,
        ),
        patch(
            "services.vector_space_admission_service.estimate_tidb_storage_bytes",
            return_value=estimated_mb * _MEBIBYTE,
        ),
        patch(
            "services.vector_space_admission_service.BillingService.get_vector_space",
            return_value={"size": usage_mb, "limit": plan_limit_mb},
        ),
        patch("services.vector_space_admission_service.redis_client", redis),
    ):
        service._ensure_can_write(
            dataset=_dataset(session),
            document_id=document_id,
            workload=_workload(),
            session=session,
        )
    return service


def test_estimate_tidb_storage_bytes_counts_both_vector_copies_and_point_overhead() -> None:
    assert estimate_tidb_storage_bytes(point_count=10, dimension=1536) == 10 * (1536 * 4 * 2 + 3584)


def test_parse_vector_space_estimate_limits_supports_all_plans() -> None:
    assert parse_vector_space_estimate_limits("sandbox:1,professional:2,team:3") == {
        CloudPlan.SANDBOX: 1,
        CloudPlan.PROFESSIONAL: 2,
        CloudPlan.TEAM: 3,
    }


@pytest.mark.parametrize(
    "value",
    [
        "",
        "sandbox",
        "sandbox:60",
        "unknown:60",
        "sandbox:not-a-number",
        "sandbox:0",
        "sandbox:-1",
        "sandbox:1,pro:2,team:3",
        "pro:6400,professional:6401",
    ],
)
def test_parse_vector_space_estimate_limits_rejects_invalid_values(value: str) -> None:
    with pytest.raises(ValueError, match="Invalid vector-space estimate limit"):
        parse_vector_space_estimate_limits(value)


def test_vector_space_admission_error_fields() -> None:
    message = format_vector_space_admission_error(61, 50)

    assert get_vector_space_admission_error_fields(message) == {
        "error_code": VECTOR_SPACE_ADMISSION_ERROR_CODE,
        "estimated_vector_space_mb": 61,
        "vector_space_limit_mb": 50,
    }
    assert get_vector_space_admission_error_fields("another indexing error") == {
        "error_code": None,
        "estimated_vector_space_mb": None,
        "vector_space_limit_mb": None,
    }


def test_workloads_ignore_images_and_attachments() -> None:
    document_workload = build_document_workload(
        IndexStructureType.PARAGRAPH_INDEX,
        [
            Document(
                page_content="text",
                attachments=[AttachmentDocument(page_content="image", metadata={"doc_id": "file-1"})],
            )
        ],
        include_summaries=False,
    )
    pipeline_workload = build_pipeline_workload(
        IndexStructureType.PARAGRAPH_INDEX,
        {
            "general_chunks": [
                {
                    "content": "text ![image](/files/file-1/file-preview)",
                    "files": [{"id": "file-1"}],
                }
            ]
        },
        include_summaries=False,
    )

    assert document_workload.total_points == 1
    assert pipeline_workload.total_points == 1


def test_parent_child_workload_counts_child_and_summary_vectors() -> None:
    workload = build_document_workload(
        IndexStructureType.PARENT_CHILD_INDEX,
        [
            Document(
                page_content="parent-1",
                children=[ChildDocument(page_content="child-1"), ChildDocument(page_content="child-2")],
            ),
            Document(page_content="parent-2", children=[ChildDocument(page_content="child-3")]),
        ],
        include_summaries=True,
    )

    assert workload.text_points == 3
    assert workload.summary_points == 2
    assert workload.total_points == 5


def test_pipeline_qa_workload_counts_question_vectors_without_summaries() -> None:
    workload = build_pipeline_workload(
        IndexStructureType.QA_INDEX,
        {
            "qa_chunks": [
                {"question": "question-1", "answer": "answer-1"},
                {"question": "question-2", "answer": "answer-2"},
            ]
        },
        include_summaries=True,
    )

    assert workload.text_points == 2
    assert workload.summary_points == 0


def test_admission_is_cloud_only(sqlite_session: Session) -> None:
    service = VectorSpaceAdmissionService()
    with (
        patch.object(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY),
        patch("services.vector_space_admission_service.Vector.resolve_vector_type") as resolve_vector_type,
        patch("services.vector_space_admission_service.BillingService.get_info") as get_info,
    ):
        service._ensure_can_write(
            dataset=_dataset(sqlite_session),
            document_id="document-1",
            workload=_workload(),
            session=sqlite_session,
        )

    resolve_vector_type.assert_not_called()
    get_info.assert_not_called()


def test_admission_skips_non_tidb_vector_backends(sqlite_session: Session) -> None:
    service = VectorSpaceAdmissionService()
    with (
        patch.object(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
        patch("services.vector_space_admission_service.Vector.resolve_vector_type", return_value=VectorType.QDRANT),
        patch("services.vector_space_admission_service.BillingService.get_info") as get_info,
    ):
        service._ensure_can_write(
            dataset=_dataset(sqlite_session),
            document_id="document-1",
            workload=_workload(),
            session=sqlite_session,
        )

    get_info.assert_not_called()


def test_sandbox_allows_60_mb_estimate(sqlite_session: Session) -> None:
    _check_estimate(sqlite_session, CloudPlan.SANDBOX, 60)


def test_sandbox_compares_current_usage_plus_document_estimate(sqlite_session: Session) -> None:
    _check_estimate(sqlite_session, CloudPlan.SANDBOX, 20, usage_mb=40)

    with pytest.raises(VectorSpaceAdmissionError):
        _check_estimate(sqlite_session, CloudPlan.SANDBOX, 21, usage_mb=40)


def test_admission_compares_fractional_usage_without_rounding_down(sqlite_session: Session) -> None:
    _check_estimate(sqlite_session, CloudPlan.SANDBOX, 10.5, usage_mb=49.5)

    with pytest.raises(VectorSpaceAdmissionError) as exc_info:
        _check_estimate(sqlite_session, CloudPlan.SANDBOX, 10.6, usage_mb=49.5)

    assert get_vector_space_admission_error_fields(str(exc_info.value)) == {
        "error_code": VECTOR_SPACE_ADMISSION_ERROR_CODE,
        "estimated_vector_space_mb": 61,
        "vector_space_limit_mb": 50,
    }


def test_admission_uses_configured_threshold_above_nominal_limit(sqlite_session: Session) -> None:
    _check_estimate(sqlite_session, CloudPlan.SANDBOX, 10, usage_mb=50)

    with pytest.raises(VectorSpaceAdmissionError):
        _check_estimate(sqlite_session, CloudPlan.SANDBOX, 10.1, usage_mb=50)


@pytest.mark.parametrize(
    ("plan", "usage_mb", "allowed_estimate_mb", "rejected_estimate_mb"),
    [
        (CloudPlan.PROFESSIONAL, 5000, 1400, 1401),
        (CloudPlan.TEAM, 20000, 5600, 5601),
    ],
)
def test_paid_plan_projected_usage_boundaries(
    sqlite_session: Session,
    plan: CloudPlan,
    usage_mb: int,
    allowed_estimate_mb: int,
    rejected_estimate_mb: int,
) -> None:
    _check_estimate(sqlite_session, plan, allowed_estimate_mb, usage_mb=usage_mb)

    with pytest.raises(VectorSpaceAdmissionError):
        _check_estimate(sqlite_session, plan, rejected_estimate_mb, usage_mb=usage_mb)


def test_same_batch_accumulates_projected_usage(sqlite_session: Session) -> None:
    service = VectorSpaceAdmissionService()
    redis = _FakeRedis()
    _check_estimate(
        sqlite_session,
        CloudPlan.SANDBOX,
        10,
        usage_mb=40,
        service=service,
        document_id="document-1",
        redis=redis,
    )
    _check_estimate(
        sqlite_session,
        CloudPlan.SANDBOX,
        10,
        usage_mb=40,
        service=service,
        document_id="document-2",
        redis=redis,
    )

    with pytest.raises(VectorSpaceAdmissionError):
        _check_estimate(
            sqlite_session,
            CloudPlan.SANDBOX,
            1,
            usage_mb=40,
            service=service,
            document_id="document-3",
            redis=redis,
        )


def test_usage_lookup_is_refreshed_for_each_document(sqlite_session: Session) -> None:
    service = VectorSpaceAdmissionService()
    redis = _FakeRedis()
    with (
        patch.object(service, "_get_plan", return_value=CloudPlan.SANDBOX),
        patch.object(service, "_get_embedding_dimension", return_value=3072),
        patch.object(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
        patch(
            "services.vector_space_admission_service.dify_config.TIDB_ON_QDRANT_ESTIMATED_STORAGE_LIMITS_MB",
            _ESTIMATE_LIMITS,
        ),
        patch(
            "services.vector_space_admission_service.Vector.resolve_vector_type",
            return_value=VectorType.TIDB_ON_QDRANT,
        ),
        patch(
            "services.vector_space_admission_service.estimate_tidb_storage_bytes",
            side_effect=[20 * _MEBIBYTE, 1 * _MEBIBYTE],
        ),
        patch(
            "services.vector_space_admission_service.BillingService.get_vector_space",
            side_effect=[{"size": 40.0, "limit": 50}, {"size": 50.0, "limit": 50}],
        ) as get_vector_space,
        patch("services.vector_space_admission_service.redis_client", redis),
    ):
        service._ensure_can_write(
            dataset=_dataset(sqlite_session),
            document_id="document-1",
            workload=_workload(),
            session=sqlite_session,
        )
        with pytest.raises(VectorSpaceAdmissionError):
            service._ensure_can_write(
                dataset=_dataset(sqlite_session),
                document_id="document-2",
                workload=_workload(),
                session=sqlite_session,
            )

    assert get_vector_space.call_args_list == [call("tenant-1"), call("tenant-1")]


def test_independent_services_use_watermark_without_double_counting_fresh_usage(sqlite_session: Session) -> None:
    redis = _FakeRedis()
    _check_estimate(
        sqlite_session,
        CloudPlan.SANDBOX,
        10,
        usage_mb=40,
        service=VectorSpaceAdmissionService(),
        document_id="document-1",
        redis=redis,
    )
    _check_estimate(
        sqlite_session,
        CloudPlan.SANDBOX,
        10,
        usage_mb=50,
        service=VectorSpaceAdmissionService(),
        document_id="document-2",
        redis=redis,
    )

    with pytest.raises(VectorSpaceAdmissionError):
        _check_estimate(
            sqlite_session,
            CloudPlan.SANDBOX,
            1,
            usage_mb=50,
            service=VectorSpaceAdmissionService(),
            document_id="document-3",
            redis=redis,
        )

    state = json.loads(redis.values["tenant:tenant-1:vector_space_estimate_watermark"])
    assert state["projected_usage_bytes"] == 60 * _MEBIBYTE
    assert state["document_ids"] == ["document-1", "document-2"]
    assert redis.ttls["tenant:tenant-1:vector_space_estimate_watermark"] == 1800


def test_fresh_usage_above_watermark_becomes_next_projection_base(sqlite_session: Session) -> None:
    redis = _FakeRedis()
    _check_estimate(
        sqlite_session,
        CloudPlan.SANDBOX,
        10,
        usage_mb=40,
        service=VectorSpaceAdmissionService(),
        document_id="document-1",
        redis=redis,
    )
    _check_estimate(
        sqlite_session,
        CloudPlan.SANDBOX,
        5,
        usage_mb=55,
        service=VectorSpaceAdmissionService(),
        document_id="document-2",
        redis=redis,
    )

    state = json.loads(redis.values["tenant:tenant-1:vector_space_estimate_watermark"])
    assert state["projected_usage_bytes"] == 60 * _MEBIBYTE


def test_same_document_is_not_added_to_watermark_twice(sqlite_session: Session) -> None:
    redis = _FakeRedis()
    for _ in range(2):
        _check_estimate(
            sqlite_session,
            CloudPlan.SANDBOX,
            10,
            usage_mb=40,
            service=VectorSpaceAdmissionService(),
            document_id="document-1",
            redis=redis,
        )

    _check_estimate(
        sqlite_session,
        CloudPlan.SANDBOX,
        10,
        usage_mb=40,
        service=VectorSpaceAdmissionService(),
        document_id="document-2",
        redis=redis,
    )

    state = json.loads(redis.values["tenant:tenant-1:vector_space_estimate_watermark"])
    assert state["projected_usage_bytes"] == 60 * _MEBIBYTE
    assert state["document_ids"] == ["document-1", "document-2"]


def test_concurrent_services_reserve_watermark_atomically() -> None:
    redis = _FakeRedis()
    barrier = threading.Barrier(2)

    def reserve(document_id: str) -> bool:
        barrier.wait()
        _, projected_usage_bytes = VectorSpaceAdmissionService()._reserve_projected_usage(
            tenant_id="tenant-1",
            document_id=document_id,
            current_usage_bytes=40 * _MEBIBYTE,
            document_estimate_bytes=15 * _MEBIBYTE,
            estimate_limit_bytes=60 * _MEBIBYTE,
        )
        return projected_usage_bytes <= 60 * _MEBIBYTE

    with (
        patch("services.vector_space_admission_service.redis_client", redis),
        ThreadPoolExecutor(max_workers=2) as executor,
    ):
        results = list(executor.map(reserve, ["document-1", "document-2"]))

    assert sorted(results) == [False, True]
    state = json.loads(redis.values["tenant:tenant-1:vector_space_estimate_watermark"])
    assert state["projected_usage_bytes"] == 55 * _MEBIBYTE
    assert len(state["document_ids"]) == 1


@pytest.mark.parametrize(
    ("plan", "estimated_mb", "plan_limit_mb"),
    [
        (CloudPlan.SANDBOX, 61, 55),
        (CloudPlan.PROFESSIONAL, 6401, 6000),
        (CloudPlan.TEAM, 25601, 24000),
    ],
)
def test_plan_threshold_rejection_reports_billing_limit(
    sqlite_session: Session,
    plan: CloudPlan,
    estimated_mb: int,
    plan_limit_mb: int,
) -> None:
    with pytest.raises(VectorSpaceAdmissionError) as exc_info:
        _check_estimate(sqlite_session, plan, estimated_mb, plan_limit_mb=plan_limit_mb)

    assert get_vector_space_admission_error_fields(str(exc_info.value)) == {
        "error_code": VECTOR_SPACE_ADMISSION_ERROR_CODE,
        "estimated_vector_space_mb": estimated_mb,
        "vector_space_limit_mb": plan_limit_mb,
    }


def test_2060_mb_estimate_rejects_sandbox_but_allows_pro(sqlite_session: Session) -> None:
    with pytest.raises(VectorSpaceAdmissionError):
        _check_estimate(sqlite_session, CloudPlan.SANDBOX, 2060)

    _check_estimate(sqlite_session, CloudPlan.PROFESSIONAL, 2060)


def test_billing_plan_lookup_excludes_vector_space_and_is_cached() -> None:
    service = VectorSpaceAdmissionService()
    with patch(
        "services.vector_space_admission_service.BillingService.get_info",
        return_value={"enabled": True, "subscription": {"plan": "professional"}},
    ) as get_info:
        assert service._get_plan("tenant-1") == CloudPlan.PROFESSIONAL
        assert service._get_plan("tenant-1") == CloudPlan.PROFESSIONAL

    get_info.assert_called_once_with("tenant-1", exclude_vector_space=True)
