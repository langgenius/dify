from __future__ import annotations

from services.knowledge_fs.lifecycle_readiness import evaluate_knowledge_fs_lifecycle_worker_readiness


def test_worker_readiness_requires_every_rollout_gate() -> None:
    readiness = evaluate_knowledge_fs_lifecycle_worker_readiness(
        worker_enabled=True,
        capability_v2_enabled=True,
        integrated_provision_ready=False,
        legacy_acl_freeze_ready=True,
    )

    assert readiness.ready is False
    assert readiness.blockers == ("integrated_provision",)


def test_worker_readiness_is_independent_from_product_feature_flag() -> None:
    readiness = evaluate_knowledge_fs_lifecycle_worker_readiness(
        worker_enabled=True,
        capability_v2_enabled=True,
        integrated_provision_ready=True,
        legacy_acl_freeze_ready=True,
    )

    assert readiness.ready is True
    assert readiness.blockers == ()
