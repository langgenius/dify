"""Contracts shared by Dify trace producers, the trace pipeline, and trace providers.

Providers depend on this package and their vendor SDK only. They never import
the Dify application (database, Redis, configuration, services).
"""
