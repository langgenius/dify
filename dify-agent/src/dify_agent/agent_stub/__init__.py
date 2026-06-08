"""Client-safe import root for Dify Agent stub and back proxy code.

The package intentionally avoids eager imports so sandbox CLI users can import
``dify_agent.agent_stub`` without pulling in FastAPI, Redis, JWE, or other
server-only dependencies. Import server helpers from ``dify_agent.agent_stub.server``
explicitly when running or embedding the stub server.
"""

__all__: list[str] = []
