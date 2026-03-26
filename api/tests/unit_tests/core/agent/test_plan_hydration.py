import pytest
from unittest.mock import MagicMock
# FIX: Using the new class name from engine.py
from core.agent.plan_hydration.engine import EROS3LayerHydrator

def test_eros_hydration_logic():
    """Validates the new EROS 3-Layer Hydration logic names."""
    hydrator = EROS3LayerHydrator()
    
    # Mock parameters
    query = "Search for AI news"
    tools = [{"name": "google_search", "provider": "google"}]
    tenant_id = "test_tenant"
    
    # FIX: Updated method call to .hydrate() 
    result = hydrator.hydrate(
        query=query,
        tools=tools,
        tenant_id=tenant_id,
        instruction="Helpful assistant"
    )
    
    assert result is not None
    # Verify the fingerprinting logic exists
    assert hasattr(result, 'fingerprint')
  
