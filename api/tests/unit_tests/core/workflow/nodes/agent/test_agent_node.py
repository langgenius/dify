def test_agent_input_description():
    from core.workflow.nodes.agent.entities import AgentNodeData
    # Description provided
    input_with_desc = AgentNodeData.AgentInput(value=["foo"], type="mixed", description="A test description.")
    assert input_with_desc.description == "A test description."
    # Description omitted
    input_without_desc = AgentNodeData.AgentInput(value=["bar"], type="mixed")
    assert input_without_desc.description is None
    # Serialization
    data = input_with_desc.model_dump()
    assert data["description"] == "A test description." 