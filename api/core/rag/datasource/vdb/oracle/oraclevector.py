import array
import json
import logging
import re
import uuid
from typing import Any

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


class OracleVectorConfig(BaseModel):
    user: str
    password: str
    dsn: str
    config_dir: str | None = None
    wallet_location: str | None = None
    wallet_password: str | None = None
    is_autonomous: bool = False

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict):
        if not values["user"]:
            raise ValueError("config ORACLE_USER is required")
        if not values["password"]:
            raise ValueError("config ORACLE_PASSWORD is required")
        if not values["dsn"]:
            raise ValueError("config ORACLE_DSN is required")
        if values.get("is_autonomous", False):
            if not values.get("config_dir"):
                raise ValueError("config_dir is required for autonomous database")
            if not values.get("wallet_location"):
                raise ValueError("wallet_location is required for autonomous database")
            if not values.get("wallet_password"):
                raise ValueError("wallet_password is required for autonomous database")
        return values


SQL_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS {table_name} (
    id varchar2(100)
    ,text CLOB NOT NULL
    ,meta JSON
    ,embedding vector NOT NULL
)
"""
SQL_CREATE_INDEX = """
CREATE INDEX IF NOT EXISTS idx_docs_{table_name} ON {table_name}(text)
INDEXTYPE IS CTXSYS.CONTEXT PARAMETERS
('FILTER CTXSYS.NULL_FILTER SECTION GROUP CTXSYS.HTML_SECTION_GROUP LEXER world_lexer')
"""


class OracleVector(BaseVector):
    def __init__(self, collection_name: str, config: OracleVectorConfig):
        super().__init__(collection_name)
        self.pool = self._create_connection_pool(config)
        self.table_name = f"embedding_{collection_name}"
        self.config = config

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

    def _get_connection(self) -> Connection:
        if self.config.is_autonomous:
            connection = oracledb.connect(
                user=self.config.user,
                password=self.config.password,
                dsn=self.config.dsn,
                config_dir=self.config.config_dir,
                wallet_location=self.config.wallet_location,
                wallet_password=self.config.wallet_password,
            )
            return connection
        else:
            connection = oracledb.connect(user=self.config.user, password=self.config.password, dsn=self.config.dsn)
            return connection

    def _create_connection_pool(self, config: OracleVectorConfig):
        pool_params = {
            "user": config.user,
            "password": config.password,
            "dsn": config.dsn,
            "min": 1,
            "max": 5,
            "increment": 1,
        }
        if config.is_autonomous:
            pool_params.update(
                {
                    "config_dir": config.config_dir,
                    "wallet_location": config.wallet_location,
                    "wallet_password": config.wallet_password,
                }
            )
        return oracledb.create_pool(**pool_params)

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        dimension = len(embeddings[0])
        self._create_collection(dimension)
        return self.add_texts(texts, embeddings)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        values = []
        pks = []
        for i, doc in enumerate(documents):
            if doc.metadata is not None:
                doc_id = doc.metadata.get("doc_id", str(uuid.uuid4()))
                pks.append(doc_id)
                values.append(
                    (
                        doc_id,
                        doc.page_content,
                        json.dumps(doc.metadata),
                        # array.array("f", embeddings[i]),
                        numpy.array(embeddings[i]),
                    )
                )
        with self._get_connection() as conn:
            conn.inputtypehandler = self.input_type_handler
            conn.outputtypehandler = self.output_type_handler
            # with conn.cursor() as cur:
            #    cur.executemany(
            #        f"INSERT INTO {self.table_name} (id, text, meta, embedding) VALUES (:1, :2, :3, :4)", values
            #    )
            # conn.commit()
            for value in values:
                with conn.cursor() as cur:
                    try:
                        cur.execute(
                            f"""INSERT INTO {self.table_name} (id, text, meta, embedding)
                        VALUES (:1, :2, :3, :4)""",
                            value,
                        )
                        conn.commit()
                    except Exception:
                        logger.exception("Failed to insert record %s into %s", value[0], self.table_name)
            conn.close()
        return pks

    def text_exists(self, id: str) -> bool:
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(f"SELECT id FROM {self.table_name} WHERE id = :1", (id,))
                return cur.fetchone() is not None
            conn.close()

    def get_by_ids(self, ids: list[str]) -> list[Document]:
        if not ids:
            return []
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                placeholders = ", ".join(f":{i + 1}" for i in range(len(ids)))
                cur.execute(f"SELECT meta, text FROM {self.table_name} WHERE id IN ({placeholders})", ids)
                docs = []
                for record in cur:
                    docs.append(Document(page_content=record[1], metadata=record[0]))
            self.pool.release(connection=conn)
            conn.close()
        return docs

    def delete_by_ids(self, ids: list[str]):
        if not ids:
            return
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                placeholders = ", ".join(f":{i + 1}" for i in range(len(ids)))
                cur.execute(f"DELETE FROM {self.table_name} WHERE id IN ({placeholders})", ids)
            conn.commit()
            conn.close()

    def delete_by_metadata_field(self, key: str, value: str):
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(f"DELETE FROM {self.table_name} WHERE JSON_VALUE(meta, '$." + key + "') = :1", (value,))
            conn.commit()
            conn.close()

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        """
        Search the nearest neighbors to a vector.

        :param query_vector: The input vector to search for similar items.
        :param top_k: The number of nearest neighbors to return, default is 5.
        :return: List of Documents that are nearest to the query vector.
        """
        # Validate and sanitize top_k to prevent SQL injection
        top_k = kwargs.get("top_k", 4)
        if not isinstance(top_k, int) or top_k <= 0 or top_k > 10000:
            top_k = 4  # Use default if invalid

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
                    metadata["score"] = score
                    if score >= score_threshold:
                        docs.append(Document(page_content=text, metadata=metadata))
            conn.close()
        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        # lazy import
        import nltk  # type: ignore
        from nltk.corpus import stopwords  # type: ignore

        # Validate and sanitize top_k to prevent SQL injection
        top_k = kwargs.get("top_k", 5)
        if not isinstance(top_k, int) or top_k <= 0 or top_k > 10000:
            top_k = 5  # Use default if invalid
        # just not implement fetch by score_threshold now, may be later
        if len(query) > 0:
            # Check which language the query is in
            zh_pattern = re.compile("[\u4e00-\u9fa5]+")
            match = zh_pattern.search(query)
            entities = []
            #  match: query condition maybe is a chinese sentence, so using Jieba split,else using nltk split
            if match:
                words = pseg.cut(query)
                current_entity = ""
                for word, pos in words:
                    if pos in {"nr", "Ng", "eng", "nz", "n", "ORG", "v"}:  # nr: 人名，ns: 地名，nt: 机构名
                        current_entity += word
                    else:
                        if current_entity:
                            entities.append(current_entity)
                            current_entity = ""
                if current_entity:
                    entities.append(current_entity)
            else:
                try:
                    nltk.data.find("tokenizers/punkt")
                    nltk.data.find("corpora/stopwords")
                except LookupError:
                    nltk.download("punkt")
                    nltk.download("stopwords")
                e_str = re.sub(r"[^\w ]", "", query)
                all_tokens = nltk.word_tokenize(e_str)
                stop_words = stopwords.words("english")
                for token in all_tokens:
                    if token not in stop_words:
                        entities.append(token)
            with self._get_connection() as conn:
                with conn.cursor() as cur:
                    document_ids_filter = kwargs.get("document_ids_filter")
                    where_clause = ""
                    params: dict[str, Any] = {"kk": " ACCUM ".join(entities)}

                    if document_ids_filter:
                        placeholders = []
                        for i, doc_id in enumerate(document_ids_filter):
                            param_name = f"doc_id_{i}"
                            placeholders.append(f":{param_name}")
                            params[param_name] = doc_id
                        where_clause = f" AND JSON_VALUE(meta, '$.document_id') IN ({', '.join(placeholders)}) "

                    cur.execute(
                        f"""select meta, text, embedding FROM {self.table_name}
                    WHERE CONTAINS(text, :kk, 1) > 0  {where_clause}
                    order by score(1) desc fetch first {top_k} rows only""",
                        params,
                    )
                    docs = []
                    for record in cur:
                        metadata, text, embedding = record
                        docs.append(Document(page_content=text, vector=embedding, metadata=metadata))
                conn.close()
            return docs
        else:
            return [Document(page_content="", metadata={})]

    def delete(self):
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(f"DROP TABLE IF EXISTS {self.table_name} cascade constraints")
            conn.commit()
            conn.close()

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
                redis_client.set(collection_exist_cache_key, 1, ex=3600)
                with conn.cursor() as cur:
                    cur.execute(SQL_CREATE_INDEX.format(table_name=self.table_name))
                conn.commit()
                conn.close()


class OracleVectorFactory(AbstractVectorFactory):
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
            ),
        )
