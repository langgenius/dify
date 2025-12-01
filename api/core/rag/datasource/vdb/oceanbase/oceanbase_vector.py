import json
import logging
import math
from typing import Any

from pydantic import BaseModel, model_validator
from pyobvector import VECTOR, ObVecClient, l2_distance  # type: ignore
from sqlalchemy import JSON, Column, String
from sqlalchemy.dialects.mysql import LONGTEXT

from configs import dify_config
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

logger = logging.getLogger(__name__)

DEFAULT_OCEANBASE_HNSW_BUILD_PARAM = {"M": 16, "efConstruction": 256}
DEFAULT_OCEANBASE_HNSW_SEARCH_PARAM = {"efSearch": 64}
OCEANBASE_SUPPORTED_VECTOR_INDEX_TYPE = "HNSW"
DEFAULT_OCEANBASE_VECTOR_METRIC_TYPE = "l2"


class OceanBaseVectorConfig(BaseModel):
    host: str
    port: int
    user: str
    password: str
    database: str
    enable_hybrid_search: bool = False

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict):
        if not values["host"]:
            raise ValueError("config OCEANBASE_VECTOR_HOST is required")
        if not values["port"]:
            raise ValueError("config OCEANBASE_VECTOR_PORT is required")
        if not values["user"]:
            raise ValueError("config OCEANBASE_VECTOR_USER is required")
        if not values["database"]:
            raise ValueError("config OCEANBASE_VECTOR_DATABASE is required")
        return values


class OceanBaseVector(BaseVector):
    def __init__(self, collection_name: str, config: OceanBaseVectorConfig):
        super().__init__(collection_name)
        self._config = config
        self._hnsw_ef_search = -1
        self._client = ObVecClient(
            uri=f"{self._config.host}:{self._config.port}",
            user=self._config.user,
            password=self._config.password,
            db_name=self._config.database,
        )
        self._fields: list[str] = []  # List of fields in the collection
        if self._client.check_table_exists(collection_name):
            self._load_collection_fields()
        self._hybrid_search_enabled = self._check_hybrid_search_support()  # Check if hybrid search is supported

    def get_type(self) -> str:
        return VectorType.OCEANBASE

    def _load_collection_fields(self):
        """
        Load collection fields from the database table.
        This method populates the _fields list with column names from the table.
        """
        try:
            if self._collection_name in self._client.metadata_obj.tables:
                table = self._client.metadata_obj.tables[self._collection_name]
                # Store all column names except 'id' (primary key)
                self._fields = [column.name for column in table.columns if column.name != "id"]
                logger.debug("Loaded fields for collection '%s': %s", self._collection_name, self._fields)
            else:
                logger.warning("Collection '%s' not found in metadata", self._collection_name)
        except Exception as e:
            logger.warning("Failed to load collection fields for '%s': %s", self._collection_name, str(e))

    def field_exists(self, field: str) -> bool:
        """
        Check if a field exists in the collection.

        :param field: Field name to check
        :return: True if field exists, False otherwise
        """
        return field in self._fields

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        self._vec_dim = len(embeddings[0])
        self._create_collection()
        self.add_texts(texts, embeddings)

    def _create_collection(self):
        lock_name = "vector_indexing_lock_" + self._collection_name
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = "vector_indexing_" + self._collection_name
            if redis_client.get(collection_exist_cache_key):
                return

            if self._client.check_table_exists(self._collection_name):
                return

            self.delete()

            vals = []
            params = self._client.perform_raw_text_sql("SHOW PARAMETERS LIKE '%ob_vector_memory_limit_percentage%'")
            for row in params:
                val = int(row[6])
                vals.append(val)
            if len(vals) == 0:
                raise ValueError("ob_vector_memory_limit_percentage not found in parameters.")
            if any(val == 0 for val in vals):
                try:
                    self._client.perform_raw_text_sql("ALTER SYSTEM SET ob_vector_memory_limit_percentage = 30")
                except Exception as e:
                    raise Exception(
                        "Failed to set ob_vector_memory_limit_percentage. "
                        + "Maybe the database user has insufficient privilege.",
                        e,
                    )

            cols = [
                Column("id", String(36), primary_key=True, autoincrement=False),
                Column("vector", VECTOR(self._vec_dim)),
                Column("text", LONGTEXT),
                Column("metadata", JSON),
            ]
            vidx_params = self._client.prepare_index_params()
            vidx_params.add_index(
                field_name="vector",
                index_type=OCEANBASE_SUPPORTED_VECTOR_INDEX_TYPE,
                index_name="vector_index",
                metric_type=DEFAULT_OCEANBASE_VECTOR_METRIC_TYPE,
                params=DEFAULT_OCEANBASE_HNSW_BUILD_PARAM,
            )

            self._client.create_table_with_index_params(
                table_name=self._collection_name,
                columns=cols,
                vidxs=vidx_params,
            )
            logger.debug("DEBUG: Table '%s' created successfully", self._collection_name)

            if self._hybrid_search_enabled:
                # Get parser from config or use default ik parser
                parser_name = dify_config.OCEANBASE_FULLTEXT_PARSER or "ik"

                allowed_parsers = ["ngram", "beng", "space", "ngram2", "ik", "japanese_ftparser", "thai_ftparser"]
                if parser_name not in allowed_parsers:
                    raise ValueError(
                        f"Invalid OceanBase full-text parser: {parser_name}. "
                        f"Allowed values are: {', '.join(allowed_parsers)}"
                    )
                logger.debug("Hybrid search is enabled, parser_name='%s'", parser_name)
                logger.debug(
                    "About to create fulltext index for collection '%s' using parser '%s'",
                    self._collection_name,
                    parser_name,
                )
                try:
                    sql_command = f"""ALTER TABLE {self._collection_name}
                    ADD FULLTEXT INDEX fulltext_index_for_col_text (text) WITH PARSER {parser_name}"""
                    logger.debug("DEBUG: Executing SQL: %s", sql_command)
                    self._client.perform_raw_text_sql(sql_command)
                    logger.debug("DEBUG: Fulltext index created successfully for '%s'", self._collection_name)
                except Exception as e:
                    logger.exception("Exception occurred while creating fulltext index")
                    raise Exception(
                        "Failed to add fulltext index to the target table, your OceanBase version must be "
                        "4.3.5.1 or above to support fulltext index and vector index in the same table"
                    ) from e
            else:
                logger.debug("DEBUG: Hybrid search is NOT enabled for '%s'", self._collection_name)

            self._client.refresh_metadata([self._collection_name])
            self._load_collection_fields()
            redis_client.set(collection_exist_cache_key, 1, ex=3600)

    def _check_hybrid_search_support(self) -> bool:
        """
        Check if the current OceanBase version supports hybrid search.
        Returns True if the version is >= 4.3.5.1, otherwise False.
        """
        if not self._config.enable_hybrid_search:
            return False

        try:
            from packaging import version

            # return OceanBase_CE 4.3.5.1 (r101000042025031818-bxxxx) (Built Mar 18 2025 18:13:36)
            result = self._client.perform_raw_text_sql("SELECT @@version_comment AS version")
            ob_full_version = result.fetchone()[0]
            ob_version = ob_full_version.split()[1]
            logger.debug("Current OceanBase version is %s", ob_version)
            return version.parse(ob_version) >= version.parse("4.3.5.1")
        except Exception as e:
            logger.warning("Failed to check OceanBase version: %s. Disabling hybrid search.", str(e))
            return False

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        ids = self._get_uuids(documents)
        for id, doc, emb in zip(ids, documents, embeddings):
            try:
                self._client.insert(
                    table_name=self._collection_name,
                    data={
                        "id": id,
                        "vector": emb,
                        "text": doc.page_content,
                        "metadata": doc.metadata,
                    },
                )
            except Exception as e:
                logger.exception(
                    "Failed to insert document with id '%s' in collection '%s'",
                    id,
                    self._collection_name,
                )
                raise Exception(f"Failed to insert document with id '{id}'") from e

    def text_exists(self, id: str) -> bool:
        try:
            cur = self._client.get(table_name=self._collection_name, ids=id)
            return bool(cur.rowcount != 0)
        except Exception as e:
            logger.exception(
                "Failed to check if text exists with id '%s' in collection '%s'",
                id,
                self._collection_name,
            )
            raise Exception(f"Failed to check text existence for id '{id}'") from e

    def delete_by_ids(self, ids: list[str]):
        if not ids:
            return
        try:
            self._client.delete(table_name=self._collection_name, ids=ids)
            logger.debug("Deleted %d documents from collection '%s'", len(ids), self._collection_name)
        except Exception as e:
            logger.exception(
                "Failed to delete %d documents from collection '%s'",
                len(ids),
                self._collection_name,
            )
            raise Exception(f"Failed to delete documents from collection '{self._collection_name}'") from e

    def get_ids_by_metadata_field(self, key: str, value: str) -> list[str]:
        try:
            import re

            from sqlalchemy import text

            # Validate key to prevent injection in JSON path
            if not re.match(r"^[a-zA-Z0-9_.]+$", key):
                raise ValueError(f"Invalid characters in metadata key: {key}")

            # Use parameterized query to prevent SQL injection
            sql = text(f"SELECT id FROM `{self._collection_name}` WHERE metadata->>'$.{key}' = :value")

            with self._client.engine.connect() as conn:
                result = conn.execute(sql, {"value": value})
                ids = [row[0] for row in result]

            logger.debug(
                "Found %d documents with metadata field '%s'='%s' in collection '%s'",
                len(ids),
                key,
                value,
                self._collection_name,
            )
            return ids
        except Exception as e:
            logger.exception(
                "Failed to get IDs by metadata field '%s'='%s' in collection '%s'",
                key,
                value,
                self._collection_name,
            )
            raise Exception(f"Failed to query documents by metadata field '{key}'") from e

    def delete_by_metadata_field(self, key: str, value: str):
        ids = self.get_ids_by_metadata_field(key, value)
        if ids:
            self.delete_by_ids(ids)
        else:
            logger.debug("No documents found to delete with metadata field '%s'='%s'", key, value)

    def _process_search_results(
        self, results: list[tuple], score_threshold: float = 0.0, score_key: str = "score"
    ) -> list[Document]:
        """
        Common method to process search results

        :param results: Search results as list of tuples (text, metadata, score)
        :param score_threshold: Score threshold for filtering
        :param score_key: Key name for score in metadata
        :return: List of documents
        """
        docs = []
        for row in results:
            text, metadata_str, score = row[0], row[1], row[2]

            # Parse metadata JSON
            try:
                metadata = json.loads(metadata_str) if isinstance(metadata_str, str) else metadata_str
            except json.JSONDecodeError:
                logger.warning("Invalid JSON metadata: %s", metadata_str)
                metadata = {}

            # Add score to metadata
            metadata[score_key] = score

            # Filter by score threshold
            if score >= score_threshold:
                docs.append(Document(page_content=text, metadata=metadata))

        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        if not self._hybrid_search_enabled:
            logger.warning(
                "Full-text search is disabled: set OCEANBASE_ENABLE_HYBRID_SEARCH=true (requires OceanBase >= 4.3.5.1)."
            )
            return []
        if not self.field_exists("text"):
            logger.warning(
                "Full-text search unavailable: collection '%s' missing 'text' field; "
                "recreate the collection after enabling OCEANBASE_ENABLE_HYBRID_SEARCH to add fulltext index.",
                self._collection_name,
            )
            return []

        try:
            top_k = kwargs.get("top_k", 5)
            if not isinstance(top_k, int) or top_k <= 0:
                raise ValueError("top_k must be a positive integer")

            score_threshold = float(kwargs.get("score_threshold") or 0.0)

            # Build parameterized query to prevent SQL injection
            from sqlalchemy import text

            document_ids_filter = kwargs.get("document_ids_filter")
            params = {"query": query}
            where_clause = ""

            if document_ids_filter:
                # Create parameterized placeholders for document IDs
                placeholders = ", ".join(f":doc_id_{i}" for i in range(len(document_ids_filter)))
                where_clause = f" AND metadata->>'$.document_id' IN ({placeholders})"
                # Add document IDs to parameters
                for i, doc_id in enumerate(document_ids_filter):
                    params[f"doc_id_{i}"] = doc_id

            full_sql = f"""SELECT text, metadata, MATCH (text) AGAINST (:query) AS score
            FROM {self._collection_name}
            WHERE MATCH (text) AGAINST (:query) > 0
            {where_clause}
            ORDER BY score DESC
            LIMIT {top_k}"""

            with self._client.engine.connect() as conn:
                with conn.begin():
                    result = conn.execute(text(full_sql), params)
                    rows = result.fetchall()

                    return self._process_search_results(rows, score_threshold=score_threshold)
        except Exception as e:
            logger.exception(
                "Failed to perform full-text search on collection '%s' with query '%s'",
                self._collection_name,
                query,
            )
            raise Exception(f"Full-text search failed for collection '{self._collection_name}'") from e

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        from sqlalchemy import text

        document_ids_filter = kwargs.get("document_ids_filter")
        _where_clause = None
        if document_ids_filter:
            # Validate document IDs to prevent SQL injection
            # Document IDs should be alphanumeric with hyphens and underscores
            import re

            for doc_id in document_ids_filter:
                if not isinstance(doc_id, str) or not re.match(r"^[a-zA-Z0-9_-]+$", doc_id):
                    raise ValueError(f"Invalid document ID format: {doc_id}")

            # Safe to use in query after validation
            document_ids = ", ".join(f"'{id}'" for id in document_ids_filter)
            where_clause = f"metadata->>'$.document_id' in ({document_ids})"
            _where_clause = [text(where_clause)]
        ef_search = kwargs.get("ef_search", self._hnsw_ef_search)
        if ef_search != self._hnsw_ef_search:
            self._client.set_ob_hnsw_ef_search(ef_search)
            self._hnsw_ef_search = ef_search
        topk = kwargs.get("top_k", 10)
        try:
            score_threshold = float(val) if (val := kwargs.get("score_threshold")) is not None else 0.0
        except (ValueError, TypeError) as e:
            raise ValueError(f"Invalid score_threshold parameter: {e}") from e
        try:
            cur = self._client.ann_search(
                table_name=self._collection_name,
                vec_column_name="vector",
                vec_data=query_vector,
                topk=topk,
                distance_func=l2_distance,
                output_column_names=["text", "metadata"],
                with_dist=True,
                where_clause=_where_clause,
            )
        except Exception as e:
            logger.exception(
                "Failed to perform vector search on collection '%s'",
                self._collection_name,
            )
            raise Exception(f"Vector search failed for collection '{self._collection_name}'") from e

        # Convert distance to score and prepare results for processing
        results = []
        for _text, metadata_str, distance in cur:
            score = 1 - distance / math.sqrt(2)
            results.append((_text, metadata_str, score))

        return self._process_search_results(results, score_threshold=score_threshold)

    def delete(self):
        try:
            self._client.drop_table_if_exist(self._collection_name)
            logger.debug("Dropped collection '%s'", self._collection_name)
        except Exception as e:
            logger.exception("Failed to delete collection '%s'", self._collection_name)
            raise Exception(f"Failed to delete collection '{self._collection_name}'") from e


class OceanBaseVectorFactory(AbstractVectorFactory):
    def init_vector(
        self,
        dataset: Dataset,
        attributes: list,
        embeddings: Embeddings,
    ) -> BaseVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix.lower()
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id).lower()
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.OCEANBASE, collection_name))
        return OceanBaseVector(
            collection_name,
            OceanBaseVectorConfig(
                host=dify_config.OCEANBASE_VECTOR_HOST or "",
                port=dify_config.OCEANBASE_VECTOR_PORT or 0,
                user=dify_config.OCEANBASE_VECTOR_USER or "",
                password=(dify_config.OCEANBASE_VECTOR_PASSWORD or ""),
                database=dify_config.OCEANBASE_VECTOR_DATABASE or "",
                enable_hybrid_search=dify_config.OCEANBASE_ENABLE_HYBRID_SEARCH or False,
            ),
        )
