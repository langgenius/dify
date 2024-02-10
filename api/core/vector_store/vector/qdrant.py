"""Wrapper around Qdrant vector database."""
from __future__ import annotations

import asyncio
import functools
import uuid
import warnings
from collections.abc import Callable, Generator, Iterable, Sequence
from itertools import islice
from operator import itemgetter
from typing import TYPE_CHECKING, Any, Optional, Union

import numpy as np
from langchain.docstore.document import Document
from langchain.embeddings.base import Embeddings
from langchain.vectorstores import VectorStore
from langchain.vectorstores.utils import maximal_marginal_relevance
from qdrant_client.http.models import PayloadSchemaType, TextIndexParams, TextIndexType, TokenizerType

if TYPE_CHECKING:
    from qdrant_client import grpc  # noqa
    from qdrant_client.conversions import common_types
    from qdrant_client.http import models as rest

    DictFilter = dict[str, Union[str, int, bool, dict, list]]
    MetadataFilter = Union[DictFilter, common_types.Filter]


class QdrantException(Exception):
    """Base class for all the Qdrant related exceptions"""


def sync_call_fallback(method: Callable) -> Callable:
    """
    Decorator to call the synchronous method of the class if the async method is not
    implemented. This decorator might be only used for the methods that are defined
    as async in the class.
    """

    @functools.wraps(method)
    async def wrapper(self: Any, *args: Any, **kwargs: Any) -> Any:
        try:
            return await method(self, *args, **kwargs)
        except NotImplementedError:
            # If the async method is not implemented, call the synchronous method
            # by removing the first letter from the method name. For example,
            # if the async method is called ``aaad_texts``, the synchronous method
            # will be called ``aad_texts``.
            sync_method = functools.partial(
                getattr(self, method.__name__[1:]), *args, **kwargs
            )
            return await asyncio.get_event_loop().run_in_executor(None, sync_method)

    return wrapper


class Qdrant(VectorStore):
    """Wrapper around Qdrant vector database.

    To use you should have the ``qdrant-client`` package installed.

    Example:
        .. code-block:: python

            from qdrant_client import QdrantClient
            from langchain import Qdrant

            client = QdrantClient()
            collection_name = "MyCollection"
            qdrant = Qdrant(client, collection_name, embedding_function)
    """

    CONTENT_KEY = "page_content"
    METADATA_KEY = "metadata"
    GROUP_KEY = "group_id"
    VECTOR_NAME = None

    def __init__(
        self,
        client: Any,
        collection_name: str,
        embeddings: Optional[Embeddings] = None,
        content_payload_key: str = CONTENT_KEY,
        metadata_payload_key: str = METADATA_KEY,
        group_payload_key: str = GROUP_KEY,
        group_id: str = None,
        distance_strategy: str = "COSINE",
        vector_name: Optional[str] = VECTOR_NAME,
        embedding_function: Optional[Callable] = None,  # deprecated
        is_new_collection: bool = False
    ):
        """Initialize with necessary components."""
        try:
            import qdrant_client
        except ImportError:
            raise ValueError(
                "Could not import qdrant-client python package. "
                "Please install it with `pip install qdrant-client`."
            )

        if not isinstance(client, qdrant_client.QdrantClient):
            raise ValueError(
                f"client should be an instance of qdrant_client.QdrantClient, "
                f"got {type(client)}"
            )

        if embeddings is None and embedding_function is None:
            raise ValueError(
                "`embeddings` value can't be None. Pass `Embeddings` instance."
            )

        if embeddings is not None and embedding_function is not None:
            raise ValueError(
                "Both `embeddings` and `embedding_function` are passed. "
                "Use `embeddings` only."
            )

        self._embeddings = embeddings
        self._embeddings_function = embedding_function
        self.client: qdrant_client.QdrantClient = client
        self.collection_name = collection_name
        self.content_payload_key = content_payload_key or self.CONTENT_KEY
        self.metadata_payload_key = metadata_payload_key or self.METADATA_KEY
        self.group_payload_key = group_payload_key or self.GROUP_KEY
        self.vector_name = vector_name or self.VECTOR_NAME
        self.group_id = group_id
        self.is_new_collection= is_new_collection

        if embedding_function is not None:
            warnings.warn(
                "Using `embedding_function` is deprecated. "
                "Pass `Embeddings` instance to `embeddings` instead."
            )

        if not isinstance(embeddings, Embeddings):
            warnings.warn(
                "`embeddings` should be an instance of `Embeddings`."
                "Using `embeddings` as `embedding_function` which is deprecated"
            )
            self._embeddings_function = embeddings
            self._embeddings = None

        self.distance_strategy = distance_strategy.upper()

    @property
    def embeddings(self) -> Optional[Embeddings]:
        return self._embeddings

    def add_texts(
        self,
        texts: Iterable[str],
        metadatas: Optional[list[dict]] = None,
        ids: Optional[Sequence[str]] = None,
        batch_size: int = 64,
        **kwargs: Any,
    ) -> list[str]:
        """Run more texts through the embeddings and add to the vectorstore.

        Args:
            texts: Iterable of strings to add to the vectorstore.
            metadatas: Optional list of metadatas associated with the texts.
            ids:
                Optional list of ids to associate with the texts. Ids have to be
                uuid-like strings.
            batch_size:
                How many vectors upload per-request.
                Default: 64
            group_id:
                collection group

        Returns:
            List of ids from adding the texts into the vectorstore.
        """
        added_ids = []
        for batch_ids, points in self._generate_rest_batches(
            texts, metadatas, ids, batch_size
        ):
            self.client.upsert(
                collection_name=self.collection_name, points=points
            )
            added_ids.extend(batch_ids)
        # if is new collection, create payload index on group_id
        if self.is_new_collection:
            # create payload index
            self.client.create_payload_index(self.collection_name, self.group_payload_key,
                                             field_schema=PayloadSchemaType.KEYWORD,
                                             field_type=PayloadSchemaType.KEYWORD)
            # creat full text index
            text_index_params = TextIndexParams(
                type=TextIndexType.TEXT,
                tokenizer=TokenizerType.MULTILINGUAL,
                min_token_len=2,
                max_token_len=20,
                lowercase=True
            )
            self.client.create_payload_index(self.collection_name, self.content_payload_key,
                                             field_schema=text_index_params)
        return added_ids

    @sync_call_fallback
    async def aadd_texts(
        self,
        texts: Iterable[str],
        metadatas: Optional[list[dict]] = None,
        ids: Optional[Sequence[str]] = None,
        batch_size: int = 64,
        **kwargs: Any,
    ) -> list[str]:
        """Run more texts through the embeddings and add to the vectorstore.

        Args:
            texts: Iterable of strings to add to the vectorstore.
            metadatas: Optional list of metadatas associated with the texts.
            ids:
                Optional list of ids to associate with the texts. Ids have to be
                uuid-like strings.
            batch_size:
                How many vectors upload per-request.
                Default: 64

        Returns:
            List of ids from adding the texts into the vectorstore.
        """
        from qdrant_client import grpc  # noqa
        from qdrant_client.conversions.conversion import RestToGrpc

        added_ids = []
        for batch_ids, points in self._generate_rest_batches(
            texts, metadatas, ids, batch_size
        ):
            await self.client.async_grpc_points.Upsert(
                grpc.UpsertPoints(
                    collection_name=self.collection_name,
                    points=[RestToGrpc.convert_point_struct(point) for point in points],
                )
            )
            added_ids.extend(batch_ids)

        return added_ids

    def similarity_search(
        self,
        query: str,
        k: int = 4,
        filter: Optional[MetadataFilter] = None,
        search_params: Optional[common_types.SearchParams] = None,
        offset: int = 0,
        score_threshold: Optional[float] = None,
        consistency: Optional[common_types.ReadConsistency] = None,
        **kwargs: Any,
    ) -> list[tuple[Document, float]]:
        """Return docs most similar to query.

        Args:
            query: Text to look up documents similar to.
            k: Number of Documents to return. Defaults to 4.
            filter: Filter by metadata. Defaults to None.
            search_params: Additional search params
            offset:
                Offset of the first result to return.
                May be used to paginate results.
                Note: large offset values may cause performance issues.
            score_threshold:
                Define a minimal score threshold for the result.
                If defined, less similar results will not be returned.
                Score of the returned result might be higher or smaller than the
                threshold depending on the Distance function used.
                E.g. for cosine similarity only higher scores will be returned.
            consistency:
                Read consistency of the search. Defines how many replicas should be
                queried before returning the result.
                Values:
                - int - number of replicas to query, values should present in all
                        queried replicas
                - 'majority' - query all replicas, but return values present in the
                               majority of replicas
                - 'quorum' - query the majority of replicas, return values present in
                             all of them
                - 'all' - query all replicas, and return values present in all replicas

        Returns:
            List of Documents most similar to the query.
        """
        results = self.similarity_search_with_score(
            query,
            k,
            filter=filter,
            search_params=search_params,
            offset=offset,
            score_threshold=score_threshold,
            consistency=consistency,
            **kwargs,
        )
        return list(map(itemgetter(0), results))

    @sync_call_fallback
    async def asimilarity_search(
        self,
        query: str,
        k: int = 4,
        filter: Optional[MetadataFilter] = None,
        **kwargs: Any,
    ) -> list[Document]:
        """Return docs most similar to query.
        Args:
            query: Text to look up documents similar to.
            k: Number of Documents to return. Defaults to 4.
            filter: Filter by metadata. Defaults to None.
        Returns:
            List of Documents most similar to the query.
        """
        results = await self.asimilarity_search_with_score(query, k, filter, **kwargs)
        return list(map(itemgetter(0), results))

    def similarity_search_with_score(
        self,
        query: str,
        k: int = 4,
        filter: Optional[MetadataFilter] = None,
        search_params: Optional[common_types.SearchParams] = None,
        offset: int = 0,
        score_threshold: Optional[float] = None,
        consistency: Optional[common_types.ReadConsistency] = None,
        **kwargs: Any,
    ) -> list[tuple[Document, float]]:
        """Return docs most similar to query.

        Args:
            query: Text to look up documents similar to.
            k: Number of Documents to return. Defaults to 4.
            filter: Filter by metadata. Defaults to None.
            search_params: Additional search params
            offset:
                Offset of the first result to return.
                May be used to paginate results.
                Note: large offset values may cause performance issues.
            score_threshold:
                Define a minimal score threshold for the result.
                If defined, less similar results will not be returned.
                Score of the returned result might be higher or smaller than the
                threshold depending on the Distance function used.
                E.g. for cosine similarity only higher scores will be returned.
            consistency:
                Read consistency of the search. Defines how many replicas should be
                queried before returning the result.
                Values:
                - int - number of replicas to query, values should present in all
                        queried replicas
                - 'majority' - query all replicas, but return values present in the
                               majority of replicas
                - 'quorum' - query the majority of replicas, return values present in
                             all of them
                - 'all' - query all replicas, and return values present in all replicas

        Returns:
            List of documents most similar to the query text and distance for each.
        """
        return self.similarity_search_with_score_by_vector(
            self._embed_query(query),
            k,
            filter=filter,
            search_params=search_params,
            offset=offset,
            score_threshold=score_threshold,
            consistency=consistency,
            **kwargs,
        )

    @sync_call_fallback
    async def asimilarity_search_with_score(
        self,
        query: str,
        k: int = 4,
        filter: Optional[MetadataFilter] = None,
        search_params: Optional[common_types.SearchParams] = None,
        offset: int = 0,
        score_threshold: Optional[float] = None,
        consistency: Optional[common_types.ReadConsistency] = None,
        **kwargs: Any,
    ) -> list[tuple[Document, float]]:
        """Return docs most similar to query.

        Args:
            query: Text to look up documents similar to.
            k: Number of Documents to return. Defaults to 4.
            filter: Filter by metadata. Defaults to None.
            search_params: Additional search params
            offset:
                Offset of the first result to return.
                May be used to paginate results.
                Note: large offset values may cause performance issues.
            score_threshold:
                Define a minimal score threshold for the result.
                If defined, less similar results will not be returned.
                Score of the returned result might be higher or smaller than the
                threshold depending on the Distance function used.
                E.g. for cosine similarity only higher scores will be returned.
            consistency:
                Read consistency of the search. Defines how many replicas should be
                queried before returning the result.
                Values:
                - int - number of replicas to query, values should present in all
                        queried replicas
                - 'majority' - query all replicas, but return values present in the
                               majority of replicas
                - 'quorum' - query the majority of replicas, return values present in
                             all of them
                - 'all' - query all replicas, and return values present in all replicas

        Returns:
            List of documents most similar to the query text and distance for each.
        """
        return await self.asimilarity_search_with_score_by_vector(
            self._embed_query(query),
            k,
            filter=filter,
            search_params=search_params,
            offset=offset,
            score_threshold=score_threshold,
            consistency=consistency,
            **kwargs,
        )

    def similarity_search_by_vector(
        self,
        embedding: list[float],
        k: int = 4,
        filter: Optional[MetadataFilter] = None,
        search_params: Optional[common_types.SearchParams] = None,
        offset: int = 0,
        score_threshold: Optional[float] = None,
        consistency: Optional[common_types.ReadConsistency] = None,
        **kwargs: Any,
    ) -> list[Document]:
        """Return docs most similar to embedding vector.

        Args:
            embedding: Embedding vector to look up documents similar to.
            k: Number of Documents to return. Defaults to 4.
            filter: Filter by metadata. Defaults to None.
            search_params: Additional search params
            offset:
                Offset of the first result to return.
                May be used to paginate results.
                Note: large offset values may cause performance issues.
            score_threshold:
                Define a minimal score threshold for the result.
                If defined, less similar results will not be returned.
                Score of the returned result might be higher or smaller than the
                threshold depending on the Distance function used.
                E.g. for cosine similarity only higher scores will be returned.
            consistency:
                Read consistency of the search. Defines how many replicas should be
                queried before returning the result.
                Values:
                - int - number of replicas to query, values should present in all
                        queried replicas
                - 'majority' - query all replicas, but return values present in the
                               majority of replicas
                - 'quorum' - query the majority of replicas, return values present in
                             all of them
                - 'all' - query all replicas, and return values present in all replicas

        Returns:
            List of Documents most similar to the query.
        """
        results = self.similarity_search_with_score_by_vector(
            embedding,
            k,
            filter=filter,
            search_params=search_params,
            offset=offset,
            score_threshold=score_threshold,
            consistency=consistency,
            **kwargs,
        )
        return list(map(itemgetter(0), results))

    @sync_call_fallback
    async def asimilarity_search_by_vector(
        self,
        embedding: list[float],
        k: int = 4,
        filter: Optional[MetadataFilter] = None,
        search_params: Optional[common_types.SearchParams] = None,
        offset: int = 0,
        score_threshold: Optional[float] = None,
        consistency: Optional[common_types.ReadConsistency] = None,
        **kwargs: Any,
    ) -> list[Document]:
        """Return docs most similar to embedding vector.

        Args:
            embedding: Embedding vector to look up documents similar to.
            k: Number of Documents to return. Defaults to 4.
            filter: Filter by metadata. Defaults to None.
            search_params: Additional search params
            offset:
                Offset of the first result to return.
                May be used to paginate results.
                Note: large offset values may cause performance issues.
            score_threshold:
                Define a minimal score threshold for the result.
                If defined, less similar results will not be returned.
                Score of the returned result might be higher or smaller than the
                threshold depending on the Distance function used.
                E.g. for cosine similarity only higher scores will be returned.
            consistency:
                Read consistency of the search. Defines how many replicas should be
                queried before returning the result.
                Values:
                - int - number of replicas to query, values should present in all
                        queried replicas
                - 'majority' - query all replicas, but return values present in the
                               majority of replicas
                - 'quorum' - query the majority of replicas, return values present in
                             all of them
                - 'all' - query all replicas, and return values present in all replicas

        Returns:
            List of Documents most similar to the query.
        """
        results = await self.asimilarity_search_with_score_by_vector(
            embedding,
            k,
            filter=filter,
            search_params=search_params,
            offset=offset,
            score_threshold=score_threshold,
            consistency=consistency,
            **kwargs,
        )
        return list(map(itemgetter(0), results))

    def similarity_search_with_score_by_vector(
        self,
        embedding: list[float],
        k: int = 4,
        filter: Optional[MetadataFilter] = None,
        search_params: Optional[common_types.SearchParams] = None,
        offset: int = 0,
        score_threshold: Optional[float] = None,
        consistency: Optional[common_types.ReadConsistency] = None,
        **kwargs: Any,
    ) -> list[tuple[Document, float]]:
        """Return docs most similar to embedding vector.

        Args:
            embedding: Embedding vector to look up documents similar to.
            k: Number of Documents to return. Defaults to 4.
            filter: Filter by metadata. Defaults to None.
            search_params: Additional search params
            offset:
                Offset of the first result to return.
                May be used to paginate results.
                Note: large offset values may cause performance issues.
            score_threshold:
                Define a minimal score threshold for the result.
                If defined, less similar results will not be returned.
                Score of the returned result might be higher or smaller than the
                threshold depending on the Distance function used.
                E.g. for cosine similarity only higher scores will be returned.
            consistency:
                Read consistency of the search. Defines how many replicas should be
                queried before returning the result.
                Values:
                - int - number of replicas to query, values should present in all
                        queried replicas
                - 'majority' - query all replicas, but return values present in the
                               majority of replicas
                - 'quorum' - query the majority of replicas, return values present in
                             all of them
                - 'all' - query all replicas, and return values present in all replicas

        Returns:
            List of documents most similar to the query text and distance for each.
        """
        if filter is not None and isinstance(filter, dict):
            warnings.warn(
                "Using dict as a `filter` is deprecated. Please use qdrant-client "
                "filters directly: "
                "https://qdrant.tech/documentation/concepts/filtering/",
                DeprecationWarning,
            )
            qdrant_filter = self._qdrant_filter_from_dict(filter)
        else:
            qdrant_filter = filter

        query_vector = embedding
        if self.vector_name is not None:
            query_vector = (self.vector_name, embedding)  # type: ignore[assignment]

        results = self.client.search(
            collection_name=self.collection_name,
            query_vector=query_vector,
            query_filter=qdrant_filter,
            search_params=search_params,
            limit=k,
            offset=offset,
            with_payload=True,
            with_vectors=True,
            score_threshold=score_threshold,
            consistency=consistency,
            **kwargs,
        )
        return [
            (
                self._document_from_scored_point(
                    result, self.content_payload_key, self.metadata_payload_key
                ),
                result.score,
            )
            for result in results
        ]

    def similarity_search_by_bm25(
        self,
        filter: Optional[MetadataFilter] = None,
        k: int = 4
    ) -> list[Document]:
        """Return docs most similar by bm25.

        Args:
            embedding: Embedding vector to look up documents similar to.
            k: Number of Documents to return. Defaults to 4.
            filter: Filter by metadata. Defaults to None.
            search_params: Additional search params
        Returns:
            List of documents most similar to the query text and distance for each.
        """
        response = self.client.scroll(
            collection_name=self.collection_name,
            scroll_filter=filter,
            limit=k,
            with_payload=True,
            with_vectors=True

        )
        results = response[0]
        documents = []
        for result in results:
            if result:
                documents.append(self._document_from_scored_point(
                        result, self.content_payload_key, self.metadata_payload_key
                    ))

        return documents

    @sync_call_fallback
    async def asimilarity_search_with_score_by_vector(
        self,
        embedding: list[float],
        k: int = 4,
        filter: Optional[MetadataFilter] = None,
        search_params: Optional[common_types.SearchParams] = None,
        offset: int = 0,
        score_threshold: Optional[float] = None,
        consistency: Optional[common_types.ReadConsistency] = None,
        **kwargs: Any,
    ) -> list[tuple[Document, float]]:
        """Return docs most similar to embedding vector.

        Args:
            embedding: Embedding vector to look up documents similar to.
            k: Number of Documents to return. Defaults to 4.
            filter: Filter by metadata. Defaults to None.
            search_params: Additional search params
            offset:
                Offset of the first result to return.
                May be used to paginate results.
                Note: large offset values may cause performance issues.
            score_threshold:
                Define a minimal score threshold for the result.
                If defined, less similar results will not be returned.
                Score of the returned result might be higher or smaller than the
                threshold depending on the Distance function used.
                E.g. for cosine similarity only higher scores will be returned.
            consistency:
                Read consistency of the search. Defines how many replicas should be
                queried before returning the result.
                Values:
                - int - number of replicas to query, values should present in all
                        queried replicas
                - 'majority' - query all replicas, but return values present in the
                               majority of replicas
                - 'quorum' - query the majority of replicas, return values present in
                             all of them
                - 'all' - query all replicas, and return values present in all replicas

        Returns:
            List of documents most similar to the query text and distance for each.
        """
        from qdrant_client import grpc  # noqa
        from qdrant_client.conversions.conversion import RestToGrpc
        from qdrant_client.http import models as rest

        if filter is not None and isinstance(filter, dict):
            warnings.warn(
                "Using dict as a `filter` is deprecated. Please use qdrant-client "
                "filters directly: "
                "https://qdrant.tech/documentation/concepts/filtering/",
                DeprecationWarning,
            )
            qdrant_filter = self._qdrant_filter_from_dict(filter)
        else:
            qdrant_filter = filter

        if qdrant_filter is not None and isinstance(qdrant_filter, rest.Filter):
            qdrant_filter = RestToGrpc.convert_filter(qdrant_filter)

        response = await self.client.async_grpc_points.Search(
            grpc.SearchPoints(
                collection_name=self.collection_name,
                vector_name=self.vector_name,
                vector=embedding,
                filter=qdrant_filter,
                params=search_params,
                limit=k,
                offset=offset,
                with_payload=grpc.WithPayloadSelector(enable=True),
                with_vectors=grpc.WithVectorsSelector(enable=False),
                score_threshold=score_threshold,
                read_consistency=consistency,
                **kwargs,
            )
        )

        return [
            (
                self._document_from_scored_point_grpc(
                    result, self.content_payload_key, self.metadata_payload_key
                ),
                result.score,
            )
            for result in response.result
        ]

    def max_marginal_relevance_search(
        self,
        query: str,
        k: int = 4,
        fetch_k: int = 20,
        lambda_mult: float = 0.5,
        **kwargs: Any,
    ) -> list[Document]:
        """Return docs selected using the maximal marginal relevance.

        Maximal marginal relevance optimizes for similarity to query AND diversity
        among selected documents.

        Args:
            query: Text to look up documents similar to.
            k: Number of Documents to return. Defaults to 4.
            fetch_k: Number of Documents to fetch to pass to MMR algorithm.
                     Defaults to 20.
            lambda_mult: Number between 0 and 1 that determines the degree
                        of diversity among the results with 0 corresponding
                        to maximum diversity and 1 to minimum diversity.
                        Defaults to 0.5.
        Returns:
            List of Documents selected by maximal marginal relevance.
        """
        query_embedding = self._embed_query(query)
        return self.max_marginal_relevance_search_by_vector(
            query_embedding, k, fetch_k, lambda_mult, **kwargs
        )

    @sync_call_fallback
    async def amax_marginal_relevance_search(
        self,
        query: str,
        k: int = 4,
        fetch_k: int = 20,
        lambda_mult: float = 0.5,
        **kwargs: Any,
    ) -> list[Document]:
        """Return docs selected using the maximal marginal relevance.

        Maximal marginal relevance optimizes for similarity to query AND diversity
        among selected documents.

        Args:
            query: Text to look up documents similar to.
            k: Number of Documents to return. Defaults to 4.
            fetch_k: Number of Documents to fetch to pass to MMR algorithm.
                     Defaults to 20.
            lambda_mult: Number between 0 and 1 that determines the degree
                        of diversity among the results with 0 corresponding
                        to maximum diversity and 1 to minimum diversity.
                        Defaults to 0.5.
        Returns:
            List of Documents selected by maximal marginal relevance.
        """
        query_embedding = self._embed_query(query)
        return await self.amax_marginal_relevance_search_by_vector(
            query_embedding, k, fetch_k, lambda_mult, **kwargs
        )

    def max_marginal_relevance_search_by_vector(
        self,
        embedding: list[float],
        k: int = 4,
        fetch_k: int = 20,
        lambda_mult: float = 0.5,
        **kwargs: Any,
    ) -> list[Document]:
        """Return docs selected using the maximal marginal relevance.

        Maximal marginal relevance optimizes for similarity to query AND diversity
        among selected documents.

        Args:
            embedding: Embedding to look up documents similar to.
            k: Number of Documents to return. Defaults to 4.
            fetch_k: Number of Documents to fetch to pass to MMR algorithm.
            lambda_mult: Number between 0 and 1 that determines the degree
                        of diversity among the results with 0 corresponding
                        to maximum diversity and 1 to minimum diversity.
                        Defaults to 0.5.
        Returns:
            List of Documents selected by maximal marginal relevance.
        """
        results = self.max_marginal_relevance_search_with_score_by_vector(
            embedding=embedding, k=k, fetch_k=fetch_k, lambda_mult=lambda_mult, **kwargs
        )
        return list(map(itemgetter(0), results))

    @sync_call_fallback
    async def amax_marginal_relevance_search_by_vector(
        self,
        embedding: list[float],
        k: int = 4,
        fetch_k: int = 20,
        lambda_mult: float = 0.5,
        **kwargs: Any,
    ) -> list[Document]:
        """Return docs selected using the maximal marginal relevance.
        Maximal marginal relevance optimizes for similarity to query AND diversity
        among selected documents.
        Args:
            query: Text to look up documents similar to.
            k: Number of Documents to return. Defaults to 4.
            fetch_k: Number of Documents to fetch to pass to MMR algorithm.
                     Defaults to 20.
            lambda_mult: Number between 0 and 1 that determines the degree
                        of diversity among the results with 0 corresponding
                        to maximum diversity and 1 to minimum diversity.
                        Defaults to 0.5.
        Returns:
            List of Documents selected by maximal marginal relevance and distance for
            each.
        """
        results = await self.amax_marginal_relevance_search_with_score_by_vector(
            embedding, k, fetch_k, lambda_mult, **kwargs
        )
        return list(map(itemgetter(0), results))

    def max_marginal_relevance_search_with_score_by_vector(
        self,
        embedding: list[float],
        k: int = 4,
        fetch_k: int = 20,
        lambda_mult: float = 0.5,
        **kwargs: Any,
    ) -> list[tuple[Document, float]]:
        """Return docs selected using the maximal marginal relevance.
        Maximal marginal relevance optimizes for similarity to query AND diversity
        among selected documents.
        Args:
            query: Text to look up documents similar to.
            k: Number of Documents to return. Defaults to 4.
            fetch_k: Number of Documents to fetch to pass to MMR algorithm.
                     Defaults to 20.
            lambda_mult: Number between 0 and 1 that determines the degree
                        of diversity among the results with 0 corresponding
                        to maximum diversity and 1 to minimum diversity.
                        Defaults to 0.5.
        Returns:
            List of Documents selected by maximal marginal relevance and distance for
            each.
        """
        query_vector = embedding
        if self.vector_name is not None:
            query_vector = (self.vector_name, query_vector)  # type: ignore[assignment]

        results = self.client.search(
            collection_name=self.collection_name,
            query_vector=query_vector,
            with_payload=True,
            with_vectors=True,
            limit=fetch_k,
        )
        embeddings = [
            result.vector.get(self.vector_name)  # type: ignore[index, union-attr]
            if self.vector_name is not None
            else result.vector
            for result in results
        ]
        mmr_selected = maximal_marginal_relevance(
            np.array(embedding), embeddings, k=k, lambda_mult=lambda_mult
        )
        return [
            (
                self._document_from_scored_point(
                    results[i], self.content_payload_key, self.metadata_payload_key
                ),
                results[i].score,
            )
            for i in mmr_selected
        ]

    @sync_call_fallback
    async def amax_marginal_relevance_search_with_score_by_vector(
        self,
        embedding: list[float],
        k: int = 4,
        fetch_k: int = 20,
        lambda_mult: float = 0.5,
        **kwargs: Any,
    ) -> list[tuple[Document, float]]:
        """Return docs selected using the maximal marginal relevance.
        Maximal marginal relevance optimizes for similarity to query AND diversity
        among selected documents.
        Args:
            query: Text to look up documents similar to.
            k: Number of Documents to return. Defaults to 4.
            fetch_k: Number of Documents to fetch to pass to MMR algorithm.
                     Defaults to 20.
            lambda_mult: Number between 0 and 1 that determines the degree
                        of diversity among the results with 0 corresponding
                        to maximum diversity and 1 to minimum diversity.
                        Defaults to 0.5.
        Returns:
            List of Documents selected by maximal marginal relevance and distance for
            each.
        """
        from qdrant_client import grpc  # noqa
        from qdrant_client.conversions.conversion import GrpcToRest

        response = await self.client.async_grpc_points.Search(
            grpc.SearchPoints(
                collection_name=self.collection_name,
                vector_name=self.vector_name,
                vector=embedding,
                with_payload=grpc.WithPayloadSelector(enable=True),
                with_vectors=grpc.WithVectorsSelector(enable=True),
                limit=fetch_k,
            )
        )
        results = [
            GrpcToRest.convert_vectors(result.vectors) for result in response.result
        ]
        embeddings: list[list[float]] = [
            result.get(self.vector_name)  # type: ignore
            if isinstance(result, dict)
            else result
            for result in results
        ]
        mmr_selected: list[int] = maximal_marginal_relevance(
            np.array(embedding),
            embeddings,
            k=k,
            lambda_mult=lambda_mult,
        )
        return [
            (
                self._document_from_scored_point_grpc(
                    response.result[i],
                    self.content_payload_key,
                    self.metadata_payload_key,
                ),
                response.result[i].score,
            )
            for i in mmr_selected
        ]

    def delete(self, ids: Optional[list[str]] = None, **kwargs: Any) -> Optional[bool]:
        """Delete by vector ID or other criteria.

        Args:
            ids: List of ids to delete.
            **kwargs: Other keyword arguments that subclasses might use.

        Returns:
            Optional[bool]: True if deletion is successful,
            False otherwise, None if not implemented.
        """
        from qdrant_client.http import models as rest

        result = self.client.delete(
            collection_name=self.collection_name,
            points_selector=ids,
        )
        return result.status == rest.UpdateStatus.COMPLETED

    @classmethod
    def from_texts(
        cls: type[Qdrant],
        texts: list[str],
        embedding: Embeddings,
        metadatas: Optional[list[dict]] = None,
        ids: Optional[Sequence[str]] = None,
        location: Optional[str] = None,
        url: Optional[str] = None,
        port: Optional[int] = 6333,
        grpc_port: int = 6334,
        prefer_grpc: bool = False,
        https: Optional[bool] = None,
        api_key: Optional[str] = None,
        prefix: Optional[str] = None,
        timeout: Optional[float] = None,
        host: Optional[str] = None,
        path: Optional[str] = None,
        collection_name: Optional[str] = None,
        distance_func: str = "Cosine",
        content_payload_key: str = CONTENT_KEY,
        metadata_payload_key: str = METADATA_KEY,
        group_payload_key: str = GROUP_KEY,
        group_id: str = None,
        vector_name: Optional[str] = VECTOR_NAME,
        batch_size: int = 64,
        shard_number: Optional[int] = None,
        replication_factor: Optional[int] = None,
        write_consistency_factor: Optional[int] = None,
        on_disk_payload: Optional[bool] = None,
        hnsw_config: Optional[common_types.HnswConfigDiff] = None,
        optimizers_config: Optional[common_types.OptimizersConfigDiff] = None,
        wal_config: Optional[common_types.WalConfigDiff] = None,
        quantization_config: Optional[common_types.QuantizationConfig] = None,
        init_from: Optional[common_types.InitFrom] = None,
        force_recreate: bool = False,
        **kwargs: Any,
    ) -> Qdrant:
        """Construct Qdrant wrapper from a list of texts.

        Args:
            texts: A list of texts to be indexed in Qdrant.
            embedding: A subclass of `Embeddings`, responsible for text vectorization.
            metadatas:
                An optional list of metadata. If provided it has to be of the same
                length as a list of texts.
            ids:
                Optional list of ids to associate with the texts. Ids have to be
                uuid-like strings.
            location:
                If `:memory:` - use in-memory Qdrant instance.
                If `str` - use it as a `url` parameter.
                If `None` - fallback to relying on `host` and `port` parameters.
            url: either host or str of "Optional[scheme], host, Optional[port],
                Optional[prefix]". Default: `None`
            port: Port of the REST API interface. Default: 6333
            grpc_port: Port of the gRPC interface. Default: 6334
            prefer_grpc:
                If true - use gPRC interface whenever possible in custom methods.
                Default: False
            https: If true - use HTTPS(SSL) protocol. Default: None
            api_key: API key for authentication in Qdrant Cloud. Default: None
            prefix:
                If not None - add prefix to the REST URL path.
                Example: service/v1 will result in
                    http://localhost:6333/service/v1/{qdrant-endpoint} for REST API.
                Default: None
            timeout:
                Timeout for REST and gRPC API requests.
                Default: 5.0 seconds for REST and unlimited for gRPC
            host:
                Host name of Qdrant service. If url and host are None, set to
                'localhost'. Default: None
            path:
                Path in which the vectors will be stored while using local mode.
                Default: None
            collection_name:
                Name of the Qdrant collection to be used. If not provided,
                it will be created randomly. Default: None
            distance_func:
                Distance function. One of: "Cosine" / "Euclid" / "Dot".
                Default: "Cosine"
            content_payload_key:
                A payload key used to store the content of the document.
                Default: "page_content"
            metadata_payload_key:
                A payload key used to store the metadata of the document.
                Default: "metadata"
            group_payload_key:
                A payload key used to store the content of the document.
                Default: "group_id"
            group_id:
                collection group id
            vector_name:
                Name of the vector to be used internally in Qdrant.
                Default: None
            batch_size:
                How many vectors upload per-request.
                Default: 64
            shard_number: Number of shards in collection. Default is 1, minimum is 1.
            replication_factor:
                Replication factor for collection. Default is 1, minimum is 1.
                Defines how many copies of each shard will be created.
                Have effect only in distributed mode.
            write_consistency_factor:
                Write consistency factor for collection. Default is 1, minimum is 1.
                Defines how many replicas should apply the operation for us to consider
                it successful. Increasing this number will make the collection more
                resilient to inconsistencies, but will also make it fail if not enough
                replicas are available.
                Does not have any performance impact.
                Have effect only in distributed mode.
            on_disk_payload:
                If true - point`s payload will not be stored in memory.
                It will be read from the disk every time it is requested.
                This setting saves RAM by (slightly) increasing the response time.
                Note: those payload values that are involved in filtering and are
                indexed - remain in RAM.
            hnsw_config: Params for HNSW index
            optimizers_config: Params for optimizer
            wal_config: Params for Write-Ahead-Log
            quantization_config:
                Params for quantization, if None - quantization will be disabled
            init_from:
                Use data stored in another collection to initialize this collection
            force_recreate:
                Force recreating the collection
            **kwargs:
                Additional arguments passed directly into REST client initialization

        This is a user-friendly interface that:
        1. Creates embeddings, one for each text
        2. Initializes the Qdrant database as an in-memory docstore by default
           (and overridable to a remote docstore)
        3. Adds the text embeddings to the Qdrant database

        This is intended to be a quick way to get started.

        Example:
            .. code-block:: python

                from langchain import Qdrant
                from langchain.embeddings import OpenAIEmbeddings
                embeddings = OpenAIEmbeddings()
                qdrant = Qdrant.from_texts(texts, embeddings, "localhost")
        """
        qdrant = cls._construct_instance(
            texts,
            embedding,
            metadatas,
            ids,
            location,
            url,
            port,
            grpc_port,
            prefer_grpc,
            https,
            api_key,
            prefix,
            timeout,
            host,
            path,
            collection_name,
            distance_func,
            content_payload_key,
            metadata_payload_key,
            group_payload_key,
            group_id,
            vector_name,
            shard_number,
            replication_factor,
            write_consistency_factor,
            on_disk_payload,
            hnsw_config,
            optimizers_config,
            wal_config,
            quantization_config,
            init_from,
            force_recreate,
            **kwargs,
        )
        qdrant.add_texts(texts, metadatas, ids, batch_size)
        return qdrant

    @classmethod
    @sync_call_fallback
    async def afrom_texts(
        cls: type[Qdrant],
        texts: list[str],
        embedding: Embeddings,
        metadatas: Optional[list[dict]] = None,
        ids: Optional[Sequence[str]] = None,
        location: Optional[str] = None,
        url: Optional[str] = None,
        port: Optional[int] = 6333,
        grpc_port: int = 6334,
        prefer_grpc: bool = False,
        https: Optional[bool] = None,
        api_key: Optional[str] = None,
        prefix: Optional[str] = None,
        timeout: Optional[float] = None,
        host: Optional[str] = None,
        path: Optional[str] = None,
        collection_name: Optional[str] = None,
        distance_func: str = "Cosine",
        content_payload_key: str = CONTENT_KEY,
        metadata_payload_key: str = METADATA_KEY,
        vector_name: Optional[str] = VECTOR_NAME,
        batch_size: int = 64,
        shard_number: Optional[int] = None,
        replication_factor: Optional[int] = None,
        write_consistency_factor: Optional[int] = None,
        on_disk_payload: Optional[bool] = None,
        hnsw_config: Optional[common_types.HnswConfigDiff] = None,
        optimizers_config: Optional[common_types.OptimizersConfigDiff] = None,
        wal_config: Optional[common_types.WalConfigDiff] = None,
        quantization_config: Optional[common_types.QuantizationConfig] = None,
        init_from: Optional[common_types.InitFrom] = None,
        force_recreate: bool = False,
        **kwargs: Any,
    ) -> Qdrant:
        """Construct Qdrant wrapper from a list of texts.

        Args:
            texts: A list of texts to be indexed in Qdrant.
            embedding: A subclass of `Embeddings`, responsible for text vectorization.
            metadatas:
                An optional list of metadata. If provided it has to be of the same
                length as a list of texts.
            ids:
                Optional list of ids to associate with the texts. Ids have to be
                uuid-like strings.
            location:
                If `:memory:` - use in-memory Qdrant instance.
                If `str` - use it as a `url` parameter.
                If `None` - fallback to relying on `host` and `port` parameters.
            url: either host or str of "Optional[scheme], host, Optional[port],
                Optional[prefix]". Default: `None`
            port: Port of the REST API interface. Default: 6333
            grpc_port: Port of the gRPC interface. Default: 6334
            prefer_grpc:
                If true - use gPRC interface whenever possible in custom methods.
                Default: False
            https: If true - use HTTPS(SSL) protocol. Default: None
            api_key: API key for authentication in Qdrant Cloud. Default: None
            prefix:
                If not None - add prefix to the REST URL path.
                Example: service/v1 will result in
                    http://localhost:6333/service/v1/{qdrant-endpoint} for REST API.
                Default: None
            timeout:
                Timeout for REST and gRPC API requests.
                Default: 5.0 seconds for REST and unlimited for gRPC
            host:
                Host name of Qdrant service. If url and host are None, set to
                'localhost'. Default: None
            path:
                Path in which the vectors will be stored while using local mode.
                Default: None
            collection_name:
                Name of the Qdrant collection to be used. If not provided,
                it will be created randomly. Default: None
            distance_func:
                Distance function. One of: "Cosine" / "Euclid" / "Dot".
                Default: "Cosine"
            content_payload_key:
                A payload key used to store the content of the document.
                Default: "page_content"
            metadata_payload_key:
                A payload key used to store the metadata of the document.
                Default: "metadata"
            vector_name:
                Name of the vector to be used internally in Qdrant.
                Default: None
            batch_size:
                How many vectors upload per-request.
                Default: 64
            shard_number: Number of shards in collection. Default is 1, minimum is 1.
            replication_factor:
                Replication factor for collection. Default is 1, minimum is 1.
                Defines how many copies of each shard will be created.
                Have effect only in distributed mode.
            write_consistency_factor:
                Write consistency factor for collection. Default is 1, minimum is 1.
                Defines how many replicas should apply the operation for us to consider
                it successful. Increasing this number will make the collection more
                resilient to inconsistencies, but will also make it fail if not enough
                replicas are available.
                Does not have any performance impact.
                Have effect only in distributed mode.
            on_disk_payload:
                If true - point`s payload will not be stored in memory.
                It will be read from the disk every time it is requested.
                This setting saves RAM by (slightly) increasing the response time.
                Note: those payload values that are involved in filtering and are
                indexed - remain in RAM.
            hnsw_config: Params for HNSW index
            optimizers_config: Params for optimizer
            wal_config: Params for Write-Ahead-Log
            quantization_config:
                Params for quantization, if None - quantization will be disabled
            init_from:
                Use data stored in another collection to initialize this collection
            force_recreate:
                Force recreating the collection
            **kwargs:
                Additional arguments passed directly into REST client initialization

        This is a user-friendly interface that:
        1. Creates embeddings, one for each text
        2. Initializes the Qdrant database as an in-memory docstore by default
           (and overridable to a remote docstore)
        3. Adds the text embeddings to the Qdrant database

        This is intended to be a quick way to get started.

        Example:
            .. code-block:: python

                from langchain import Qdrant
                from langchain.embeddings import OpenAIEmbeddings
                embeddings = OpenAIEmbeddings()
                qdrant = await Qdrant.afrom_texts(texts, embeddings, "localhost")
        """
        qdrant = cls._construct_instance(
            texts,
            embedding,
            metadatas,
            ids,
            location,
            url,
            port,
            grpc_port,
            prefer_grpc,
            https,
            api_key,
            prefix,
            timeout,
            host,
            path,
            collection_name,
            distance_func,
            content_payload_key,
            metadata_payload_key,
            vector_name,
            shard_number,
            replication_factor,
            write_consistency_factor,
            on_disk_payload,
            hnsw_config,
            optimizers_config,
            wal_config,
            quantization_config,
            init_from,
            force_recreate,
            **kwargs,
        )
        await qdrant.aadd_texts(texts, metadatas, ids, batch_size)
        return qdrant

    @classmethod
    def _construct_instance(
        cls: type[Qdrant],
        texts: list[str],
        embedding: Embeddings,
        metadatas: Optional[list[dict]] = None,
        ids: Optional[Sequence[str]] = None,
        location: Optional[str] = None,
        url: Optional[str] = None,
        port: Optional[int] = 6333,
        grpc_port: int = 6334,
        prefer_grpc: bool = False,
        https: Optional[bool] = None,
        api_key: Optional[str] = None,
        prefix: Optional[str] = None,
        timeout: Optional[float] = None,
        host: Optional[str] = None,
        path: Optional[str] = None,
        collection_name: Optional[str] = None,
        distance_func: str = "Cosine",
        content_payload_key: str = CONTENT_KEY,
        metadata_payload_key: str = METADATA_KEY,
        group_payload_key: str = GROUP_KEY,
        group_id: str = None,
        vector_name: Optional[str] = VECTOR_NAME,
        shard_number: Optional[int] = None,
        replication_factor: Optional[int] = None,
        write_consistency_factor: Optional[int] = None,
        on_disk_payload: Optional[bool] = None,
        hnsw_config: Optional[common_types.HnswConfigDiff] = None,
        optimizers_config: Optional[common_types.OptimizersConfigDiff] = None,
        wal_config: Optional[common_types.WalConfigDiff] = None,
        quantization_config: Optional[common_types.QuantizationConfig] = None,
        init_from: Optional[common_types.InitFrom] = None,
        force_recreate: bool = False,
        **kwargs: Any,
    ) -> Qdrant:
        try:
            import qdrant_client
        except ImportError:
            raise ValueError(
                "Could not import qdrant-client python package. "
                "Please install it with `pip install qdrant-client`."
            )
        from qdrant_client.http import models as rest

        # Just do a single quick embedding to get vector size
        partial_embeddings = embedding.embed_documents(texts[:1])
        vector_size = len(partial_embeddings[0])
        collection_name = collection_name or uuid.uuid4().hex
        distance_func = distance_func.upper()
        is_new_collection = False
        client = qdrant_client.QdrantClient(
            location=location,
            url=url,
            port=port,
            grpc_port=grpc_port,
            prefer_grpc=prefer_grpc,
            https=https,
            api_key=api_key,
            prefix=prefix,
            timeout=timeout,
            host=host,
            path=path,
            **kwargs,
        )
        all_collection_name = []
        collections_response = client.get_collections()
        collection_list = collections_response.collections
        for collection in collection_list:
            all_collection_name.append(collection.name)
        if collection_name not in all_collection_name:
            vectors_config = rest.VectorParams(
                size=vector_size,
                distance=rest.Distance[distance_func],
            )

            # If vector name was provided, we're going to use the named vectors feature
            # with just a single vector.
            if vector_name is not None:
                vectors_config = {  # type: ignore[assignment]
                    vector_name: vectors_config,
                }

            client.recreate_collection(
                collection_name=collection_name,
                vectors_config=vectors_config,
                shard_number=shard_number,
                replication_factor=replication_factor,
                write_consistency_factor=write_consistency_factor,
                on_disk_payload=on_disk_payload,
                hnsw_config=hnsw_config,
                optimizers_config=optimizers_config,
                wal_config=wal_config,
                quantization_config=quantization_config,
                init_from=init_from,
                timeout=int(timeout),  # type: ignore[arg-type]
            )
            is_new_collection = True
        if force_recreate:
            raise ValueError

        # Get the vector configuration of the existing collection and vector, if it
        # was specified. If the old configuration does not match the current one,
        # an exception is being thrown.
        collection_info = client.get_collection(collection_name=collection_name)
        current_vector_config = collection_info.config.params.vectors
        if isinstance(current_vector_config, dict) and vector_name is not None:
            if vector_name not in current_vector_config:
                raise QdrantException(
                    f"Existing Qdrant collection {collection_name} does not "
                    f"contain vector named {vector_name}. Did you mean one of the "
                    f"existing vectors: {', '.join(current_vector_config.keys())}? "
                    f"If you want to recreate the collection, set `force_recreate` "
                    f"parameter to `True`."
                )
            current_vector_config = current_vector_config.get(
                vector_name
            )  # type: ignore[assignment]
        elif isinstance(current_vector_config, dict) and vector_name is None:
            raise QdrantException(
                f"Existing Qdrant collection {collection_name} uses named vectors. "
                f"If you want to reuse it, please set `vector_name` to any of the "
                f"existing named vectors: "
                f"{', '.join(current_vector_config.keys())}."  # noqa
                f"If you want to recreate the collection, set `force_recreate` "
                f"parameter to `True`."
            )
        elif (
                not isinstance(current_vector_config, dict) and vector_name is not None
        ):
            raise QdrantException(
                f"Existing Qdrant collection {collection_name} doesn't use named "
                f"vectors. If you want to reuse it, please set `vector_name` to "
                f"`None`. If you want to recreate the collection, set "
                f"`force_recreate` parameter to `True`."
            )

        # Check if the vector configuration has the same dimensionality.
        if current_vector_config.size != vector_size:  # type: ignore[union-attr]
            raise QdrantException(
                f"Existing Qdrant collection is configured for vectors with "
                f"{current_vector_config.size} "  # type: ignore[union-attr]
                f"dimensions. Selected embeddings are {vector_size}-dimensional. "
                f"If you want to recreate the collection, set `force_recreate` "
                f"parameter to `True`."
            )

        current_distance_func = (
            current_vector_config.distance.name.upper()  # type: ignore[union-attr]
        )
        if current_distance_func != distance_func:
            raise QdrantException(
                f"Existing Qdrant collection is configured for "
                f"{current_vector_config.distance} "  # type: ignore[union-attr]
                f"similarity. Please set `distance_func` parameter to "
                f"`{distance_func}` if you want to reuse it. If you want to "
                f"recreate the collection, set `force_recreate` parameter to "
                f"`True`."
            )
        qdrant = cls(
            client=client,
            collection_name=collection_name,
            embeddings=embedding,
            content_payload_key=content_payload_key,
            metadata_payload_key=metadata_payload_key,
            distance_strategy=distance_func,
            vector_name=vector_name,
            group_id=group_id,
            group_payload_key=group_payload_key,
            is_new_collection=is_new_collection
        )
        return qdrant

    def _select_relevance_score_fn(self) -> Callable[[float], float]:
        """
        The 'correct' relevance function
        may differ depending on a few things, including:
        - the distance / similarity metric used by the VectorStore
        - the scale of your embeddings (OpenAI's are unit normed. Many others are not!)
        - embedding dimensionality
        - etc.
        """

        if self.distance_strategy == "COSINE":
            return self._cosine_relevance_score_fn
        elif self.distance_strategy == "DOT":
            return self._max_inner_product_relevance_score_fn
        elif self.distance_strategy == "EUCLID":
            return self._euclidean_relevance_score_fn
        else:
            raise ValueError(
                "Unknown distance strategy, must be cosine, "
                "max_inner_product, or euclidean"
            )

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

    @classmethod
    def _build_payloads(
        cls,
        texts: Iterable[str],
        metadatas: Optional[list[dict]],
        content_payload_key: str,
        metadata_payload_key: str,
        group_id: str,
        group_payload_key: str
    ) -> list[dict]:
        payloads = []
        for i, text in enumerate(texts):
            if text is None:
                raise ValueError(
                    "At least one of the texts is None. Please remove it before "
                    "calling .from_texts or .add_texts on Qdrant instance."
                )
            metadata = metadatas[i] if metadatas is not None else None
            payloads.append(
                {
                    content_payload_key: text,
                    metadata_payload_key: metadata,
                    group_payload_key: group_id
                }
            )

        return payloads

    @classmethod
    def _document_from_scored_point(
        cls,
        scored_point: Any,
        content_payload_key: str,
        metadata_payload_key: str,
    ) -> Document:
        return Document(
            page_content=scored_point.payload.get(content_payload_key),
            metadata=scored_point.payload.get(metadata_payload_key) or {},
        )

    @classmethod
    def _document_from_scored_point_grpc(
        cls,
        scored_point: Any,
        content_payload_key: str,
        metadata_payload_key: str,
    ) -> Document:
        from qdrant_client.conversions.conversion import grpc_to_payload

        payload = grpc_to_payload(scored_point.payload)
        return Document(
            page_content=payload[content_payload_key],
            metadata=payload.get(metadata_payload_key) or {},
        )

    def _build_condition(self, key: str, value: Any) -> list[rest.FieldCondition]:
        from qdrant_client.http import models as rest

        out = []

        if isinstance(value, dict):
            for _key, value in value.items():
                out.extend(self._build_condition(f"{key}.{_key}", value))
        elif isinstance(value, list):
            for _value in value:
                if isinstance(_value, dict):
                    out.extend(self._build_condition(f"{key}[]", _value))
                else:
                    out.extend(self._build_condition(f"{key}", _value))
        else:
            out.append(
                rest.FieldCondition(
                    key=key,
                    match=rest.MatchValue(value=value),
                )
            )

        return out

    def _qdrant_filter_from_dict(
        self, filter: Optional[DictFilter]
    ) -> Optional[rest.Filter]:
        from qdrant_client.http import models as rest

        if not filter:
            return None

        return rest.Filter(
            must=[
                condition
                for key, value in filter.items()
                for condition in self._build_condition(key, value)
            ]
        )

    def _embed_query(self, query: str) -> list[float]:
        """Embed query text.

        Used to provide backward compatibility with `embedding_function` argument.

        Args:
            query: Query text.

        Returns:
            List of floats representing the query embedding.
        """
        if self.embeddings is not None:
            embedding = self.embeddings.embed_query(query)
        else:
            if self._embeddings_function is not None:
                embedding = self._embeddings_function(query)
            else:
                raise ValueError("Neither of embeddings or embedding_function is set")
        return embedding.tolist() if hasattr(embedding, "tolist") else embedding

    def _embed_texts(self, texts: Iterable[str]) -> list[list[float]]:
        """Embed search texts.

        Used to provide backward compatibility with `embedding_function` argument.

        Args:
            texts: Iterable of texts to embed.

        Returns:
            List of floats representing the texts embedding.
        """
        if self.embeddings is not None:
            embeddings = self.embeddings.embed_documents(list(texts))
            if hasattr(embeddings, "tolist"):
                embeddings = embeddings.tolist()
        elif self._embeddings_function is not None:
            embeddings = []
            for text in texts:
                embedding = self._embeddings_function(text)
                if hasattr(embeddings, "tolist"):
                    embedding = embedding.tolist()
                embeddings.append(embedding)
        else:
            raise ValueError("Neither of embeddings or embedding_function is set")

        return embeddings

    def _generate_rest_batches(
        self,
        texts: Iterable[str],
        metadatas: Optional[list[dict]] = None,
        ids: Optional[Sequence[str]] = None,
        batch_size: int = 64,
        group_id: Optional[str] = None,
    ) -> Generator[tuple[list[str], list[rest.PointStruct]], None, None]:
        from qdrant_client.http import models as rest

        texts_iterator = iter(texts)
        metadatas_iterator = iter(metadatas or [])
        ids_iterator = iter(ids or [uuid.uuid4().hex for _ in iter(texts)])
        while batch_texts := list(islice(texts_iterator, batch_size)):
            # Take the corresponding metadata and id for each text in a batch
            batch_metadatas = list(islice(metadatas_iterator, batch_size)) or None
            batch_ids = list(islice(ids_iterator, batch_size))

            # Generate the embeddings for all the texts in a batch
            batch_embeddings = self._embed_texts(batch_texts)

            points = [
                rest.PointStruct(
                    id=point_id,
                    vector=vector
                    if self.vector_name is None
                    else {self.vector_name: vector},
                    payload=payload,
                )
                for point_id, vector, payload in zip(
                    batch_ids,
                    batch_embeddings,
                    self._build_payloads(
                        batch_texts,
                        batch_metadatas,
                        self.content_payload_key,
                        self.metadata_payload_key,
                        self.group_id,
                        self.group_payload_key
                    ),
                )
            ]

            yield batch_ids, points
