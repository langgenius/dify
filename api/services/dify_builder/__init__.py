"""Service-layer adapter package for the Dify Builder.

Wires the pure, I/O-free ``core.dify_builder`` engine (P1) to Dify's own
``WorkflowService`` / ``AppGenerateService`` (P2). Unlike ``core.dify_builder``,
this package may import Flask, SQLAlchemy, and the rest of Dify's services.
"""
