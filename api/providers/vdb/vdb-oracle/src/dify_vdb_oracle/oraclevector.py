import array
import json
import logging
import re
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any, TypedDict, override

import jieba.posseg as pseg  # type: ignore
import numpy
import oracledb
from oracledb.connection import Connection
from pydantic import BaseModel, model_validator

from configs import dify_config
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

logger = logging.getLogger(__name__)

oracledb.defaults.fetch_lobs = False

ORACLE_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
MAX_TOP_K = 10000
ORACLE_TEXT_SAFE_TOKEN = re.compile(r"[\w\u4e00-\u9fff]+", re.UNICODE)
ORACLE_TEXT_RESERVED_TOKENS = {
    "ABOUT",
    "ACCUM",
    "AND",
    "BT",
    "BTG",
    "BTI",
    "EQUIV",
    "FUZZY",
    "HASPATH",
    "INPATH",
    "MINUS",
    "NEAR",
    "NOT",
    "NT",
    "NTG",
    "NTI",
    "OR",
    "PT",
    "RT",
    "SQE",
    "SYN",
    "TR",
    "TRSYN",
    "WITHIN",
}
ORACLE_TEXT_PARSER_ERROR_CODES = ("DRG-50901", "DRG-50902", "DRG-50906", "DRG-50907")
ORACLE_IN_CLAUSE_BATCH_SIZE = 900


class _OraclePoolParams(TypedDict, total=False):
    user: str
    password: str
    dsn: str
    min: int
    max: int
    increment: int
    config_dir: str | None
    wallet_location: str | None
    wallet_password: str | None


class OracleVectorConfig(BaseModel):
    user: str
    password: str
    dsn: str
    config_dir: str | None = None
    wallet_location: str | None = None
    wallet_password: str | None = None
    is_autonomous: bool = False
    pool_min: int = 1
    pool_max: int = 5
    pool_increment: int = 1

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict[str, Any]):
        values = dict(values)
        if not values.get("user"):
            raise ValueError("config ORACLE_USER is required")
        if not values.get("password"):
            raise ValueError("config ORACLE_PASSWORD is required")
        if not values.get("dsn"):
            raise ValueError("config ORACLE_DSN is required")
        if values.get("is_autonomous", False):
            if not values.get("config_dir"):
                raise ValueError("config_dir is required for autonomous database")
            if not values.get("wallet_location"):
                raise ValueError("wallet_location is required for autonomous database")
            if not values.get("wallet_password"):
                raise ValueError("wallet_password is required for autonomous database")
        return values

    @model_validator(mode="after")
    def validate_pool_config(self):
        if self.pool_min <= 0:
            raise ValueError("pool_min must be greater than 0")
        if self.pool_max <= 0:
            raise ValueError("pool_max must be greater than 0")
        if self.pool_increment <= 0:
            raise ValueError("pool_increment must be greater than 0")
        if self.pool_min > self.pool_max:
            raise ValueError("pool_min must be less than or equal to pool_max")
        return self


SQL_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS {table_name} (
    id varchar2(100) PRIMARY KEY
    ,text CLOB NOT NULL
    ,meta JSON
    ,embedding vector NOT NULL
)
"""
SQL_CREATE_INDEX = """
CREATE INDEX IF NOT EXISTS {index_name} ON {table_name}(text)
INDEXTYPE IS CTXSYS.CONTEXT PARAMETERS
('FILTER CTXSYS.NULL_FILTER SECTION GROUP CTXSYS.HTML_SECTION_GROUP LEXER world_lexer')
"""


def validate_identifier(value: str, name: str) -> str:
    if not value or len(value) > 128 or ORACLE_IDENTIFIER.fullmatch(value) is None:
        raise ValueError(f"Invalid Oracle identifier for {name}: {value}")
    return value


def validate_json_key(value: str) -> str:
    if not value or ORACLE_IDENTIFIER.fullmatch(value) is None:
        raise ValueError(f"Invalid Oracle JSON metadata key: {value}")
    return value


def text_index_name_for_table(table_name: str) -> str:
    return validate_identifier(f"idx_docs_{table_name}", "text_index_name")


def validate_top_k(value: Any, default: int) -> int:
    if value is None:
        return default
    if isinstance(value, bool):
        raise ValueError(f"top_k must be an integer between 1 and {MAX_TOP_K}.")
    if isinstance(value, int):
        top_k = value
    elif isinstance(value, str) and re.fullmatch(r"\d+", value.strip()):
        top_k = int(value)
    else:
        raise ValueError(f"top_k must be an integer between 1 and {MAX_TOP_K}.")
    if top_k <= 0 or top_k > MAX_TOP_K:
        raise ValueError(f"top_k must be an integer between 1 and {MAX_TOP_K}.")
    return top_k


def validate_document_embeddings(documents: list[Document], embeddings: list[list[float]]) -> int:
    if not documents:
        return 0
    if not embeddings:
        raise ValueError("embeddings must not be empty when documents are provided.")
    if len(documents) != len(embeddings):
        raise ValueError("documents and embeddings must have the same length.")

    try:
        dimension = len(embeddings[0])
    except TypeError as exc:
        raise ValueError("each embedding must be a sequence of numeric values.") from exc

    if dimension <= 0:
        raise ValueError("embeddings must contain at least one dimension.")

    for index, embedding in enumerate(embeddings):
        try:
            embedding_dimension = len(embedding)
        except TypeError as exc:
            raise ValueError(f"embedding at index {index} must be a sequence of numeric values.") from exc
        if embedding_dimension != dimension:
            raise ValueError("all embeddings must have the same dimension.")

    return dimension


def sanitize_oracle_text_token(token: str) -> str | None:
    parts = ORACLE_TEXT_SAFE_TOKEN.findall(str(token))
    if not parts:
        return None
    sanitized = "".join(parts)
    if sanitized.upper() in ORACLE_TEXT_RESERVED_TOKENS:
        return None
    return sanitized


def build_oracle_text_query(tokens: list[str]) -> str | None:
    safe_tokens = []
    seen = set()
    for token in tokens:
        sanitized = sanitize_oracle_text_token(token)
        if not sanitized:
            continue
        normalized = sanitized.casefold()
        if normalized in seen:
            continue
        seen.add(normalized)
        safe_tokens.append(sanitized)

    if not safe_tokens:
        return None
    return " ACCUM ".join(safe_tokens)


def is_oracle_text_parser_error(exc: Exception) -> bool:
    message = str(exc)
    return any(code in message for code in ORACLE_TEXT_PARSER_ERROR_CODES)


def iter_batches(values: list[str], batch_size: int = ORACLE_IN_CLAUSE_BATCH_SIZE):
    for start in range(0, len(values), batch_size):
        yield values[start : start + batch_size]


def parse_metadata_json(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return dict(value)
    if hasattr(value, "read"):
        value = value.read()
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            logger.warning("Unable to parse Oracle metadata JSON: %r", value)
            return {}
        if isinstance(parsed, dict):
            return parsed
    return {}


def metadata_with_primary_key(metadata: dict[str, Any] | None) -> tuple[str, dict[str, Any]]:
    normalized_metadata = dict(metadata or {})
    doc_id = str(normalized_metadata.get("doc_id") or uuid.uuid4())
    normalized_metadata["doc_id"] = doc_id
    return doc_id, normalized_metadata


def extract_english_text_tokens(query: str) -> list[str]:
    try:
        import nltk  # type: ignore
        from nltk.corpus import stopwords  # type: ignore

        try:
            nltk.data.find("tokenizers/punkt")
            nltk.data.find("corpora/stopwords")
        except LookupError:
            logger.warning("NLTK data package punkt or stopwords is unavailable; using regex token fallback.")
            return ORACLE_TEXT_SAFE_TOKEN.findall(query)

        stop_words = set(stopwords.words("english"))
        return [token for token in nltk.word_tokenize(query) if token.casefold() not in stop_words]
    except ImportError:
        logger.warning("NLTK is unavailable; using regex token fallback.")
        return ORACLE_TEXT_SAFE_TOKEN.findall(query)


class OracleVector(BaseVector):
    def __init__(self, collection_name: str, config: OracleVectorConfig):
        super().__init__(collection_name)
        self.table_name = validate_identifier(f"embedding_{collection_name}", "table_name")
        self.text_index_name = text_index_name_for_table(self.table_name)
        self.config = config
        self.pool = self._create_connection_pool(config)

    @override
    def get_type(self) -> str:
        return VectorType.ORACLE

    def numpy_converter_in(self, value):
        if value.dtype == numpy.float64:
            dtype = "d"
        elif value.dtype == numpy.float32:
            dtype = "f"
        else:
            dtype = "b"
        return array.array(dtype, value)

    def input_type_handler(self, cursor, value, arraysize):
        if isinstance(value, numpy.ndarray):
            return cursor.var(
                oracledb.DB_TYPE_VECTOR,
                arraysize=arraysize,
                inconverter=self.numpy_converter_in,
            )

    def numpy_converter_out(self, value):
        if value.typecode == "b":
            return numpy.array(value, copy=False, dtype=numpy.int8)
        elif value.typecode == "f":
            return numpy.array(value, copy=False, dtype=numpy.float32)
        else:
            return numpy.array(value, copy=False, dtype=numpy.float64)

    def output_type_handler(self, cursor, metadata):
        if metadata.type_code is oracledb.DB_TYPE_VECTOR:
            return cursor.var(
                metadata.type_code,
                arraysize=cursor.arraysize,
                outconverter=self.numpy_converter_out,
            )

    @contextmanager
    def _get_connection(self) -> Iterator[Connection]:
        conn = self.pool.acquire()
        try:
            yield conn
        except Exception:
            try:
                conn.rollback()
            except Exception:
                logger.exception("Failed to roll back Oracle pooled connection before release")
            raise
        finally:
            self.pool.release(conn)

    def _create_connection_pool(self, config: OracleVectorConfig):
        pool_params = _OraclePoolParams(
            user=config.user,
            password=config.password,
            dsn=config.dsn,
            min=config.pool_min,
            max=config.pool_max,
            increment=config.pool_increment,
        )
        if config.is_autonomous:
            pool_params["config_dir"] = config.config_dir
            pool_params["wallet_location"] = config.wallet_location
            pool_params["wallet_password"] = config.wallet_password
        return oracledb.create_pool(**pool_params)

    @override
    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        dimension = validate_document_embeddings(texts, embeddings)
        if dimension == 0:
            return []
        self._create_collection(dimension)
        return self.add_texts(texts, embeddings)

    @override
    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        validate_document_embeddings(documents, embeddings)

        values = []
        pks = []
        for i, doc in enumerate(documents):
            doc_id, metadata = metadata_with_primary_key(doc.metadata)
            pks.append(doc_id)
            values.append(
                (
                    doc_id,
                    json.dumps(metadata),
                    # array.array("f", embeddings[i]),
                    numpy.array(embeddings[i]),
                    doc.page_content,
                )
            )
        if not values:
            return pks

        delete_sql = f"DELETE FROM {self.table_name} WHERE id = :1"
        insert_sql = f"INSERT INTO {self.table_name} (id, meta, embedding, text) VALUES (:1, :2, :3, :4)"
        with self._get_connection() as conn:
            conn.inputtypehandler = self.input_type_handler
            conn.outputtypehandler = self.output_type_handler
            with conn.cursor() as cur:
                try:
                    cur.executemany(delete_sql, [(value[0],) for value in values])
                    cur.executemany(insert_sql, values)
                    conn.commit()
                except Exception:
                    if hasattr(conn, "rollback"):
                        conn.rollback()
                    logger.exception("Batch upsert failed into %s; falling back to row upserts", self.table_name)
                    successful_pks = []
                    for value in values:
                        try:
                            cur.execute("SAVEPOINT oracle_vector_row_upsert")
                            cur.execute(delete_sql, (value[0],))
                            cur.execute(insert_sql, value)
                            successful_pks.append(value[0])
                        except Exception:
                            try:
                                cur.execute("ROLLBACK TO SAVEPOINT oracle_vector_row_upsert")
                            except Exception:
                                logger.exception("Failed to roll back row upsert savepoint for %s", value[0])
                            logger.exception("Failed to upsert record %s into %s", value[0], self.table_name)
                    try:
                        conn.commit()
                    except Exception:
                        logger.exception("Failed to commit upserts into %s", self.table_name)
                    return successful_pks
        return pks

    @override
    def text_exists(self, id: str) -> bool:
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(f"SELECT id FROM {self.table_name} WHERE id = :1", (id,))
                return cur.fetchone() is not None

    def get_by_ids(self, ids: list[str]) -> list[Document]:
        if not ids:
            return []
        docs = []
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                for batch in iter_batches(ids):
                    placeholders = ", ".join(f":{i + 1}" for i in range(len(batch)))
                    cur.execute(f"SELECT meta, text FROM {self.table_name} WHERE id IN ({placeholders})", batch)
                    for record in cur:
                        docs.append(Document(page_content=record[1], metadata=parse_metadata_json(record[0])))
        return docs

    @override
    def delete_by_ids(self, ids: list[str]):
        if not ids:
            return
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                for batch in iter_batches(ids):
                    placeholders = ", ".join(f":{i + 1}" for i in range(len(batch)))
                    cur.execute(f"DELETE FROM {self.table_name} WHERE id IN ({placeholders})", batch)
            conn.commit()

    @override
    def delete_by_metadata_field(self, key: str, value: str):
        key = validate_json_key(key)
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(f"DELETE FROM {self.table_name} WHERE JSON_VALUE(meta, '$." + key + "') = :1", (value,))
            conn.commit()

    @override
    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        """
        Search the nearest neighbors to a vector.

        :param query_vector: The input vector to search for similar items.
        :param top_k: The number of nearest neighbors to return, default is 5.
        :return: List of Documents that are nearest to the query vector.
        """
        top_k = validate_top_k(kwargs.get("top_k", 4), 4)

        document_ids_filter = kwargs.get("document_ids_filter")
        where_clause = ""
        params = [numpy.array(query_vector)]

        if document_ids_filter:
            placeholders = ", ".join(f":{i + 2}" for i in range(len(document_ids_filter)))
            where_clause = f"WHERE JSON_VALUE(meta, '$.document_id') IN ({placeholders})"
            params.extend(document_ids_filter)

        with self._get_connection() as conn:
            conn.inputtypehandler = self.input_type_handler
            conn.outputtypehandler = self.output_type_handler
            with conn.cursor() as cur:
                cur.execute(
                    f"""SELECT meta, text, vector_distance(embedding,(select to_vector(:1) from dual),cosine)
                    AS distance FROM {self.table_name}
                    {where_clause} ORDER BY distance fetch first {top_k} rows only""",
                    params,
                )
                docs = []
                score_threshold = float(kwargs.get("score_threshold") or 0.0)
                for record in cur:
                    metadata, text, distance = record
                    score = 1 - distance
                    metadata = parse_metadata_json(metadata)
                    metadata["score"] = score
                    if score >= score_threshold:
                        docs.append(Document(page_content=text, metadata=metadata))
        return docs

    @override
    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        top_k = validate_top_k(kwargs.get("top_k", 5), 5)
        if not query.strip():
            return []

        # Check which language the query is in.
        zh_pattern = re.compile("[\u4e00-\u9fa5]+")
        match = zh_pattern.search(query)
        entities = []
        # If the query has Chinese text, use Jieba; otherwise use NLTK word tokenization.
        if match:
            words = pseg.cut(query)
            current_entity = ""
            for word, pos in words:
                # `nr`: Person, `ns`: Location, `nt`: Organization
                if pos in {"nr", "Ng", "eng", "nz", "n", "ORG", "v"}:
                    current_entity += word
                else:
                    if current_entity:
                        entities.append(current_entity)
                        current_entity = ""
            if current_entity:
                entities.append(current_entity)
        else:
            entities.extend(extract_english_text_tokens(query))

        text_query = build_oracle_text_query(entities)
        if text_query is None:
            return []

        with self._get_connection() as conn:
            with conn.cursor() as cur:
                document_ids_filter = kwargs.get("document_ids_filter")
                where_clause = ""
                params: dict[str, Any] = {"kk": text_query}

                if document_ids_filter:
                    placeholders = []
                    for i, doc_id in enumerate(document_ids_filter):
                        param_name = f"doc_id_{i}"
                        placeholders.append(f":{param_name}")
                        params[param_name] = doc_id
                    where_clause = f" AND JSON_VALUE(meta, '$.document_id') IN ({', '.join(placeholders)}) "

                try:
                    cur.execute(
                        f"""select meta, text, embedding, score(1) FROM {self.table_name}
                    WHERE CONTAINS(text, :kk, 1) > 0  {where_clause}
                    order by score(1) desc fetch first {top_k} rows only""",
                        params,
                    )
                except Exception as exc:
                    if is_oracle_text_parser_error(exc):
                        logger.warning("Oracle Text rejected query %r for %s: %s", text_query, self.table_name, exc)
                        return []
                    raise
                docs = []
                for record in cur:
                    metadata, text, embedding, text_score = record
                    metadata = parse_metadata_json(metadata)
                    metadata["score"] = float(text_score or 0.0) / 100.0
                    docs.append(Document(page_content=text, vector=embedding, metadata=metadata))
        return docs

    @override
    def delete(self):
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(f"DROP TABLE IF EXISTS {self.table_name} cascade constraints")
            conn.commit()

    def _create_collection(self, dimension: int):
        cache_key = f"vector_indexing_{self._collection_name}"
        lock_name = f"{cache_key}_lock"
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = f"vector_indexing_{self._collection_name}"
            if redis_client.get(collection_exist_cache_key):
                return

            with self._get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(SQL_CREATE_TABLE.format(table_name=self.table_name))
                with conn.cursor() as cur:
                    cur.execute(SQL_CREATE_INDEX.format(table_name=self.table_name, index_name=self.text_index_name))
                conn.commit()
                redis_client.set(collection_exist_cache_key, 1, ex=3600)


class OracleVectorFactory(AbstractVectorFactory):
    @override
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> OracleVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.ORACLE, collection_name))

        return OracleVector(
            collection_name=collection_name,
            config=OracleVectorConfig(
                user=dify_config.ORACLE_USER or "system",
                password=dify_config.ORACLE_PASSWORD or "oracle",
                dsn=dify_config.ORACLE_DSN or "oracle:1521/freepdb1",
                config_dir=dify_config.ORACLE_CONFIG_DIR,
                wallet_location=dify_config.ORACLE_WALLET_LOCATION,
                wallet_password=dify_config.ORACLE_WALLET_PASSWORD,
                is_autonomous=dify_config.ORACLE_IS_AUTONOMOUS,
                pool_min=getattr(dify_config, "ORACLE_POOL_MIN", 1),
                pool_max=getattr(dify_config, "ORACLE_POOL_MAX", 5),
                pool_increment=getattr(dify_config, "ORACLE_POOL_INCREMENT", 1),
            ),
        )
