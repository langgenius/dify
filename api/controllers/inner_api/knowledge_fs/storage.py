"""Trusted KnowledgeFS gateway to Dify's configured object-storage backend."""

import json
from base64 import b64decode
from binascii import Error as BinasciiError
from http import HTTPStatus
from typing import NoReturn

from flask import Response, request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError
from pydantic.alias_generators import to_camel

from controllers.common.schema import query_params_from_model, register_response_schema_models
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import knowledge_fs_inner_api_only
from fields.base import ResponseModel
from libs.exception import BaseHTTPException
from libs.helper import dump_response
from services.knowledge_fs.object_storage import (
    KNOWLEDGE_FS_OBJECT_MAX_BYTES,
    KnowledgeFSObjectList,
    KnowledgeFSObjectMetadata,
    KnowledgeFSObjectStorageChecksumError,
    KnowledgeFSObjectStorageCorruptError,
    KnowledgeFSObjectStorageError,
    KnowledgeFSObjectStorageInvalidInputError,
    KnowledgeFSObjectStorageService,
    KnowledgeFSObjectStorageTooLargeError,
    KnowledgeFSObjectStorageUnavailableError,
)

_METADATA_HEADER = "X-Knowledge-FS-Metadata"
_CHECKSUM_HEADER = "X-Knowledge-FS-Checksum-Sha256"
_CONTENT_TYPE_HEADER = "X-Knowledge-FS-Content-Type"
_MAX_ENCODED_METADATA_BYTES = 128 * 1024
_metadata_adapter = TypeAdapter(dict[str, str])


class KnowledgeFSObjectStorageHttpError(BaseHTTPException):
    """Safe HTTP representation of a KnowledgeFS storage boundary error."""

    error_code = "knowledge_fs_object_storage_failed"
    description = "KnowledgeFS object storage request failed."
    code = HTTPStatus.INTERNAL_SERVER_ERROR

    def __init__(self, *, error_code: str, description: str, status_code: HTTPStatus) -> None:
        self.error_code = error_code
        self.description = description
        self.code = status_code
        super().__init__(description)


class _CamelCaseResponse(ResponseModel):
    model_config = ConfigDict(alias_generator=to_camel)


class KnowledgeFSObjectQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(description="Logical KnowledgeFS object key")


class KnowledgeFSObjectListQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prefix: str = Field(default="", description="Logical object-key prefix")
    cursor: str | None = Field(default=None, description="Exclusive lexical key cursor")
    limit: int = Field(default=100, ge=1, le=100, description="Maximum objects to return")


class KnowledgeFSObjectMetadataResponse(_CamelCaseResponse):
    checksum_sha256_base64: str
    content_type: str | None = None
    key: str
    metadata: dict[str, str]
    size_bytes: int


class KnowledgeFSObjectListResponse(_CamelCaseResponse):
    objects: list[KnowledgeFSObjectMetadataResponse]
    next_cursor: str | None = None


class KnowledgeFSObjectHealthResponse(ResponseModel):
    ok: bool


register_response_schema_models(
    inner_api_ns,
    KnowledgeFSObjectMetadataResponse,
    KnowledgeFSObjectListResponse,
    KnowledgeFSObjectHealthResponse,
)


@inner_api_ns.route("/knowledge-fs/storage/object")
class KnowledgeFSObjectApi(Resource):
    """Read, write, or delete one logical KnowledgeFS object."""

    @knowledge_fs_inner_api_only
    @inner_api_ns.doc(params=query_params_from_model(KnowledgeFSObjectQuery))
    @inner_api_ns.response(
        HTTPStatus.OK,
        "Object stored",
        inner_api_ns.models[KnowledgeFSObjectMetadataResponse.__name__],
    )
    def put(self) -> dict[str, object]:
        try:
            query = KnowledgeFSObjectQuery.model_validate(request.args.to_dict(flat=True))
            metadata = _decode_metadata_header(request.headers.get(_METADATA_HEADER))
            body = request.stream.read(KNOWLEDGE_FS_OBJECT_MAX_BYTES + 1)
            if len(body) > KNOWLEDGE_FS_OBJECT_MAX_BYTES:
                raise KnowledgeFSObjectStorageTooLargeError(f"object exceeds max bytes {KNOWLEDGE_FS_OBJECT_MAX_BYTES}")
            result = KnowledgeFSObjectStorageService().put_object(
                body=body,
                checksum_sha256_base64=request.headers.get(_CHECKSUM_HEADER),
                content_type=request.headers.get(_CONTENT_TYPE_HEADER),
                key=query.key,
                metadata=metadata,
            )
        except ValidationError as exc:
            raise _invalid_request_error() from exc
        except KnowledgeFSObjectStorageError as exc:
            _raise_http_error(exc)
        return _metadata_response(result)

    @knowledge_fs_inner_api_only
    @inner_api_ns.doc(params=query_params_from_model(KnowledgeFSObjectQuery))
    @inner_api_ns.produces(["application/octet-stream"])
    def get(self) -> Response:
        try:
            query = KnowledgeFSObjectQuery.model_validate(request.args.to_dict(flat=True))
            service = KnowledgeFSObjectStorageService()
            metadata = service.head_object(key=query.key)
            if metadata is None:
                raise _not_found_error()
            body = service.load_stream(key=query.key)
            if body is None:
                raise _not_found_error()
        except ValidationError as exc:
            raise _invalid_request_error() from exc
        except KnowledgeFSObjectStorageError as exc:
            _raise_http_error(exc)

        response = Response(
            body,
            content_type=metadata.content_type or "application/octet-stream",
        )
        response.content_length = metadata.size_bytes
        response.headers[_CHECKSUM_HEADER] = metadata.checksum_sha256_base64
        return response

    @knowledge_fs_inner_api_only
    @inner_api_ns.doc(params=query_params_from_model(KnowledgeFSObjectQuery))
    @inner_api_ns.response(HTTPStatus.NO_CONTENT, "Object deleted")
    def delete(self) -> tuple[str, int]:
        try:
            query = KnowledgeFSObjectQuery.model_validate(request.args.to_dict(flat=True))
            KnowledgeFSObjectStorageService().delete_object(key=query.key)
        except ValidationError as exc:
            raise _invalid_request_error() from exc
        except KnowledgeFSObjectStorageError as exc:
            _raise_http_error(exc)
        return "", HTTPStatus.NO_CONTENT


@inner_api_ns.route("/knowledge-fs/storage/object/metadata")
class KnowledgeFSObjectMetadataApi(Resource):
    """Read portable metadata for one logical KnowledgeFS object."""

    @knowledge_fs_inner_api_only
    @inner_api_ns.doc(params=query_params_from_model(KnowledgeFSObjectQuery))
    @inner_api_ns.response(
        HTTPStatus.OK,
        "Object metadata",
        inner_api_ns.models[KnowledgeFSObjectMetadataResponse.__name__],
    )
    def get(self) -> dict[str, object]:
        try:
            query = KnowledgeFSObjectQuery.model_validate(request.args.to_dict(flat=True))
            result = KnowledgeFSObjectStorageService().head_object(key=query.key)
            if result is None:
                raise _not_found_error()
        except ValidationError as exc:
            raise _invalid_request_error() from exc
        except KnowledgeFSObjectStorageError as exc:
            _raise_http_error(exc)
        return _metadata_response(result)


@inner_api_ns.route("/knowledge-fs/storage/objects")
class KnowledgeFSObjectListApi(Resource):
    """List logical KnowledgeFS objects with bounded keyset pagination."""

    @knowledge_fs_inner_api_only
    @inner_api_ns.doc(params=query_params_from_model(KnowledgeFSObjectListQuery))
    @inner_api_ns.response(
        HTTPStatus.OK,
        "Object page",
        inner_api_ns.models[KnowledgeFSObjectListResponse.__name__],
    )
    def get(self) -> dict[str, object]:
        try:
            query = KnowledgeFSObjectListQuery.model_validate(request.args.to_dict(flat=True))
            result = KnowledgeFSObjectStorageService().list_objects(
                cursor=query.cursor,
                limit=query.limit,
                prefix=query.prefix,
            )
        except ValidationError as exc:
            raise _invalid_request_error() from exc
        except KnowledgeFSObjectStorageError as exc:
            _raise_http_error(exc)
        return _list_response(result)


@inner_api_ns.route("/knowledge-fs/storage/health")
class KnowledgeFSObjectHealthApi(Resource):
    """Report whether Dify storage satisfies KnowledgeFS portable requirements."""

    @knowledge_fs_inner_api_only
    @inner_api_ns.response(
        HTTPStatus.OK,
        "Storage available",
        inner_api_ns.models[KnowledgeFSObjectHealthResponse.__name__],
    )
    @inner_api_ns.response(HTTPStatus.SERVICE_UNAVAILABLE, "Storage unavailable")
    def get(self) -> dict[str, bool] | tuple[dict[str, bool], int]:
        if KnowledgeFSObjectStorageService().health():
            return {"ok": True}
        return {"ok": False}, HTTPStatus.SERVICE_UNAVAILABLE


def _decode_metadata_header(value: str | None) -> dict[str, str]:
    if value is None:
        return {}
    if len(value.encode()) > _MAX_ENCODED_METADATA_BYTES:
        raise KnowledgeFSObjectStorageInvalidInputError("object metadata header is too large")
    try:
        padding = "=" * (-len(value) % 4)
        decoded = b64decode(value + padding, altchars=b"-_", validate=True)
        return _metadata_adapter.validate_json(decoded)
    except (BinasciiError, UnicodeEncodeError, ValidationError, json.JSONDecodeError) as exc:
        raise KnowledgeFSObjectStorageInvalidInputError("object metadata header is invalid") from exc


def _metadata_response(metadata: KnowledgeFSObjectMetadata) -> dict[str, object]:
    return dump_response(KnowledgeFSObjectMetadataResponse, metadata)


def _list_response(result: KnowledgeFSObjectList) -> dict[str, object]:
    return dump_response(KnowledgeFSObjectListResponse, result)


def _raise_http_error(error: KnowledgeFSObjectStorageError) -> NoReturn:
    if isinstance(error, KnowledgeFSObjectStorageTooLargeError):
        raise KnowledgeFSObjectStorageHttpError(
            error_code="knowledge_fs_object_too_large",
            description="KnowledgeFS object exceeds the configured size limit.",
            status_code=HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
        ) from error
    if isinstance(error, KnowledgeFSObjectStorageChecksumError):
        raise KnowledgeFSObjectStorageHttpError(
            error_code="knowledge_fs_object_checksum_mismatch",
            description="KnowledgeFS object checksum does not match the request body.",
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
        ) from error
    if isinstance(error, KnowledgeFSObjectStorageInvalidInputError):
        raise _invalid_request_error() from error
    if isinstance(error, KnowledgeFSObjectStorageCorruptError):
        raise KnowledgeFSObjectStorageHttpError(
            error_code="knowledge_fs_object_corrupt",
            description="KnowledgeFS object metadata is inconsistent.",
            status_code=HTTPStatus.BAD_GATEWAY,
        ) from error
    if isinstance(error, KnowledgeFSObjectStorageUnavailableError):
        raise KnowledgeFSObjectStorageHttpError(
            error_code="knowledge_fs_object_storage_unavailable",
            description="Dify object storage is unavailable for KnowledgeFS.",
            status_code=HTTPStatus.SERVICE_UNAVAILABLE,
        ) from error
    raise KnowledgeFSObjectStorageHttpError(
        error_code="knowledge_fs_object_storage_failed",
        description="KnowledgeFS object storage request failed.",
        status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
    ) from error


def _invalid_request_error() -> KnowledgeFSObjectStorageHttpError:
    return KnowledgeFSObjectStorageHttpError(
        error_code="knowledge_fs_object_storage_invalid_request",
        description="KnowledgeFS object storage request is invalid.",
        status_code=HTTPStatus.BAD_REQUEST,
    )


def _not_found_error() -> KnowledgeFSObjectStorageHttpError:
    return KnowledgeFSObjectStorageHttpError(
        error_code="knowledge_fs_object_not_found",
        description="KnowledgeFS object was not found.",
        status_code=HTTPStatus.NOT_FOUND,
    )
