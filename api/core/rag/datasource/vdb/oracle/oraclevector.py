import array
import json
import re
import uuid
from contextlib import contextmanager
from typing import Any

import jieba.posseg as pseg
import nltk
import numpy
import oracledb
from nltk.corpus import stopwords
from pydantic import BaseModel, model_validator

from configs import dify_config
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

oracledb.defaults.fetch_lobs = False


class OracleVectorConfig(BaseModel):
    host: str
    port: int
    user: str
    password: str
    database: str

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict) -> dict:
        if not values["host"]:
            raise ValueError("config ORACLE_HOST is required")
        if not values["port"]:
            raise ValueError("config ORACLE_PORT is required")
        if not values["user"]:
            raise ValueError("config ORACLE_USER is required")
        if not values["password"]:
            raise ValueError("config ORACLE_PASSWORD is required")
        if not values["database"]:
            raise ValueError("config ORACLE_DB is required")
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
('FILTER CTXSYS.NULL_FILTER SECTION GROUP CTXSYS.HTML_SECTION_GROUP LEXER sys.my_chinese_vgram_lexer')
"""


class OracleVector(BaseVector):
    def __init__(self, collection_name: str, config: OracleVectorConfig):
        super().__init__(collection_name)
        self.pool = self._create_connection_pool(config)
        self.table_name = f"embedding_{collection_name}"

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
            dtype = numpy.int8
        elif value.typecode == "f":
            dtype = numpy.float32
        else:
            dtype = numpy.float64
        return numpy.array(value, copy=False, dtype=dtype)

    def output_type_handler(self, cursor, metadata):
        if metadata.type_code is oracledb.DB_TYPE_VECTOR:
            return cursor.var(
                metadata.type_code,
                arraysize=cursor.arraysize,
                outconverter=self.numpy_converter_out,
            )

    def _create_connection_pool(self, config: OracleVectorConfig):
        return oracledb.create_pool(
            user=config.user,
            password=config.password,
            dsn="{}:{}/{}".format(config.host, config.port, config.database),
            min=1,
            max=50,
            increment=1,
        )

    @contextmanager
    def _get_cursor(self):
        conn = self.pool.acquire()
        conn.inputtypehandler = self.input_type_handler
        conn.outputtypehandler = self.output_type_handler
        cur = conn.cursor()
        try:
            yield cur
        finally:
            cur.close()
            conn.commit()
            conn.close()

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        dimension = len(embeddings[0])
        self._create_collection(dimension)
        return self.add_texts(texts, embeddings)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        values = []
        pks = []
        for i, doc in enumerate(documents):
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
        # print(f"INSERT INTO {self.table_name} (id, text, meta, embedding) VALUES (:1, :2, :3, :4)")
        with self._get_cursor() as cur:
            cur.executemany(
                f"INSERT INTO {self.table_name} (id, text, meta, embedding) VALUES (:1, :2, :3, :4)", values
            )
        return pks

    def text_exists(self, id: str) -> bool:
        with self._get_cursor() as cur:
            cur.execute(f"SELECT id FROM {self.table_name} WHERE id = '%s'" % (id,))
            return cur.fetchone() is not None

    def get_by_ids(self, ids: list[str]) -> list[Document]:
        with self._get_cursor() as cur:
            cur.execute(f"SELECT meta, text FROM {self.table_name} WHERE id IN %s", (tuple(ids),))
            docs = []
            for record in cur:
                docs.append(Document(page_content=record[1], metadata=record[0]))
        return docs

    def delete_by_ids(self, ids: list[str]) -> None:
        with self._get_cursor() as cur:
            cur.execute(f"DELETE FROM {self.table_name} WHERE id IN %s" % (tuple(ids),))

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        with self._get_cursor() as cur:
            cur.execute(f"DELETE FROM {self.table_name} WHERE meta->>%s = %s", (key, value))

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        """
        Search the nearest neighbors to a vector.

        :param query_vector: The input vector to search for similar items.
        :param top_k: The number of nearest neighbors to return, default is 5.
        :return: List of Documents that are nearest to the query vector.
        """
        top_k = kwargs.get("top_k", 4)
        with self._get_cursor() as cur:
            cur.execute(
                f"SELECT meta, text, vector_distance(embedding,:1) AS distance FROM {self.table_name}"
                f" ORDER BY distance fetch first {top_k} rows only",
                [numpy.array(query_vector)],
            )
            docs = []
            score_threshold = float(kwargs.get("score_threshold") or 0.0)
            for record in cur:
                metadata, text, distance = record
                score = 1 - distance
                metadata["score"] = score
                if score > score_threshold:
                    docs.append(Document(page_content=text, metadata=metadata))
        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        top_k = kwargs.get("top_k", 5)
        # just not implement fetch by score_threshold now, may be later
        score_threshold = float(kwargs.get("score_threshold") or 0.0)
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
                    if pos in {"nr", "Ng", "eng", "nz", "n", "ORG", "v"}:  # nr: 人名, ns: 地名, nt: 机构名
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
                    print("run download")
                e_str = re.sub(r"[^\w ]", "", query)
                all_tokens = nltk.word_tokenize(e_str)
                stop_words = stopwords.words("english")
                for token in all_tokens:
                    if token not in stop_words:
                        entities.append(token)
            with self._get_cursor() as cur:
                cur.execute(
                    f"select meta, text, embedding FROM {self.table_name}"
                    f" WHERE CONTAINS(text, :1, 1) > 0 order by score(1) desc fetch first {top_k} rows only",
                    [" ACCUM ".join(entities)],
                )
                docs = []
                for record in cur:
                    metadata, text, embedding = record
                    docs.append(Document(page_content=text, vector=embedding, metadata=metadata))
            return docs
        else:
            return [Document(page_content="", metadata={})]
        return []

    def delete(self) -> None:
        with self._get_cursor() as cur:
            cur.execute(f"DROP TABLE IF EXISTS {self.table_name} cascade constraints")

    def _create_collection(self, dimension: int):
        cache_key = f"vector_indexing_{self._collection_name}"
        lock_name = f"{cache_key}_lock"
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = f"vector_indexing_{self._collection_name}"
            if redis_client.get(collection_exist_cache_key):
                return

            with self._get_cursor() as cur:
                cur.execute(SQL_CREATE_TABLE.format(table_name=self.table_name))
            redis_client.set(collection_exist_cache_key, 1, ex=3600)
            with self._get_cursor() as cur:
                cur.execute(SQL_CREATE_INDEX.format(table_name=self.table_name))


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
                host=dify_config.ORACLE_HOST,
                port=dify_config.ORACLE_PORT,
                user=dify_config.ORACLE_USER,
                password=dify_config.ORACLE_PASSWORD,
                database=dify_config.ORACLE_DATABASE,
            ),
        )
