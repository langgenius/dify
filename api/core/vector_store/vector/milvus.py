"""Wrapper around the Milvus vector database."""
from __future__ import annotations

import logging
from collections.abc import Iterable, Sequence
from typing import Any, Optional, Union
from uuid import uuid4

import numpy as np
from langchain.docstore.document import Document
from langchain.embeddings.base import Embeddings
from langchain.vectorstores.base import VectorStore
from langchain.vectorstores.utils import maximal_marginal_relevance

logger = logging.getLogger(__name__)

DEFAULT_MILVUS_CONNECTION = {
    "host": "localhost",
    "port": "19530",
    "user": "",
    "password": "",
    "secure": False,
}


class Milvus(VectorStore):
    """Initialize wrapper around the milvus vector database.

    In order to use this you need to have `pymilvus` installed and a
    running Milvus

    See the following documentation for how to run a Milvus instance:
    https://milvus.io/docs/install_standalone-docker.md

    If looking for a hosted Milvus, take a look at this documentation:
    https://zilliz.com/cloud and make use of the Zilliz vectorstore found in
    this project,

    IF USING L2/IP metric IT IS HIGHLY SUGGESTED TO NORMALIZE YOUR DATA.

    Args:
        embedding_function (Embeddings): Function used to embed the text.
        collection_name (str): Which Milvus collection to use. Defaults to
            "LangChainCollection".
        connection_args (Optional[dict[str, any]]): The connection args used for
            this class comes in the form of a dict.
        consistency_level (str): The consistency level to use for a collection.
            Defaults to "Session".
        index_params (Optional[dict]): Which index params to use. Defaults to
            HNSW/AUTOINDEX depending on service.
        search_params (Optional[dict]): Which search params to use. Defaults to
            default of index.
        drop_old (Optional[bool]): Whether to drop the current collection. Defaults
            to False.

    The connection args used for this class comes in the form of a dict,
    here are a few of the options:
        address (str): The actual address of Milvus
            instance. Example address: "localhost:19530"
        uri (str): The uri of Milvus instance. Example uri:
            "http://randomwebsite:19530",
            "tcp:foobarsite:19530",
            "https://ok.s3.south.com:19530".
        host (str): The host of Milvus instance. Default at "localhost",
            PyMilvus will fill in the default host if only port is provided.
        port (str/int): The port of Milvus instance. Default at 19530, PyMilvus
            will fill in the default port if only host is provided.
        user (str): Use which user to connect to Milvus instance. If user and
            password are provided, we will add related header in every RPC call.
        password (str): Required when user is provided. The password
            corresponding to the user.
        secure (bool): Default is false. If set to true, tls will be enabled.
        client_key_path (str): If use tls two-way authentication, need to
            write the client.key path.
        client_pem_path (str): If use tls two-way authentication, need to
            write the client.pem path.
        ca_pem_path (str): If use tls two-way authentication, need to write
            the ca.pem path.
        server_pem_path (str): If use tls one-way authentication, need to
            write the server.pem path.
        server_name (str): If use tls, need to write the common name.

    Example:
        .. code-block:: python

        from langchain import Milvus
        from langchain.embeddings import OpenAIEmbeddings

        embedding = OpenAIEmbeddings()
        # Connect to a milvus instance on localhost
        milvus_store = Milvus(
            embedding_function = Embeddings,
            collection_name = "LangChainCollection",
            drop_old = True,
        )

    Raises:
        ValueError: If the pymilvus python package is not installed.
    """

    def __init__(
        self,
        embedding_function: Embeddings,
        collection_name: str = "LangChainCollection",
        connection_args: Optional[dict[str, Any]] = None,
        consistency_level: str = "Session",
        index_params: Optional[dict] = None,
        search_params: Optional[dict] = None,
        drop_old: Optional[bool] = False,
    ):
        """Initialize the Milvus vector store."""
        try:
            from pymilvus import Collection, utility
        except ImportError:
            raise ValueError(
                "Could not import pymilvus python package. "
                "Please install it with `pip install pymilvus`."
            )

        # Default search params when one is not provided.
        self.default_search_params = {
            "IVF_FLAT": {"metric_type": "L2", "params": {"nprobe": 10}},
            "IVF_SQ8": {"metric_type": "L2", "params": {"nprobe": 10}},
            "IVF_PQ": {"metric_type": "L2", "params": {"nprobe": 10}},
            "HNSW": {"metric_type": "L2", "params": {"ef": 10}},
            "RHNSW_FLAT": {"metric_type": "L2", "params": {"ef": 10}},
            "RHNSW_SQ": {"metric_type": "L2", "params": {"ef": 10}},
            "RHNSW_PQ": {"metric_type": "L2", "params": {"ef": 10}},
            "IVF_HNSW": {"metric_type": "L2", "params": {"nprobe": 10, "ef": 10}},
            "ANNOY": {"metric_type": "L2", "params": {"search_k": 10}},
            "AUTOINDEX": {"metric_type": "L2", "params": {}},
        }

        self.embedding_func = embedding_function
        self.collection_name = collection_name
        self.index_params = index_params
        self.search_params = search_params
        self.consistency_level = consistency_level

        # In order for a collection to be compatible, pk needs to be auto'id and int
        self._primary_field = "id"
        # In order for compatibility, the text field will need to be called "text"
        self._text_field = "page_content"
        # In order for compatibility, the vector field needs to be called "vector"
        self._vector_field = "vectors"
        # In order for compatibility, the metadata field will need to be called "metadata"
        self._metadata_field = "metadata"
        self.fields: list[str] = []
        # Create the connection to the server
        if connection_args is None:
            connection_args = DEFAULT_MILVUS_CONNECTION
        self.alias = self._create_connection_alias(connection_args)
        self.col: Optional[Collection] = None

        # Grab the existing collection if it exists
        if utility.has_collection(self.collection_name, using=self.alias):
            self.col = Collection(
                self.collection_name,
                using=self.alias,
            )
        # If need to drop old, drop it
        if drop_old and isinstance(self.col, Collection):
            self.col.drop()
            self.col = None

        # Initialize the vector store
        self._init()

    @property
    def embeddings(self) -> Embeddings:
        return self.embedding_func

    def _create_connection_alias(self, connection_args: dict) -> str:
        """Create the connection to the Milvus server."""
        from pymilvus import MilvusException, connections

        # Grab the connection arguments that are used for checking existing connection
        host: str = connection_args.get("host", None)
        port: Union[str, int] = connection_args.get("port", None)
        address: str = connection_args.get("address", None)
        uri: str = connection_args.get("uri", None)
        user = connection_args.get("user", None)

        # Order of use is host/port, uri, address
        if host is not None and port is not None:
            given_address = str(host) + ":" + str(port)
        elif uri is not None:
            given_address = uri.split("https://")[1]
        elif address is not None:
            given_address = address
        else:
            given_address = None
            logger.debug("Missing standard address type for reuse atttempt")

        # User defaults to empty string when getting connection info
        if user is not None:
            tmp_user = user
        else:
            tmp_user = ""

        # If a valid address was given, then check if a connection exists
        if given_address is not None:
            for con in connections.list_connections():
                addr = connections.get_connection_addr(con[0])
                if (
                    con[1]
                    and ("address" in addr)
                    and (addr["address"] == given_address)
                    and ("user" in addr)
                    and (addr["user"] == tmp_user)
                ):
                    logger.debug("Using previous connection: %s", con[0])
                    return con[0]

        # Generate a new connection if one doesn't exist
        alias = uuid4().hex
        try:
            connections.connect(alias=alias, **connection_args)
            logger.debug("Created new connection using: %s", alias)
            return alias
        except MilvusException as e:
            logger.error("Failed to create new connection using: %s", alias)
            raise e

    def _init(
        self, embeddings: Optional[list] = None, metadatas: Optional[list[dict]] = None
    ) -> None:
        if embeddings is not None:
            self._create_collection(embeddings, metadatas)
        self._extract_fields()
        self._create_index()
        self._create_search_params()
        self._load()

    def _create_collection(
        self, embeddings: list, metadatas: Optional[list[dict]] = None
    ) -> None:
        from pymilvus import Collection, CollectionSchema, DataType, FieldSchema, MilvusException
        from pymilvus.orm.types import infer_dtype_bydata

        # Determine embedding dim
        dim = len(embeddings[0])
        fields = []
        # Determine metadata schema
        # if metadatas:
        #     # Create FieldSchema for each entry in metadata.
        #     for key, value in metadatas[0].items():
        #         # Infer the corresponding datatype of the metadata
        #         dtype = infer_dtype_bydata(value)
        #         # Datatype isn't compatible
        #         if dtype == DataType.UNKNOWN or dtype == DataType.NONE:
        #             logger.error(
        #                 "Failure to create collection, unrecognized dtype for key: %s",
        #                 key,
        #             )
        #             raise ValueError(f"Unrecognized datatype for {key}.")
        #         # Dataype is a string/varchar equivalent
        #         elif dtype == DataType.VARCHAR:
        #             fields.append(FieldSchema(key, DataType.VARCHAR, max_length=65_535))
        #         else:
        #             fields.append(FieldSchema(key, dtype))
        if metadatas:
            fields.append(FieldSchema(self._metadata_field, DataType.JSON, max_length=65_535))

        # Create the text field
        fields.append(
            FieldSchema(self._text_field, DataType.VARCHAR, max_length=65_535)
        )
        # Create the primary key field
        fields.append(
            FieldSchema(
                self._primary_field, DataType.INT64, is_primary=True, auto_id=True
            )
        )
        # Create the vector field, supports binary or float vectors
        fields.append(
            FieldSchema(self._vector_field, infer_dtype_bydata(embeddings[0]), dim=dim)
        )

        # Create the schema for the collection
        schema = CollectionSchema(fields)

        # Create the collection
        try:
            self.col = Collection(
                name=self.collection_name,
                schema=schema,
                consistency_level=self.consistency_level,
                using=self.alias,
            )
        except MilvusException as e:
            logger.error(
                "Failed to create collection: %s error: %s", self.collection_name, e
            )
            raise e

    def _extract_fields(self) -> None:
        """Grab the existing fields from the Collection"""
        from pymilvus import Collection

        if isinstance(self.col, Collection):
            schema = self.col.schema
            for x in schema.fields:
                self.fields.append(x.name)
            # Since primary field is auto-id, no need to track it
            self.fields.remove(self._primary_field)

    def _get_index(self) -> Optional[dict[str, Any]]:
        """Return the vector index information if it exists"""
        from pymilvus import Collection

        if isinstance(self.col, Collection):
            for x in self.col.indexes:
                if x.field_name == self._vector_field:
                    return x.to_dict()
        return None

    def _create_index(self) -> None:
        """Create a index on the collection"""
        from pymilvus import Collection, MilvusException

        if isinstance(self.col, Collection) and self._get_index() is None:
            try:
                # If no index params, use a default HNSW based one
                if self.index_params is None:
                    self.index_params = {
                        "metric_type": "IP",
                        "index_type": "HNSW",
                        "params": {"M": 8, "efConstruction": 64},
                    }

                try:
                    self.col.create_index(
                        self._vector_field,
                        index_params=self.index_params,
                        using=self.alias,
                    )

                # If default did not work, most likely on Zilliz Cloud
                except MilvusException:
                    # Use AUTOINDEX based index
                    self.index_params = {
                        "metric_type": "L2",
                        "index_type": "AUTOINDEX",
                        "params": {},
                    }
                    self.col.create_index(
                        self._vector_field,
                        index_params=self.index_params,
                        using=self.alias,
                    )
                logger.debug(
                    "Successfully created an index on collection: %s",
                    self.collection_name,
                )

            except MilvusException as e:
                logger.error(
                    "Failed to create an index on collection: %s", self.collection_name
                )
                raise e

    def _create_search_params(self) -> None:
        """Generate search params based on the current index type"""
        from pymilvus import Collection

        if isinstance(self.col, Collection) and self.search_params is None:
            index = self._get_index()
            if index is not None:
                index_type: str = index["index_param"]["index_type"]
                metric_type: str = index["index_param"]["metric_type"]
                self.search_params = self.default_search_params[index_type]
                self.search_params["metric_type"] = metric_type

    def _load(self) -> None:
        """Load the collection if available."""
        from pymilvus import Collection

        if isinstance(self.col, Collection) and self._get_index() is not None:
            self.col.load()

    def add_texts(
        self,
        texts: Iterable[str],
        metadatas: Optional[list[dict]] = None,
        timeout: Optional[int] = None,
        batch_size: int = 1000,
        **kwargs: Any,
    ) -> list[str]:
        """Insert text data into Milvus.

        Inserting data when the collection has not be made yet will result
        in creating a new Collection. The data of the first entity decides
        the schema of the new collection, the dim is extracted from the first
        embedding and the columns are decided by the first metadata dict.
        Metada keys will need to be present for all inserted values. At
        the moment there is no None equivalent in Milvus.

        Args:
            texts (Iterable[str]): The texts to embed, it is assumed
                that they all fit in memory.
            metadatas (Optional[List[dict]]): Metadata dicts attached to each of
                the texts. Defaults to None.
            timeout (Optional[int]): Timeout for each batch insert. Defaults
                to None.
            batch_size (int, optional): Batch size to use for insertion.
                Defaults to 1000.

        Raises:
            MilvusException: Failure to add texts

        Returns:
            List[str]: The resulting keys for each inserted element.
        """
        from pymilvus import Collection, MilvusException

        texts = list(texts)

        try:
            embeddings = self.embedding_func.embed_documents(texts)
        except NotImplementedError:
            embeddings = [self.embedding_func.embed_query(x) for x in texts]

        if len(embeddings) == 0:
            logger.debug("Nothing to insert, skipping.")
            return []

        # If the collection hasn't been initialized yet, perform all steps to do so
        if not isinstance(self.col, Collection):
            self._init(embeddings, metadatas)

        # Dict to hold all insert columns
        insert_dict: dict[str, list] = {
            self._text_field: texts,
            self._vector_field: embeddings,
        }

        # Collect the metadata into the insert dict.
        # if metadatas is not None:
        #     for d in metadatas:
        #         for key, value in d.items():
        #             if key in self.fields:
        #                 insert_dict.setdefault(key, []).append(value)
        if metadatas is not None:
            for d in metadatas:
                insert_dict.setdefault(self._metadata_field, []).append(d)

        # Total insert count
        vectors: list = insert_dict[self._vector_field]
        total_count = len(vectors)

        pks: list[str] = []

        assert isinstance(self.col, Collection)
        for i in range(0, total_count, batch_size):
            # Grab end index
            end = min(i + batch_size, total_count)
            # Convert dict to list of lists batch for insertion
            insert_list = [insert_dict[x][i:end] for x in self.fields]
            # Insert into the collection.
            try:
                res: Collection
                res = self.col.insert(insert_list, timeout=timeout, **kwargs)
                pks.extend(res.primary_keys)
            except MilvusException as e:
                logger.error(
                    "Failed to insert batch starting at entity: %s/%s", i, total_count
                )
                raise e
        return pks

    def similarity_search(
        self,
        query: str,
        k: int = 4,
        param: Optional[dict] = None,
        expr: Optional[str] = None,
        timeout: Optional[int] = None,
        **kwargs: Any,
    ) -> list[Document]:
        """Perform a similarity search against the query string.

        Args:
            query (str): The text to search.
            k (int, optional): How many results to return. Defaults to 4.
            param (dict, optional): The search params for the index type.
                Defaults to None.
            expr (str, optional): Filtering expression. Defaults to None.
            timeout (int, optional): How long to wait before timeout error.
                Defaults to None.
            kwargs: Collection.search() keyword arguments.

        Returns:
            List[Document]: Document results for search.
        """
        if self.col is None:
            logger.debug("No existing collection to search.")
            return []
        res = self.similarity_search_with_score(
            query=query, k=k, param=param, expr=expr, timeout=timeout, **kwargs
        )
        return [doc for doc, _ in res]

    def similarity_search_by_vector(
        self,
        embedding: list[float],
        k: int = 4,
        param: Optional[dict] = None,
        expr: Optional[str] = None,
        timeout: Optional[int] = None,
        **kwargs: Any,
    ) -> list[Document]:
        """Perform a similarity search against the query string.

        Args:
            embedding (List[float]): The embedding vector to search.
            k (int, optional): How many results to return. Defaults to 4.
            param (dict, optional): The search params for the index type.
                Defaults to None.
            expr (str, optional): Filtering expression. Defaults to None.
            timeout (int, optional): How long to wait before timeout error.
                Defaults to None.
            kwargs: Collection.search() keyword arguments.

        Returns:
            List[Document]: Document results for search.
        """
        if self.col is None:
            logger.debug("No existing collection to search.")
            return []
        res = self.similarity_search_with_score_by_vector(
            embedding=embedding, k=k, param=param, expr=expr, timeout=timeout, **kwargs
        )
        return [doc for doc, _ in res]

    def similarity_search_with_score(
        self,
        query: str,
        k: int = 4,
        param: Optional[dict] = None,
        expr: Optional[str] = None,
        timeout: Optional[int] = None,
        **kwargs: Any,
    ) -> list[tuple[Document, float]]:
        """Perform a search on a query string and return results with score.

        For more information about the search parameters, take a look at the pymilvus
        documentation found here:
        https://milvus.io/api-reference/pymilvus/v2.2.6/Collection/search().md

        Args:
            query (str): The text being searched.
            k (int, optional): The amount of results to return. Defaults to 4.
            param (dict): The search params for the specified index.
                Defaults to None.
            expr (str, optional): Filtering expression. Defaults to None.
            timeout (int, optional): How long to wait before timeout error.
                Defaults to None.
            kwargs: Collection.search() keyword arguments.

        Returns:
            List[float], List[Tuple[Document, any, any]]:
        """
        if self.col is None:
            logger.debug("No existing collection to search.")
            return []

        # Embed the query text.
        embedding = self.embedding_func.embed_query(query)

        res = self.similarity_search_with_score_by_vector(
            embedding=embedding, k=k, param=param, expr=expr, timeout=timeout, **kwargs
        )
        return res

    def _similarity_search_with_relevance_scores(
        self,
        query: str,
        k: int = 4,
        **kwargs: Any,
    ) -> list[tuple[Document, float]]:
        """Return docs and relevance scores in the range [0, 1].

        0 is dissimilar, 1 is most similar.

        Args:
            query: input text
            k: Number of Documents to return. Defaults to 4.
            **kwargs: kwargs to be passed to similarity search. Should include:
                score_threshold: Optional, a floating point value between 0 to 1 to
                    filter the resulting set of retrieved docs

        Returns:
            List of Tuples of (doc, similarity_score)
        """
        return self.similarity_search_with_score(query, k, **kwargs)

    def similarity_search_with_score_by_vector(
        self,
        embedding: list[float],
        k: int = 4,
        param: Optional[dict] = None,
        expr: Optional[str] = None,
        timeout: Optional[int] = None,
        **kwargs: Any,
    ) -> list[tuple[Document, float]]:
        """Perform a search on a query string and return results with score.

        For more information about the search parameters, take a look at the pymilvus
        documentation found here:
        https://milvus.io/api-reference/pymilvus/v2.2.6/Collection/search().md

        Args:
            embedding (List[float]): The embedding vector being searched.
            k (int, optional): The amount of results to return. Defaults to 4.
            param (dict): The search params for the specified index.
                Defaults to None.
            expr (str, optional): Filtering expression. Defaults to None.
            timeout (int, optional): How long to wait before timeout error.
                Defaults to None.
            kwargs: Collection.search() keyword arguments.

        Returns:
            List[Tuple[Document, float]]: Result doc and score.
        """
        if self.col is None:
            logger.debug("No existing collection to search.")
            return []

        if param is None:
            param = self.search_params

        # Determine result metadata fields.
        output_fields = self.fields[:]
        output_fields.remove(self._vector_field)

        # Perform the search.
        res = self.col.search(
            data=[embedding],
            anns_field=self._vector_field,
            param=param,
            limit=k,
            expr=expr,
            output_fields=output_fields,
            timeout=timeout,
            **kwargs,
        )
        # Organize results.
        ret = []
        for result in res[0]:
            meta = {x: result.entity.get(x) for x in output_fields}
            doc = Document(page_content=meta.pop(self._text_field), metadata=meta.get('metadata'))
            pair = (doc, result.score)
            ret.append(pair)

        return ret

    def max_marginal_relevance_search(
        self,
        query: str,
        k: int = 4,
        fetch_k: int = 20,
        lambda_mult: float = 0.5,
        param: Optional[dict] = None,
        expr: Optional[str] = None,
        timeout: Optional[int] = None,
        **kwargs: Any,
    ) -> list[Document]:
        """Perform a search and return results that are reordered by MMR.

        Args:
            query (str): The text being searched.
            k (int, optional): How many results to give. Defaults to 4.
            fetch_k (int, optional): Total results to select k from.
                Defaults to 20.
            lambda_mult: Number between 0 and 1 that determines the degree
                        of diversity among the results with 0 corresponding
                        to maximum diversity and 1 to minimum diversity.
                        Defaults to 0.5
            param (dict, optional): The search params for the specified index.
                Defaults to None.
            expr (str, optional): Filtering expression. Defaults to None.
            timeout (int, optional): How long to wait before timeout error.
                Defaults to None.
            kwargs: Collection.search() keyword arguments.


        Returns:
            List[Document]: Document results for search.
        """
        if self.col is None:
            logger.debug("No existing collection to search.")
            return []

        embedding = self.embedding_func.embed_query(query)

        return self.max_marginal_relevance_search_by_vector(
            embedding=embedding,
            k=k,
            fetch_k=fetch_k,
            lambda_mult=lambda_mult,
            param=param,
            expr=expr,
            timeout=timeout,
            **kwargs,
        )

    def max_marginal_relevance_search_by_vector(
        self,
        embedding: list[float],
        k: int = 4,
        fetch_k: int = 20,
        lambda_mult: float = 0.5,
        param: Optional[dict] = None,
        expr: Optional[str] = None,
        timeout: Optional[int] = None,
        **kwargs: Any,
    ) -> list[Document]:
        """Perform a search and return results that are reordered by MMR.

        Args:
            embedding (str): The embedding vector being searched.
            k (int, optional): How many results to give. Defaults to 4.
            fetch_k (int, optional): Total results to select k from.
                Defaults to 20.
            lambda_mult: Number between 0 and 1 that determines the degree
                        of diversity among the results with 0 corresponding
                        to maximum diversity and 1 to minimum diversity.
                        Defaults to 0.5
            param (dict, optional): The search params for the specified index.
                Defaults to None.
            expr (str, optional): Filtering expression. Defaults to None.
            timeout (int, optional): How long to wait before timeout error.
                Defaults to None.
            kwargs: Collection.search() keyword arguments.

        Returns:
            List[Document]: Document results for search.
        """
        if self.col is None:
            logger.debug("No existing collection to search.")
            return []

        if param is None:
            param = self.search_params

        # Determine result metadata fields.
        output_fields = self.fields[:]
        output_fields.remove(self._vector_field)

        # Perform the search.
        res = self.col.search(
            data=[embedding],
            anns_field=self._vector_field,
            param=param,
            limit=fetch_k,
            expr=expr,
            output_fields=output_fields,
            timeout=timeout,
            **kwargs,
        )
        # Organize results.
        ids = []
        documents = []
        scores = []
        for result in res[0]:
            meta = {x: result.entity.get(x) for x in output_fields}
            doc = Document(page_content=meta.pop(self._text_field), metadata=meta)
            documents.append(doc)
            scores.append(result.score)
            ids.append(result.id)

        vectors = self.col.query(
            expr=f"{self._primary_field} in {ids}",
            output_fields=[self._primary_field, self._vector_field],
            timeout=timeout,
        )
        # Reorganize the results from query to match search order.
        vectors = {x[self._primary_field]: x[self._vector_field] for x in vectors}

        ordered_result_embeddings = [vectors[x] for x in ids]

        # Get the new order of results.
        new_ordering = maximal_marginal_relevance(
            np.array(embedding), ordered_result_embeddings, k=k, lambda_mult=lambda_mult
        )

        # Reorder the values and return.
        ret = []
        for x in new_ordering:
            # Function can return -1 index
            if x == -1:
                break
            else:
                ret.append(documents[x])
        return ret

    @classmethod
    def from_texts(
        cls,
        texts: list[str],
        embedding: Embeddings,
        metadatas: Optional[list[dict]] = None,
        collection_name: str = "LangChainCollection",
        connection_args: dict[str, Any] = DEFAULT_MILVUS_CONNECTION,
        consistency_level: str = "Session",
        index_params: Optional[dict] = None,
        search_params: Optional[dict] = None,
        drop_old: bool = False,
        batch_size: int = 100,
        ids: Optional[Sequence[str]] = None,
        **kwargs: Any,
    ) -> Milvus:
        """Create a Milvus collection, indexes it with HNSW, and insert data.

        Args:
            texts (List[str]): Text data.
            embedding (Embeddings): Embedding function.
            metadatas (Optional[List[dict]]): Metadata for each text if it exists.
                Defaults to None.
            collection_name (str, optional): Collection name to use. Defaults to
                "LangChainCollection".
            connection_args (dict[str, Any], optional): Connection args to use. Defaults
                to DEFAULT_MILVUS_CONNECTION.
            consistency_level (str, optional): Which consistency level to use. Defaults
                to "Session".
            index_params (Optional[dict], optional): Which index_params to use. Defaults
                to None.
            search_params (Optional[dict], optional): Which search params to use.
                Defaults to None.
            drop_old (Optional[bool], optional): Whether to drop the collection with
                that name if it exists. Defaults to False.
            batch_size:
                How many vectors upload per-request.
                Default: 100
            ids: Optional[Sequence[str]] = None,

        Returns:
            Milvus: Milvus Vector Store
        """
        vector_db = cls(
            embedding_function=embedding,
            collection_name=collection_name,
            connection_args=connection_args,
            consistency_level=consistency_level,
            index_params=index_params,
            search_params=search_params,
            drop_old=drop_old,
            **kwargs,
        )
        vector_db.add_texts(texts=texts, metadatas=metadatas, batch_size=batch_size)
        return vector_db
