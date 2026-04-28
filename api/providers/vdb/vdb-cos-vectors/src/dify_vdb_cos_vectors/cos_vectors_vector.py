import hashlib
import json
import logging
import math
import re
from typing import Any

from pydantic import BaseModel, Field
from qcloud_cos import CosConfig
from qcloud_cos.cos_exception import CosServiceError
from qcloud_cos.cos_vectors_client import CosVectorsClient

from configs import dify_config
from core.rag.datasource.vdb.vector_base import BaseVector, VectorIndexStructDict
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

logger = logging.getLogger(__name__)

# COS Vectors pagination cap: the API caps TopK / MaxResults per call.
_LIST_PAGE_SIZE = 1000

# COS Vectors index name spec: ^[a-z0-9]([a-z0-9\-\.]{1,61}[a-z0-9])?$
# i.e. [a-z0-9.-], length 3~63, must start/end with an alphanumeric.
_INDEX_NAME_MAX_LEN = 63
_INDEX_NAME_INVALID_CHAR = re.compile(r"[^a-z0-9.\-]+")


def _normalize_index_name(raw: str) -> str:
    """Coerce a Dify collection name into a COS-Vectors-compliant index name.

    Dify's default ``gen_collection_name_by_id`` yields names like
    ``Vector_index_<uuid>_Node`` which contain uppercase letters and ``_``,
    both rejected by the backend. We lowercase, replace invalid chars with
    ``-``, trim non-alphanumeric edges, and — if truncation is needed —
    append a short hash of the original name to stay unique.
    """
    name = _INDEX_NAME_INVALID_CHAR.sub("-", raw.lower()).strip("-.")
    if len(name) <= _INDEX_NAME_MAX_LEN:
        return name or "idx"
    suffix = "-" + hashlib.md5(raw.encode("utf-8")).hexdigest()[:8]
    return name[: _INDEX_NAME_MAX_LEN - len(suffix)].rstrip("-.") + suffix


class COSVectorsConfig(BaseModel):
    """Config for COS Vectors backend. Field names mirror qcloud_cos.CosConfig."""

    region: str
    secret_id: str
    secret_key: str
    bucket_appid: str
    token: str | None = None
    scheme: str = "https"
    endpoint: str | None = None
    timeout: int = 30
    distance_metric: str = "cosine"  # cosine | euclidean
    data_type: str = "float32"
    max_upsert_batch_size: int = 500
    non_filterable_metadata_keys: list[str] = Field(default_factory=lambda: ["text"])

    def to_cos_config(self) -> CosConfig:
        kwargs: dict[str, Any] = {
            "Region": self.region,
            "SecretId": self.secret_id,
            "SecretKey": self.secret_key,
            "Scheme": self.scheme,
            "Timeout": self.timeout,
        }
        if self.token:
            kwargs["Token"] = self.token
        if self.endpoint:
            kwargs["Endpoint"] = self.endpoint
        return CosConfig(**kwargs)


class COSVectorsVector(BaseVector):
    """Dify vector store on Tencent Cloud COS Vectors.

    Mapping: dataset -> index (under a shared bucket); chunk doc_id -> vector key;
    chunk text is kept in ``metadata.text`` and marked non-filterable.
    """

    field_text: str = "text"

    def __init__(self, collection_name: str, config: COSVectorsConfig):
        super().__init__(collection_name)
        self._config = config
        self._client = CosVectorsClient(config.to_cos_config())
        self._bucket = config.bucket_appid
        self._index = collection_name
        self._ensure_bucket()

    # ------------------------------------------------------------------ Meta
    def get_type(self) -> str:
        return VectorType.COS_VECTORS

    def to_index_struct(self) -> VectorIndexStructDict:
        return {
            "type": self.get_type(),
            "vector_store": {"class_prefix": self._collection_name},
        }

    # ---------------------------------------------------------- Lifecycle
    def _bucket_exists(self) -> bool:
        try:
            self._client.get_vector_bucket(Bucket=self._bucket)
            return True
        except CosServiceError as e:
            if e.get_status_code() == 404:
                return False
            raise

    def _ensure_bucket(self) -> None:
        """Lazily create the shared vector bucket (never deleted on drop).

        A per-process Redis cache is used so that we don't HEAD the bucket on
        every ``COSVectorsVector`` construction (Dify creates one per request).
        The cache entry is cheap and the bucket itself is effectively immutable
        after first creation, so a long TTL is safe.
        """
        cache_key = f"vector_indexing_cos_vectors_bucket_{self._bucket}"
        if redis_client.get(cache_key):
            return
        if self._bucket_exists():
            redis_client.set(cache_key, 1, ex=86400)
            return
        with redis_client.lock(f"vector_indexing_lock_cos_vectors_bucket_{self._bucket}", timeout=30):
            if self._bucket_exists():
                redis_client.set(cache_key, 1, ex=86400)
                return
            self._client.create_vector_bucket(Bucket=self._bucket)
            redis_client.set(cache_key, 1, ex=86400)

    def _index_exists(self) -> bool:
        try:
            self._client.get_index(Bucket=self._bucket, Index=self._index)
            return True
        except CosServiceError as e:
            if e.get_status_code() == 404:
                return False
            raise

    def _create_index(self, dimension: int) -> None:
        cache_key = f"vector_indexing_{self._collection_name}"
        with redis_client.lock(f"vector_indexing_lock_{self._collection_name}", timeout=20):
            if redis_client.get(cache_key):
                # Already verified within TTL — nothing to do, don't refresh.
                return
            if not self._index_exists():
                self._client.create_index(
                    Bucket=self._bucket,
                    Index=self._index,
                    DataType=self._config.data_type,
                    Dimension=dimension,
                    DistanceMetric=self._config.distance_metric,
                    NonFilterableMetadataKeys=self._config.non_filterable_metadata_keys or None,
                )
            redis_client.set(cache_key, 1, ex=3600)

    # --------------------------------------------------------------- Write
    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        if not embeddings:
            return
        self._create_index(len(embeddings[0]))
        self.add_texts(texts, embeddings)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        if not embeddings:
            return
        batch_size = self._config.max_upsert_batch_size
        for j in range(math.ceil(len(embeddings) / batch_size)):
            batch = self._build_put_batch(
                documents[j * batch_size : (j + 1) * batch_size],
                embeddings[j * batch_size : (j + 1) * batch_size],
            )
            if batch:
                self._client.put_vectors(Bucket=self._bucket, Index=self._index, Vectors=batch)

    def _build_put_batch(self, documents: list[Document], embeddings: list[list[float]]) -> list[dict[str, Any]]:
        vectors: list[dict[str, Any]] = []
        for doc, embedding in zip(documents, embeddings):
            metadata = doc.metadata or {}
            key = metadata.get("doc_id")
            if not key:
                # COS Vectors requires a key per vector; Dify normally always sets doc_id.
                logger.warning("Skipping document without doc_id: %s", doc)
                continue
            vectors.append(
                {
                    "key": str(key),
                    "data": {self._config.data_type: embedding},
                    # page_content wins over any collision in metadata["text"].
                    "metadata": {**metadata, self.field_text: doc.page_content},
                }
            )
        return vectors

    # --------------------------------------------------------- Exist/Delete
    def text_exists(self, id: str) -> bool:
        try:
            _, data = self._client.get_vectors(
                Bucket=self._bucket,
                Index=self._index,
                Keys=[id],
                ReturnData=False,
                ReturnMetaData=False,
            )
        except CosServiceError as e:
            if e.get_status_code() == 404:
                return False
            raise
        return bool((data or {}).get("vectors"))

    def delete_by_ids(self, ids: list[str]) -> None:
        if not ids:
            return
        batch_size = self._config.max_upsert_batch_size
        for j in range(math.ceil(len(ids) / batch_size)):
            chunk = ids[j * batch_size : (j + 1) * batch_size]
            try:
                self._client.delete_vectors(Bucket=self._bucket, Index=self._index, Keys=chunk)
            except CosServiceError as e:
                if e.get_status_code() == 404:
                    # Index or some keys are gone already — tolerate and move on.
                    continue
                raise

    def get_ids_by_metadata_field(self, key: str, value: str) -> list[str]:
        """Enumerate vector keys whose metadata[key] == value via ListVectors + local filter.

        ListVectors is a paginated enumeration API and — unlike QueryVectors —
        has no TopK limit, so we can delete ALL matching vectors safely.
        """
        ids: list[str] = []
        next_token: str | None = None
        while True:
            try:
                kwargs: dict[str, Any] = {
                    "Bucket": self._bucket,
                    "Index": self._index,
                    "MaxResults": _LIST_PAGE_SIZE,
                    "ReturnData": False,
                    "ReturnMetaData": True,
                }
                if next_token:
                    kwargs["NextToken"] = next_token
                _, data = self._client.list_vectors(**kwargs)
            except CosServiceError as e:
                if e.get_status_code() == 404:
                    return ids
                raise
            data = data or {}
            for item in data.get("vectors") or []:
                meta = item.get("metadata") or {}
                if isinstance(meta, dict) and meta.get(key) == value and item.get("key") is not None:
                    ids.append(str(item["key"]))
            # Response key is PascalCase per COS Vectors API spec:
            # https://cloud.tencent.com/document/product/436/107208
            next_token = data.get("NextToken")
            if not next_token:
                return ids

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        ids = self.get_ids_by_metadata_field(key, value)
        if ids:
            self.delete_by_ids(ids)

    # -------------------------------------------------------------- Search
    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        if not query_vector:
            return []
        filter_: dict[str, Any] | None = None
        document_ids_filter = kwargs.get("document_ids_filter")
        if document_ids_filter:
            filter_ = {"document_id": {"$in": list(document_ids_filter)}}
        try:
            _, data = self._client.query_vectors(
                Bucket=self._bucket,
                Index=self._index,
                QueryVector={self._config.data_type: query_vector},
                TopK=int(kwargs.get("top_k", 4)),
                Filter=filter_,
                ReturnDistance=True,
                ReturnMetaData=True,
            )
        except CosServiceError as e:
            if e.get_status_code() == 404:
                return []
            raise
        return self._build_documents(data, float(kwargs.get("score_threshold") or 0.0))

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        # COS Vectors has no keyword/BM25 search; mirror Upstash/Chroma.
        return []

    def _build_documents(self, data: dict | None, score_threshold: float) -> list[Document]:
        docs: list[Document] = []
        for item in (data or {}).get("vectors") or []:
            meta = dict(item.get("metadata") or {})
            score = self._distance_to_score(item.get("distance"))
            if score < score_threshold:
                continue
            text = meta.pop(self.field_text, "")
            meta["score"] = score
            docs.append(Document(page_content=text, metadata=meta))
        return docs

    def _distance_to_score(self, distance: Any) -> float:
        try:
            d = float(distance)
        except (TypeError, ValueError):
            return 0.0
        # cosine: distance in [0,2], similarity = 1-d (range [-1, 1])
        # euclidean: monotonic mapping into (0,1] — note this is NOT on the
        # same scale as cosine similarity, so operators tuning score_threshold
        # must re-calibrate it when switching the distance metric.
        if self._config.distance_metric == "cosine":
            return 1.0 - d
        return 1.0 / (1.0 + d)

    # ---------------------------------------------------------------- Drop
    def delete(self) -> None:
        # COS Vectors' DeleteIndex cascades and removes all vectors under the
        # index, so we don't need to page-and-delete vectors first.
        try:
            self._client.delete_index(Bucket=self._bucket, Index=self._index)
        except CosServiceError as e:
            if e.get_status_code() == 404:
                return
            raise

    # ----------------------------------------------------------- Ops helper
    def describe_index(self) -> dict[str, Any] | None:
        """Return the backing COS Vectors index descriptor, or None if missing.

        Intended for operational troubleshooting: when an operator sees an
        index name in the COS console, they can confirm its dimension /
        distance metric / creation time before deciding to drop it.
        """
        try:
            _, data = self._client.get_index(Bucket=self._bucket, Index=self._index)
        except CosServiceError as e:
            if e.get_status_code() == 404:
                return None
            raise
        return data or None


class COSVectorsFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> COSVectorsVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = _normalize_index_name(class_prefix)
        else:
            collection_name = _normalize_index_name(Dataset.gen_collection_name_by_id(dataset.id))
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.COS_VECTORS, collection_name))

        raw_keys = dify_config.COS_VECTORS_NON_FILTERABLE_METADATA_KEYS or "text"
        non_filterable_keys = [k.strip() for k in raw_keys.split(",") if k.strip()] or ["text"]

        return COSVectorsVector(
            collection_name=collection_name,
            config=COSVectorsConfig(
                region=dify_config.COS_VECTORS_REGION or "",
                secret_id=dify_config.COS_VECTORS_SECRET_ID or "",
                secret_key=dify_config.COS_VECTORS_SECRET_KEY or "",
                bucket_appid=dify_config.COS_VECTORS_BUCKET_APPID or "",
                token=dify_config.COS_VECTORS_TOKEN,
                scheme=dify_config.COS_VECTORS_SCHEME or "https",
                endpoint=dify_config.COS_VECTORS_ENDPOINT,
                timeout=dify_config.COS_VECTORS_TIMEOUT,
                distance_metric=dify_config.COS_VECTORS_DISTANCE_METRIC or "cosine",
                data_type=dify_config.COS_VECTORS_DATA_TYPE or "float32",
                max_upsert_batch_size=dify_config.COS_VECTORS_MAX_UPSERT_BATCH_SIZE,
                non_filterable_metadata_keys=non_filterable_keys,
            ),
        )
