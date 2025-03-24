import json
import uuid
from contextlib import contextmanager
from typing import Any

import psycopg2.extras  # type: ignore
import psycopg2.pool  # type: ignore
from pydantic import BaseModel, model_validator

from core.rag.models.document import Document
from extensions.ext_redis import redis_client


class AnalyticdbVectorBySqlConfig(BaseModel):
    host: str
    port: int
    account: str
    account_password: str
    min_connection: int
    max_connection: int
    namespace: str = "dify"
    metrics: str = "cosine"

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict) -> dict:
        if not values["host"]:
            raise ValueError("config ANALYTICDB_HOST is required")
        if not values["port"]:
            raise ValueError("config ANALYTICDB_PORT is required")
        if not values["account"]:
            raise ValueError("config ANALYTICDB_ACCOUNT is required")
        if not values["account_password"]:
            raise ValueError("config ANALYTICDB_PASSWORD is required")
        if not values["min_connection"]:
            raise ValueError("config ANALYTICDB_MIN_CONNECTION is required")
        if not values["max_connection"]:
            raise ValueError("config ANALYTICDB_MAX_CONNECTION is required")
        if values["min_connection"] > values["max_connection"]:
            raise ValueError("config ANALYTICDB_MIN_CONNECTION should less than ANALYTICDB_MAX_CONNECTION")
        return values


class AnalyticdbVectorBySql:
    def __init__(self, collection_name: str, config: AnalyticdbVectorBySqlConfig):
        self._collection_name = collection_name.lower()
        self.databaseName = "knowledgebase"
        self.config = config
        self.table_name = f"{self.config.namespace}.{self._collection_name}"
        self.pool = None
        self._initialize()
        if not self.pool:
            self.pool = self._create_connection_pool()

    def _initialize(self) -> None:
        cache_key = f"vector_initialize_{self.config.host}"
        lock_name = f"{cache_key}_lock"
        with redis_client.lock(lock_name, timeout=20):
            database_exist_cache_key = f"vector_initialize_{self.config.host}"
            if redis_client.get(database_exist_cache_key):
                return
            self._initialize_vector_database()
            redis_client.set(database_exist_cache_key, 1, ex=3600)

    def _create_connection_pool(self):
        return psycopg2.pool.SimpleConnectionPool(
            self.config.min_connection,
            self.config.max_connection,
            host=self.config.host,
            port=self.config.port,
            user=self.config.account,
            password=self.config.account_password,
            database=self.databaseName,
        )

    @contextmanager
    def _get_cursor(self):
        assert self.pool is not None, "Connection pool is not initialized"
        conn = self.pool.getconn()
        cur = conn.cursor()
        try:
            yield cur
        finally:
            cur.close()
            conn.commit()
            self.pool.putconn(conn)

    def _initialize_vector_database(self) -> None:
        conn = psycopg2.connect(
            host=self.config.host,
            port=self.config.port,
            user=self.config.account,
            password=self.config.account_password,
            database="postgres",
        )
        conn.autocommit = True
        cur = conn.cursor()
        try:
            cur.execute(f"CREATE DATABASE {self.databaseName}")
        except Exception as e:
            if "already exists" in str(e):
                return
            raise e
        finally:
            cur.close()
            conn.close()
        self.pool = self._create_connection_pool()
        with self._get_cursor() as cur:
            try:
                cur.execute("CREATE TEXT SEARCH CONFIGURATION zh_cn (PARSER = zhparser)")
                cur.execute("ALTER TEXT SEARCH CONFIGURATION zh_cn ADD MAPPING FOR n,v,a,i,e,l,x WITH simple")
            except Exception as e:
                if "already exists" not in str(e):
                    raise e
            cur.execute(
                "CREATE OR REPLACE FUNCTION "
                "public.to_tsquery_from_text(txt text, lang regconfig DEFAULT 'english'::regconfig) "
                "RETURNS tsquery LANGUAGE sql IMMUTABLE STRICT AS $function$ "
                "SELECT to_tsquery(lang, COALESCE(string_agg(split_part(word, ':', 1), ' | '), '')) "
                "FROM (SELECT unnest(string_to_array(to_tsvector(lang, txt)::text, ' ')) AS word) "
                "AS words_only;$function$"
            )
            cur.execute(f"CREATE SCHEMA IF NOT EXISTS {self.config.namespace}")

    def _create_collection_if_not_exists(self, embedding_dimension: int):
        cache_key = f"vector_indexing_{self._collection_name}"
        lock_name = f"{cache_key}_lock"
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = f"vector_indexing_{self._collection_name}"
            if redis_client.get(collection_exist_cache_key):
                return
            with self._get_cursor() as cur:
                cur.execute(
                    f"CREATE TABLE IF NOT EXISTS {self.table_name}("
                    f"id text PRIMARY KEY,"
                    f"vector real[], ref_doc_id text, page_content text, metadata_ jsonb, "
                    f"to_tsvector TSVECTOR"
                    f") WITH (fillfactor=70) DISTRIBUTED BY (id);"
                )
                if embedding_dimension is not None:
                    index_name = f"{self._collection_name}_embedding_idx"
                    cur.execute(f"ALTER TABLE {self.table_name} ALTER COLUMN vector SET STORAGE PLAIN")
                    cur.execute(
                        f"CREATE INDEX {index_name} ON {self.table_name} USING ann(vector) "
                        f"WITH(dim='{embedding_dimension}', distancemeasure='{self.config.metrics}', "
                        f"pq_enable=0, external_storage=0)"
                    )
                    cur.execute(f"CREATE INDEX ON {self.table_name} USING gin(to_tsvector)")
            redis_client.set(collection_exist_cache_key, 1, ex=3600)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        values = []
        id_prefix = str(uuid.uuid4()) + "_"
        sql = f"""
                INSERT INTO {self.table_name} 
                (id, ref_doc_id, vector, page_content, metadata_, to_tsvector) 
                VALUES (%s, %s, %s, %s, %s, to_tsvector('zh_cn',  %s));
            """
        for i, doc in enumerate(documents):
            if doc.metadata is not None:
                values.append(
                    (
                        id_prefix + str(i),
                        doc.metadata.get("doc_id", str(uuid.uuid4())),
                        embeddings[i],
                        doc.page_content,
                        json.dumps(doc.metadata),
                        doc.page_content,
                    )
                )
        with self._get_cursor() as cur:
            psycopg2.extras.execute_batch(cur, sql, values)

    def text_exists(self, id: str) -> bool:
        with self._get_cursor() as cur:
            cur.execute(f"SELECT id FROM {self.table_name} WHERE ref_doc_id = %s", (id,))
            return cur.fetchone() is not None

    def delete_by_ids(self, ids: list[str]) -> None:
        with self._get_cursor() as cur:
            try:
                cur.execute(f"DELETE FROM {self.table_name} WHERE ref_doc_id IN %s", (tuple(ids),))
            except Exception as e:
                if "does not exist" not in str(e):
                    raise e

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        with self._get_cursor() as cur:
            try:
                cur.execute(f"DELETE FROM {self.table_name} WHERE metadata_->>%s = %s", (key, value))
            except Exception as e:
                if "does not exist" not in str(e):
                    raise e

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        top_k = kwargs.get("top_k", 4)
        if not isinstance(top_k, int) or top_k <= 0:
            raise ValueError("top_k must be a positive integer")
        document_ids_filter = kwargs.get("document_ids_filter")
        where_clause = "WHERE 1=1"
        if document_ids_filter:
            document_ids = ", ".join(f"'{id}'" for id in document_ids_filter)
            where_clause += f"AND metadata_->>'document_id' IN ({document_ids})"
        score_threshold = float(kwargs.get("score_threshold") or 0.0)
        with self._get_cursor() as cur:
            query_vector_str = json.dumps(query_vector)
            query_vector_str = "{" + query_vector_str[1:-1] + "}"
            cur.execute(
                f"SELECT t.id AS id, t.vector AS vector, (1.0 - t.score) AS score, "
                f"t.page_content as page_content, t.metadata_ AS metadata_ "
                f"FROM (SELECT id, vector, page_content, metadata_, vector <=> %s AS score "
                f"FROM {self.table_name} {where_clause} ORDER BY score LIMIT {top_k} ) t",
                (query_vector_str,),
            )
            documents = []
            for record in cur:
                id, vector, score, page_content, metadata = record
                if score > score_threshold:
                    metadata["score"] = score
                    doc = Document(
                        page_content=page_content,
                        vector=vector,
                        metadata=metadata,
                    )
                    documents.append(doc)
        return documents

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        top_k = kwargs.get("top_k", 4)
        if not isinstance(top_k, int) or top_k <= 0:
            raise ValueError("top_k must be a positive integer")
        document_ids_filter = kwargs.get("document_ids_filter")
        where_clause = ""
        if document_ids_filter:
            document_ids = ", ".join(f"'{id}'" for id in document_ids_filter)
            where_clause += f"AND metadata_->>'document_id' IN ({document_ids})"
        with self._get_cursor() as cur:
            cur.execute(
                f"""SELECT id, vector, page_content, metadata_, 
                ts_rank(to_tsvector, to_tsquery_from_text(%s, 'zh_cn'), 32) AS score
                FROM {self.table_name}
                WHERE to_tsvector@@to_tsquery_from_text(%s, 'zh_cn') {where_clause}
                ORDER BY score DESC
                LIMIT {top_k}""",
                (f"'{query}'", f"'{query}'"),
            )
            documents = []
            for record in cur:
                id, vector, page_content, metadata, score = record
                metadata["score"] = score
                doc = Document(
                    page_content=page_content,
                    vector=vector,
                    metadata=metadata,
                )
                documents.append(doc)
        return documents

    def delete(self) -> None:
        with self._get_cursor() as cur:
            cur.execute(f"DROP TABLE IF EXISTS {self.table_name}")
