import pytest
from unittest.mock import MagicMock, patch
# FIX: Using the new class name from engine.py
from core.agent.plan_hydration.engine import EROS3LayerHydrator

def test_eros_hydration_logic():
    """Validates the new EROS 3-Layer Hydration logic names."""
    
    # PRECISION FIX: Mock the internal Redis/Cache lookup so the test doesn't 
    # try to connect to a real database and crash.
    with patch("core.agent.plan_hydration.engine.EROS3LayerHydrator._lookup_plan") as mock_lookup:
        # Simulate a 'MISS' (no cached plan found)
        mock_lookup.return_value = None
        
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
        
        # Verify the result object structure
        assert result is not None
        # Verify the fingerprinting logic exists (Layer 1 of EROS)
        assert hasattr(result, 'fingerprint')
        # Verify the status is captured (Layer 2/3)
        assert hasattr(result, 'status')

# Additional edge case for Dify consistency
def test_eros_hydration_fingerprint_consistency():
    """Ensures same query + same tools = same fingerprint."""
    with patch("core.agent.plan_hydration.engine.EROS3LayerHydrator._lookup_plan", return_value=None):
        hydrator = EROS3LayerHydrator()
        args = {
            "query": "test",
            "tools": [],
            "tenant_id": "t",
            "instruction": "i"
        }
        res1 = hydrator.hydrate(**args)
        res2 = hydrator.hydrate(**args)
        assert res1.fingerprint == res2.fingerprint
