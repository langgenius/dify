from core.workflow.nodes.agent.entities import AgentNodeData


def test_agent_node_data_unconfigured_default():
    # Unconfigured agent node data (e.g. newly added to canvas) should pass validation with safe defaults
    data = AgentNodeData.model_validate({"title": "Agent"})
    assert data.agent_strategy_provider_name == ""
    assert data.agent_strategy_name == ""
    assert data.agent_strategy_label == ""
    assert data.agent_parameters == {}
