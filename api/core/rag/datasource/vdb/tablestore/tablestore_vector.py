import json
import logging
from typing import Any, Optional

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


class TableStoreConfig(BaseModel):
    access_key_id: Optional[str] = None
    access_key_secret: Optional[str] = None
    instance_name: Optional[str] = None
    endpoint: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict) -> dict:
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
        self._table_name = f"{collection_name}"
        self._index_name = f"{collection_name}_idx"
        self._tags_field = f"{Field.METADATA_KEY.value}_tags"

    def create_collection(self, embeddings: list[list[float]], **kwargs):
        dimension = len(embeddings[0])
        self._create_collection(dimension)

    def get_by_ids(self, ids: list[str]) -> list[Document]:
        docs = []
        request = BatchGetRowRequest()
        columns_to_get = [Field.METADATA_KEY.value, Field.CONTENT_KEY.value]
        rows_to_get = [[("id", _id)] for _id in ids]
        request.add(TableInBatchGetRowItem(self._table_name, rows_to_get, columns_to_get, None, 1))

        result = self._tablestore_client.batch_get_row(request)
        table_result = result.get_result_by_table(self._table_name)
        for item in table_result:
            if item.is_ok and item.row:
                kv = {k: v for k, v, t in item.row.attribute_columns}
                docs.append(
                    Document(
                        page_content=kv[Field.CONTENT_KEY.value], metadata=json.loads(kv[Field.METADATA_KEY.value])
                    )
                )
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
                    Field.CONTENT_KEY.value: documents[i].page_content,
                    Field.VECTOR.value: embeddings[i],
                    Field.METADATA_KEY.value: documents[i].metadata,
                },
            )
        return uuids

    def text_exists(self, id: str) -> bool:
        _, return_row, _ = self._tablestore_client.get_row(
            table_name=self._table_name, primary_key=[("id", id)], columns_to_get=["id"]
        )

        return return_row is not None

    def delete_by_ids(self, ids: list[str]) -> None:
        if not ids:
            return
        for id in ids:
            self._delete_row(id=id)

    def get_ids_by_metadata_field(self, key: str, value: str):
        return self._search_by_metadata(key, value)

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        ids = self.get_ids_by_metadata_field(key, value)
        self.delete_by_ids(ids)

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        top_k = kwargs.get("top_k", 4)
        return self._search_by_vector(query_vector, top_k)

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        return self._search_by_full_text(query)

    def delete(self) -> None:
        self._delete_table_if_exist()

    def _create_collection(self, dimension: int):
        lock_name = f"vector_indexing_lock_{self._collection_name}"
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = f"vector_indexing_{self._collection_name}"
            if redis_client.get(collection_exist_cache_key):
                logging.info(f"Collection {self._collection_name} already exists.")
                return

            self._create_table_if_not_exist()
            self._create_search_index_if_not_exist(dimension)
            redis_client.set(collection_exist_cache_key, 1, ex=3600)

    def _create_table_if_not_exist(self) -> None:
        table_list = self._tablestore_client.list_table()
        if self._table_name in table_list:
            logging.info("Tablestore system table[%s] already exists", self._table_name)
            return None

        schema_of_primary_key = [("id", "STRING")]
        table_meta = tablestore.TableMeta(self._table_name, schema_of_primary_key)
        table_options = tablestore.TableOptions()
        reserved_throughput = tablestore.ReservedThroughput(tablestore.CapacityUnit(0, 0))
        self._tablestore_client.create_table(table_meta, table_options, reserved_throughput)
        logging.info("Tablestore create table[%s] successfully.", self._table_name)

    def _create_search_index_if_not_exist(self, dimension: int) -> None:
        search_index_list = self._tablestore_client.list_search_index(table_name=self._table_name)
        if self._index_name in [t[1] for t in search_index_list]:
            logging.info("Tablestore system index[%s] already exists", self._index_name)
            return None

        field_schemas = [
            tablestore.FieldSchema(
                Field.CONTENT_KEY.value,
                tablestore.FieldType.TEXT,
                analyzer=tablestore.AnalyzerType.MAXWORD,
                index=True,
                enable_sort_and_agg=False,
                store=False,
            ),
            tablestore.FieldSchema(
                Field.VECTOR.value,
                tablestore.FieldType.VECTOR,
                vector_options=tablestore.VectorOptions(
                    data_type=tablestore.VectorDataType.VD_FLOAT_32,
                    dimension=dimension,
                    metric_type=tablestore.VectorMetricType.VM_COSINE,
                ),
            ),
            tablestore.FieldSchema(
                Field.METADATA_KEY.value,
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
        logging.info("Tablestore create system index[%s] successfully.", self._index_name)

    def _delete_table_if_exist(self):
        search_index_list = self._tablestore_client.list_search_index(table_name=self._table_name)
        for resp_tuple in search_index_list:
            self._tablestore_client.delete_search_index(resp_tuple[0], resp_tuple[1])
            logging.info("Tablestore delete index[%s] successfully.", self._index_name)

        self._tablestore_client.delete_table(self._table_name)
        logging.info("Tablestore delete system table[%s] successfully.", self._index_name)

    def _delete_search_index(self) -> None:
        self._tablestore_client.delete_search_index(self._table_name, self._index_name)
        logging.info("Tablestore delete index[%s] successfully.", self._index_name)

    def _write_row(self, primary_key: str, attributes: dict[str, Any]) -> None:
        pk = [("id", primary_key)]

        tags = []
        for key, value in attributes[Field.METADATA_KEY.value].items():
            tags.append(str(key) + "=" + str(value))

        attribute_columns = [
            (Field.CONTENT_KEY.value, attributes[Field.CONTENT_KEY.value]),
            (Field.VECTOR.value, json.dumps(attributes[Field.VECTOR.value])),
            (
                Field.METADATA_KEY.value,
                json.dumps(attributes[Field.METADATA_KEY.value]),
            ),
            (self._tags_field, json.dumps(tags)),
        ]
        row = tablestore.Row(pk, attribute_columns)
        self._tablestore_client.put_row(self._table_name, row)

    def _delete_row(self, id: str) -> None:
        primary_key = [("id", id)]
        row = tablestore.Row(primary_key)
        self._tablestore_client.delete_row(self._table_name, row, None)
        logging.info("Tablestore delete row successfully. id:%s", id)

    def _search_by_metadata(self, key: str, value: str) -> list[str]:
        query = tablestore.SearchQuery(
            tablestore.TermQuery(self._tags_field, str(key) + "=" + str(value)),
            limit=100,
            get_total_count=False,
        )

        search_response = self._tablestore_client.search(
            table_name=self._table_name,
            index_name=self._index_name,
            search_query=query,
            columns_to_get=tablestore.ColumnsToGet(return_type=tablestore.ColumnReturnType.ALL_FROM_INDEX),
        )

        return [row[0][0][1] for row in search_response.rows]

    def _search_by_vector(self, query_vector: list[float], top_k: int) -> list[Document]:
        ots_query = tablestore.KnnVectorQuery(
            field_name=Field.VECTOR.value,
            top_k=top_k,
            float32_query_vector=query_vector,
        )
        sort = tablestore.Sort(sorters=[tablestore.ScoreSort(sort_order=tablestore.SortOrder.DESC)])
        search_query = tablestore.SearchQuery(ots_query, limit=top_k, get_total_count=False, sort=sort)

        search_response = self._tablestore_client.search(
            table_name=self._table_name,
            index_name=self._index_name,
            search_query=search_query,
            columns_to_get=tablestore.ColumnsToGet(return_type=tablestore.ColumnReturnType.ALL_FROM_INDEX),
        )
        logging.info(
            "Tablestore search successfully. request_id:%s",
            search_response.request_id,
        )
        return self._to_query_result(search_response)

    def _to_query_result(self, search_response: tablestore.SearchResponse) -> list[Document]:
        documents = []
        for row in search_response.rows:
            documents.append(
                Document(
                    page_content=row[1][2][1],
                    vector=json.loads(row[1][3][1]),
                    metadata=json.loads(row[1][0][1]),
                )
            )

        return documents

    def _search_by_full_text(self, query: str) -> list[Document]:
        search_query = tablestore.SearchQuery(
            query=tablestore.MatchQuery(text=query, field_name=Field.CONTENT_KEY.value),
            sort=tablestore.Sort(sorters=[tablestore.ScoreSort(sort_order=tablestore.SortOrder.DESC)]),
            limit=100,
        )
        search_response = self._tablestore_client.search(
            table_name=self._table_name,
            index_name=self._index_name,
            search_query=search_query,
            columns_to_get=tablestore.ColumnsToGet(return_type=tablestore.ColumnReturnType.ALL_FROM_INDEX),
        )

        return self._to_query_result(search_response)


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
            ),
        )
