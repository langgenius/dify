"""Prompts used to build the knowledge graph from knowledge-base chunks."""

GRAPH_EXTRACTION_PROMPT = """You are a knowledge graph extraction engine.

Read the TEXT below and extract the entities it mentions and the relations between them.

Entity types to use (pick the closest one; use "CONCEPT" if nothing else fits):
{entity_types}

Rules:
1. Extract at most {max_entities} entities. Prefer entities that carry business meaning
   over generic words.
2. Use the exact surface form from the text as the entity name. Do not translate it.
3. Only create a relation when the TEXT states or clearly implies it. Never invent facts.
4. Both endpoints of every relation MUST also appear in the entities list.
5. `predicate` is a short lower_snake_case verb phrase, e.g. `acquired`, `reports_to`,
   `is_part_of`, `causes`.
6. Write `description` in the same language as the TEXT, in one short sentence.
7. If the TEXT contains no meaningful entities, return empty lists.

Answer with a single JSON object and nothing else, in exactly this shape:
{{
  "entities": [
    {{"name": "...", "type": "...", "description": "..."}}
  ],
  "relations": [
    {{"source": "...", "target": "...", "predicate": "...", "description": "..."}}
  ]
}}

TEXT:
{text}
"""


GRAPH_QUERY_ENTITY_PROMPT = """Extract the named entities and key noun phrases from the QUESTION below.

These will be used to look up nodes in a knowledge graph, so return the terms the way a
reader would expect to find them in a document. Do not answer the question, do not add
entities that are not in it, and do not translate them.

Answer with a single JSON object and nothing else:
{{"entities": ["...", "..."]}}

QUESTION:
{query}
"""
