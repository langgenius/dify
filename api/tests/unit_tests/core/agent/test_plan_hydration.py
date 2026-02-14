import pytest
from core.agent.plan_hydration.engine import PlanHydrationEngine

def test_intent_fingerprinting():
    engine = PlanHydrationEngine()
    task = "Daily Security Audit"
    tools = ["nmap", "trivy"]
    instructions = "Check all open ports."
    
    # Ensure fingerprint is deterministic (same input = same hash)
    hash1 = engine._generate_fingerprint(task, tools, instructions)
    hash2 = engine._generate_fingerprint(task, tools, instructions)
    assert hash1 == hash2

def test_layer1_hydration_retrieval():
    engine = PlanHydrationEngine()
    task = "Standard Ticket Triage"
    tools = ["jira_tool"]
    instructions = "Assign to support."
    mock_plan = {"steps": ["call_jira"], "version": "1.0"}
    
    # Simulate saving a successful plan
    engine._save_plan(task, tools, instructions, mock_plan)
    
    # Retrieve it (Layer 1 Short-circuit)
    hydrated_plan = engine.get_hydrated_plan(task, tools, instructions)
    assert hydrated_plan["steps"] == ["call_jira"]

def test_state_isolation():
    engine = PlanHydrationEngine()
    # Verify that the engine returns a fresh state to avoid context pollution
    state = engine.initialize_fresh_state()
    assert isinstance(state, dict)
    assert len(state) == 0