import json
import logging
import math
from collections.abc import Iterable
from typing import Any

import tablestore  # type: ignore
from pydantic import BaseModel, model_validator
from tablestore import BatchGetRowRequest, TableInBatchGetRowItem

from configs import dify_config
from core.rag.datasource.vdb.field import Field
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models import Dataset

logger = logging.getLogger(__name__)


class TableStoreConfig(BaseModel):
    access_key_id: str | None = None
    access_key_secret: str | None = None
    instance_name: str | None = None
    endpoint: str | None = None
    normalize_full_text_bm25_score: bool | None = False

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict):
        if not values["access_key_id"]:
            raise ValueError("config ACCESS_KEY_ID is required")
        if not values["access_key_secret"]:
            raise ValueError("config ACCESS_KEY_SECRET is required")
        if not values["instance_name"]:
            raise ValueError("config INSTANCE_NAME is required")
        if not values["endpoint"]:
            raise ValueError("config ENDPOINT is required")
        return values


class TableStoreVector(BaseVector):
    def __init__(self, collection_name: str, config: TableStoreConfig):
        super().__init__(collection_name)
        self._config = config
        self._tablestore_client = tablestore.OTSClient(
            config.endpoint,
            config.access_key_id,
            config.access_key_secret,
            config.instance_name,
        )
        self._normalize_full_text_bm25_score = config.normalize_full_text_bm25_score
        self._table_name = f"{collection_name}"
        self._index_name = f"{collection_name}_idx"
        self._tags_field = f"{Field.METADATA_KEY}_tags"

    def create_collection(self, embeddings: list[list[float]], **kwargs):
        dimension = len(embeddings[0])
        self._create_collection(dimension)

    def get_by_ids(self, ids: list[str]) -> list[Document]:
        docs = []
        request = BatchGetRowRequest()
        columns_to_get = [Field.METADATA_KEY, Field.CONTENT_KEY]
        rows_to_get = [[("id", _id)] for _id in ids]
        request.add(TableInBatchGetRowItem(self._table_name, rows_to_get, columns_to_get, None, 1))

        result = self._tablestore_client.batch_get_row(request)
        table_result = result.get_result_by_table(self._table_name)
        for item in table_result:
            if item.is_ok and item.row:
                kv = {k: v for k, v, _ in item.row.attribute_columns}
                docs.append(Document(page_content=kv[Field.CONTENT_KEY], metadata=json.loads(kv[Field.METADATA_KEY])))
        return docs

    def get_type(self) -> str:
        return VectorType.TABLESTORE

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        dimension = len(embeddings[0])
        self._create_collection(dimension)
        self.add_texts(documents=texts, embeddings=embeddings, **kwargs)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        uuids = self._get_uuids(documents)

        for i in range(len(documents)):
            self._write_row(
                primary_key=uuids[i],
                attributes={
                    Field.CONTENT_KEY: documents[i].page_content,
                    Field.VECTOR: embeddings[i],
                    Field.METADATA_KEY: documents[i].metadata,
                },
            )
        return uuids

    def text_exists(self, id: str) -> bool:
        result = self._tablestore_client.get_row(
            table_name=self._table_name, primary_key=[("id", id)], columns_to_get=["id"]
        )
        assert isinstance(result, tuple | list)
        # Unpack the tuple result
        _, return_row, _ = result

        return return_row is not None

    def delete_by_ids(self, ids: list[str]):
        if not ids:
            return
        for id in ids:
            self._delete_row(id=id)

    def get_ids_by_metadata_field(self, key: str, value: str):
        return self._search_by_metadata(key, value)

    def delete_by_metadata_field(self, key: str, value: str):
        ids = self.get_ids_by_metadata_field(key, value)
        self.delete_by_ids(ids)

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        top_k = kwargs.get("top_k", 4)
        document_ids_filter = kwargs.get("document_ids_filter")
        filtered_list = None
        if document_ids_filter:
            filtered_list = ["document_id=" + item for item in document_ids_filter]
        score_threshold = float(kwargs.get("score_threshold") or 0.0)
        return self._search_by_vector(query_vector, filtered_list, top_k, score_threshold)

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        top_k = kwargs.get("top_k", 4)
        document_ids_filter = kwargs.get("document_ids_filter")
        filtered_list = None
        if document_ids_filter:
            filtered_list = ["document_id=" + item for item in document_ids_filter]
        score_threshold = float(kwargs.get("score_threshold") or 0.0)
        return self._search_by_full_text(query, filtered_list, top_k, score_threshold)

    def delete(self):
        self._delete_table_if_exist()

    def _create_collection(self, dimension: int):
        lock_name = f"vector_indexing_lock_{self._collection_name}"
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = f"vector_indexing_{self._collection_name}"
            if redis_client.get(collection_exist_cache_key):
                logger.info("Collection %s already exists.", self._collection_name)
                return

            self._create_table_if_not_exist()
            self._create_search_index_if_not_exist(dimension)
            redis_client.set(collection_exist_cache_key, 1, ex=3600)

    def _create_table_if_not_exist(self):
        table_list = self._tablestore_client.list_table()
        if self._table_name in table_list:
            logger.info("Tablestore system table[%s] already exists", self._table_name)
            return None

        schema_of_primary_key = [("id", "STRING")]
        table_meta = tablestore.TableMeta(self._table_name, schema_of_primary_key)
        table_options = tablestore.TableOptions()
        reserved_throughput = tablestore.ReservedThroughput(tablestore.CapacityUnit(0, 0))
        self._tablestore_client.create_table(table_meta, table_options, reserved_throughput)
        logger.info("Tablestore create table[%s] successfully.", self._table_name)

    def _create_search_index_if_not_exist(self, dimension: int):
        search_index_list = self._tablestore_client.list_search_index(table_name=self._table_name)
        assert isinstance(search_index_list, Iterable)
        if self._index_name in [t[1] for t in search_index_list]:
            logger.info("Tablestore system index[%s] already exists", self._index_name)
            return None

        field_schemas = [
            tablestore.FieldSchema(
                Field.CONTENT_KEY,
                tablestore.FieldType.TEXT,
                analyzer=tablestore.AnalyzerType.MAXWORD,
                index=True,
                enable_sort_and_agg=False,
                store=False,
            ),
            tablestore.FieldSchema(
                Field.VECTOR,
                tablestore.FieldType.VECTOR,
                vector_options=tablestore.VectorOptions(
                    data_type=tablestore.VectorDataType.VD_FLOAT_32,
                    dimension=dimension,
                    metric_type=tablestore.VectorMetricType.VM_COSINE,
                ),
            ),
            tablestore.FieldSchema(
                Field.METADATA_KEY,
                tablestore.FieldType.KEYWORD,
                index=True,
                store=False,
            ),
            tablestore.FieldSchema(
                self._tags_field,
                tablestore.FieldType.KEYWORD,
                index=True,
                store=False,
                is_array=True,
            ),
        ]

        index_meta = tablestore.SearchIndexMeta(field_schemas)
        self._tablestore_client.create_search_index(self._table_name, self._index_name, index_meta)
        logger.info("Tablestore create system index[%s] successfully.", self._index_name)

    def _delete_table_if_exist(self):
        search_index_list = self._tablestore_client.list_search_index(table_name=self._table_name)
        assert isinstance(search_index_list, Iterable)
        for resp_tuple in search_index_list:
            self._tablestore_client.delete_search_index(resp_tuple[0], resp_tuple[1])
            logger.info("Tablestore delete index[%s] successfully.", self._index_name)

        self._tablestore_client.delete_table(self._table_name)
        logger.info("Tablestore delete system table[%s] successfully.", self._index_name)

    def _delete_search_index(self):
        self._tablestore_client.delete_search_index(self._table_name, self._index_name)
        logger.info("Tablestore delete index[%s] successfully.", self._index_name)

    def _write_row(self, primary_key: str, attributes: dict[str, Any]):
        pk = [("id", primary_key)]

        tags = []
        for key, value in attributes[Field.METADATA_KEY].items():
            tags.append(str(key) + "=" + str(value))

        attribute_columns = [
            (Field.CONTENT_KEY, attributes[Field.CONTENT_KEY]),
            (Field.VECTOR, json.dumps(attributes[Field.VECTOR])),
            (
                Field.METADATA_KEY,
                json.dumps(attributes[Field.METADATA_KEY]),
            ),
            (self._tags_field, json.dumps(tags)),
        ]
        row = tablestore.Row(pk, attribute_columns)
        self._tablestore_client.put_row(self._table_name, row)

    def _delete_row(self, id: str):
        primary_key = [("id", id)]
        row = tablestore.Row(primary_key)
        self._tablestore_client.delete_row(self._table_name, row, None)

    def _search_by_metadata(self, key: str, value: str) -> list[str]:
        query = tablestore.SearchQuery(
            tablestore.TermQuery(self._tags_field, str(key) + "=" + str(value)),
            limit=1000,
            get_total_count=False,
        )
        rows: list[str] = []
        next_token = None
        while True:
            if next_token is not None:
                query.next_token = next_token

            search_response = self._tablestore_client.search(
                table_name=self._table_name,
                index_name=self._index_name,
                search_query=query,
                columns_to_get=tablestore.ColumnsToGet(
                    column_names=[Field.PRIMARY_KEY], return_type=tablestore.ColumnReturnType.SPECIFIED
                ),
            )

            if search_response is not None:
                rows.extend([row[0][0][1] for row in list(search_response.rows)])

            if search_response is None or search_response.next_token == b"":
                break
            else:
                next_token = search_response.next_token

        return rows

    def _search_by_vector(
        self, query_vector: list[float], document_ids_filter: list[str] | None, top_k: int, score_threshold: float
    ) -> list[Document]:
        knn_vector_query = tablestore.KnnVectorQuery(
            field_name=Field.VECTOR,
            top_k=top_k,
            float32_query_vector=query_vector,
        )
        if document_ids_filter:
            knn_vector_query.filter = tablestore.TermsQuery(self._tags_field, document_ids_filter)

        sort = tablestore.Sort(sorters=[tablestore.ScoreSort(sort_order=tablestore.SortOrder.DESC)])
        search_query = tablestore.SearchQuery(knn_vector_query, limit=top_k, get_total_count=False, sort=sort)

        search_response = self._tablestore_client.search(
            table_name=self._table_name,
            index_name=self._index_name,
            search_query=search_query,
            columns_to_get=tablestore.ColumnsToGet(return_type=tablestore.ColumnReturnType.ALL_FROM_INDEX),
        )
        documents = []
        for search_hit in search_response.search_hits:
            if search_hit.score >= score_threshold:
                ots_column_map = {}
                for col in search_hit.row[1]:
                    ots_column_map[col[0]] = col[1]

                vector_str = ots_column_map.get(Field.VECTOR)
                metadata_str = ots_column_map.get(Field.METADATA_KEY)

                vector = json.loads(vector_str) if vector_str else None
                metadata = json.loads(metadata_str) if metadata_str else {}

                metadata["score"] = search_hit.score

                documents.append(
                    Document(
                        page_content=ots_column_map.get(Field.CONTENT_KEY) or "",
                        vector=vector,
                        metadata=metadata,
                    )
                )
        documents = sorted(documents, key=lambda x: x.metadata["score"] if x.metadata else 0, reverse=True)
        return documents

    @staticmethod
    def _normalize_score_exp_decay(score: float, k: float = 0.15) -> float:
        """
        Args:
            score: BM25 search score.
            k: decay factor, the larger the k, the steeper the low score end
        """
        normalized_score = 1 - math.exp(-k * score)
        return max(0.0, min(1.0, normalized_score))

    def _search_by_full_text(
        self, query: str, document_ids_filter: list[str] | None, top_k: int, score_threshold: float
    ) -> list[Document]:
        bool_query = tablestore.BoolQuery(must_queries=[], filter_queries=[], should_queries=[], must_not_queries=[])
        bool_query.must_queries.append(tablestore.MatchQuery(text=query, field_name=Field.CONTENT_KEY))

        if document_ids_filter:
            bool_query.filter_queries.append(tablestore.TermsQuery(self._tags_field, document_ids_filter))

        search_query = tablestore.SearchQuery(
            query=bool_query,
            sort=tablestore.Sort(sorters=[tablestore.ScoreSort(sort_order=tablestore.SortOrder.DESC)]),
            limit=top_k,
        )
        search_response = self._tablestore_client.search(
            table_name=self._table_name,
            index_name=self._index_name,
            search_query=search_query,
            columns_to_get=tablestore.ColumnsToGet(return_type=tablestore.ColumnReturnType.ALL_FROM_INDEX),
        )

        documents = []
        for search_hit in search_response.search_hits:
            score = None
            if self._normalize_full_text_bm25_score:
                score = self._normalize_score_exp_decay(search_hit.score)

            # skip when score is below threshold and use normalize score
            if score and score <= score_threshold:
                continue

            ots_column_map = {}
            for col in search_hit.row[1]:
                ots_column_map[col[0]] = col[1]

            metadata_str = ots_column_map.get(Field.METADATA_KEY)
            metadata = json.loads(metadata_str) if metadata_str else {}

            vector_str = ots_column_map.get(Field.VECTOR)
            vector = json.loads(vector_str) if vector_str else None

            if score:
                metadata["score"] = score

            documents.append(
                Document(
                    page_content=ots_column_map.get(Field.CONTENT_KEY) or "",
                    vector=vector,
                    metadata=metadata,
                )
            )
        if self._normalize_full_text_bm25_score:
            documents = sorted(documents, key=lambda x: x.metadata["score"] if x.metadata else 0, reverse=True)
        return documents


class TableStoreVectorFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> TableStoreVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.TABLESTORE, collection_name))

        return TableStoreVector(
            collection_name=collection_name,
            config=TableStoreConfig(
                endpoint=dify_config.TABLESTORE_ENDPOINT,
                instance_name=dify_config.TABLESTORE_INSTANCE_NAME,
                access_key_id=dify_config.TABLESTORE_ACCESS_KEY_ID,
                access_key_secret=dify_config.TABLESTORE_ACCESS_KEY_SECRET,
                normalize_full_text_bm25_score=dify_config.TABLESTORE_NORMALIZE_FULLTEXT_BM25_SCORE,
            ),
        )
