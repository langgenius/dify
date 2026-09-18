"""Transformer package marker for collection integrations.

Import pydantic-ai transformer presets from
``agenton_collections.transformers.pydantic_ai`` explicitly so default imports do
not pull runtime bridge implementations into client-safe environments.
"""

__all__: list[str] = []
