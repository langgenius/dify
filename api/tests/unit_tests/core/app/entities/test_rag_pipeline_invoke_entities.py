from core.app.entities.rag_pipeline_invoke_entities import RagPipelineInvokeEntity


class TestRagPipelineInvokeEntity:
    def test_defaults_and_fields(self):
        entity = RagPipelineInvokeEntity(
            pipeline_id="pipe-1",
            application_generate_entity={"foo": "bar"},
            user_id="user-1",
            tenant_id="tenant-1",
            workflow_id="workflow-1",
            streaming=True,
        )

        assert entity.workflow_execution_id is None
        assert entity.workflow_thread_pool_id is None
        assert entity.streaming is True
