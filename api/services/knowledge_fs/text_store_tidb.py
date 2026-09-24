"""Native TiDB full-text search in the existing tenant TiDB-on-Qdrant cluster.

The Qdrant gateway has text filtering but no BM25 query endpoint. Use TiDB's
native inverted index on the same instance and ai database. Dify's existing
binding table remains the sole tenant/cluster authority; no extra selector or
credentials are introduced. Original PostgreSQL remains business metadata only.
"""

import ssl
from functools import lru_cache
from typing import TYPE_CHECKING, Any

from services.knowledge_fs.text_store import TextIndexPendingError, TextPayload, TextPoint
from services.knowledge_fs.vector_store import VectorResult, VectorStoreUnavailableError

if TYPE_CHECKING:
    import pymysql


@lru_cache(maxsize=128)
def _sql_endpoint(cluster_id: str) -> tuple[str, int]:
    from dify_vdb_tidb_on_qdrant.tidb_service import TidbService

    from configs import dify_config

    api_url, public_key, private_key = (
        dify_config.TIDB_API_URL,
        dify_config.TIDB_PUBLIC_KEY,
        dify_config.TIDB_PRIVATE_KEY,
    )
    if not api_url or not public_key or not private_key:
        raise VectorStoreUnavailableError("TiDB Cloud endpoint metadata is not configured")
    cluster = TidbService.get_tidb_serverless_cluster(api_url, public_key, private_key, cluster_id)
    if not cluster:
        raise VectorStoreUnavailableError("TiDB cluster endpoint metadata is unavailable")
    public = cluster["endpoints"]["public"]
    return str(public["host"]), int(public["port"])


class TidbTextStore:
    def __init__(self, connection: "pymysql.Connection"):
        self.connection = connection

    @classmethod
    def from_tenant(cls, tenant_id: str, *, allow_create: bool) -> "TidbTextStore":
        import pymysql

        from services.tidb_binding_service import resolve_tidb_auth_binding

        binding = resolve_tidb_auth_binding(tenant_id, allow_create=allow_create)
        host, port = _sql_endpoint(binding.cluster_id)
        connection = pymysql.connect(
            host=host,
            port=port,
            user=binding.account,
            password=binding.password,
            database="ai",
            ssl=ssl.create_default_context(),
            connect_timeout=10,
            read_timeout=120,
            write_timeout=30,
            autocommit=True,
            charset="utf8mb4",
        )
        return cls(connection)

    def close(self) -> None:
        self.connection.close()

    def _ensure(self, payload: TextPayload) -> bool:
        import pymysql

        name = payload.scope.collection_name  # fixed prefix plus scope SHA; never user SQL
        with self.connection.cursor() as cursor:
            cursor.execute(
                "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s", ("ai", name)
            )
            exists = bool(cursor.fetchone())
            if not exists:
                if payload.operation != "upsert":
                    if payload.operation == "search":
                        raise VectorStoreUnavailableError("KnowledgeFS full-text index is missing")
                    return False
                cursor.execute(
                    f"CREATE TABLE IF NOT EXISTS `{name}` (id CHAR(36) PRIMARY KEY, "
                    "generation_id CHAR(36) NOT NULL, content_hash CHAR(64) NOT NULL, text MEDIUMTEXT NOT NULL)"
                )
            if payload.operation == "upsert":
                cursor.execute(f"SHOW INDEX FROM `{name}` WHERE Key_name='text_fts'")
                if not cursor.fetchone():
                    try:
                        cursor.execute(
                            f"ALTER TABLE `{name}` ADD FULLTEXT INDEX text_fts (text) "
                            "WITH PARSER MULTILINGUAL ADD_COLUMNAR_REPLICA_ON_DEMAND"
                        )
                    except pymysql.err.OperationalError as error:
                        # A simultaneous initializer can win; every other DDL failure stays fatal.
                        if error.args[0] != 1061:
                            raise
            if payload.operation in {"upsert", "search"}:
                cursor.execute(
                    "SELECT AVAILABLE FROM information_schema.TIFLASH_REPLICA WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s",
                    ("ai", name),
                )
                row = cursor.fetchone()
                if not row or not row[0]:
                    raise TextIndexPendingError()
        return True

    def execute(self, payload: TextPayload) -> VectorResult:
        if not self._ensure(payload):
            return {"points": [], "matches": []}
        name = payload.scope.collection_name
        with self.connection.cursor() as cursor:
            if payload.operation == "upsert":
                # Content-addressed IDs are immutable. A conflicting payload is caught by readback.
                cursor.executemany(
                    f"INSERT INTO `{name}` (id,generation_id,content_hash,text) VALUES (%s,%s,%s,%s) "
                    "ON DUPLICATE KEY UPDATE id=id",
                    [(p.id, p.generation_id, p.content_hash, p.text) for p in payload.points],
                )
            elif payload.operation == "get":
                return {"points": self._get(payload), "matches": []}
            elif payload.operation == "search":
                placeholders = ",".join(["%s"] * len(payload.ids))
                # FTS_MATCH_WORD ranks with OR semantics. Preserve KnowledgeFS's
                # all-terms matching before top-k using exact normalized token boundaries.
                terms = sorted(set(payload.query.split()))
                patterns = [
                    "% " + term.replace("!", "!!").replace("%", "!%").replace("_", "!_") + " %" for term in terms
                ]
                token_filter = " AND ".join(["CONCAT(' ',text,' ') LIKE %s ESCAPE '!'" for _ in terms])
                # TiDB otherwise picks Batch_Point_Get for the authorized UUID list;
                # that TiKV plan cannot execute FTS_MATCH_WORD (error 1815).
                cursor.execute(
                    f"SELECT /*+ READ_FROM_STORAGE(TIFLASH[{name}]) */ id, fts_match_word(%s,text) AS score "
                    f"FROM `{name}` IGNORE INDEX (PRIMARY) WHERE fts_match_word(%s,text) "
                    f"AND id IN ({placeholders}) AND {token_filter} ORDER BY score DESC LIMIT %s",
                    (payload.query, payload.query, *payload.ids, *patterns, payload.limit),
                )
                return {
                    "points": [],
                    "matches": [{"id": str(row[0]), "score": float(row[1])} for row in cursor.fetchall()],
                }
            else:
                cursor.execute(f"DELETE FROM `{name}` WHERE id IN ({','.join(['%s'] * len(payload.ids))})", payload.ids)
                if self._get(payload):
                    raise VectorStoreUnavailableError("Full-text deletion is not visible")
        return {"points": [], "matches": []}

    def _get(self, payload: TextPayload) -> list[dict[str, Any]]:
        with self.connection.cursor() as cursor:
            cursor.execute(
                f"SELECT id,generation_id,content_hash,text FROM `{payload.scope.collection_name}` "
                f"WHERE id IN ({','.join(['%s'] * len(payload.ids))})",
                payload.ids,
            )
            return [
                TextPoint(id=row[0], generation_id=row[1], content_hash=row[2], text=row[3]).model_dump()
                for row in cursor.fetchall()
            ]
