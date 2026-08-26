from enum import StrEnum


class GraphStoreType(StrEnum):
    POSTGRES = "postgres"
    NEO4J = "neo4j"
