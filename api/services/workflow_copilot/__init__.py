"""Service-layer adapter package for the Workflow Copilot.

Wires the pure, I/O-free ``core.workflow_copilot`` engine (P1) to Dify's own
``WorkflowService`` / ``AppGenerateService`` (P2). Unlike ``core.workflow_copilot``,
this package may import Flask, SQLAlchemy, and the rest of Dify's services.
"""
