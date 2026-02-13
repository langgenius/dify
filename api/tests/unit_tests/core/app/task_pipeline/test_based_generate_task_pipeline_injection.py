from types import SimpleNamespace

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.task_pipeline.based_generate_task_pipeline import BasedGenerateTaskPipeline
from core.moderation.moderation_coordinator import ModerationCoordinator


class _QM(AppQueueManager):
    def __init__(self, c):
        # Skip base __init__ to avoid Redis and other side effects
        self.moderation_coordinator = c

    def _publish(self, event, pub_from: PublishFrom):  # type: ignore[override]
        pass


def test_based_pipeline_injects_coordinator_into_output_moderation():
    coord = ModerationCoordinator()
    qm = _QM(coord)

    app_entity = SimpleNamespace(
        app_config=SimpleNamespace(
            tenant_id="tenant",
            app_id="app",
            sensitive_word_avoidance=SimpleNamespace(type="sensitive_word", config={}),
        )
    )

    p = BasedGenerateTaskPipeline(application_generate_entity=app_entity, queue_manager=qm, stream=True)

    assert p.output_moderation_handler is not None
    assert p.output_moderation_handler.coordinator is coord
