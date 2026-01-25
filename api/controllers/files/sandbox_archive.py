from uuid import UUID

from flask import Response, request
from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import Forbidden, NotFound

from controllers.files import files_ns
from core.sandbox.security.archive_signer import SandboxArchivePath, SandboxArchiveSigner
from extensions.ext_storage import storage

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class SandboxArchiveQuery(BaseModel):
    expires_at: int = Field(..., description="Unix timestamp when the link expires")
    nonce: str = Field(..., description="Random string for signature")
    sign: str = Field(..., description="HMAC signature")


files_ns.schema_model(
    SandboxArchiveQuery.__name__,
    SandboxArchiveQuery.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)


@files_ns.route("/sandbox-archives/<string:tenant_id>/<string:sandbox_id>/download")
class SandboxArchiveDownloadApi(Resource):
    def get(self, tenant_id: str, sandbox_id: str):
        args = SandboxArchiveQuery.model_validate(request.args.to_dict(flat=True))

        try:
            archive_path = SandboxArchivePath(tenant_id=UUID(tenant_id), sandbox_id=UUID(sandbox_id))
        except ValueError as exc:
            raise Forbidden(str(exc)) from exc

        if not SandboxArchiveSigner.verify_download_signature(
            archive_path=archive_path,
            expires_at=args.expires_at,
            nonce=args.nonce,
            sign=args.sign,
        ):
            raise Forbidden("Invalid or expired download link")

        try:
            generator = storage.load_stream(archive_path.get_storage_key())
        except FileNotFoundError as exc:
            raise NotFound("Archive not found") from exc

        return Response(
            generator,
            mimetype="application/gzip",
            direct_passthrough=True,
        )


@files_ns.route("/sandbox-archives/<string:tenant_id>/<string:sandbox_id>/upload")
class SandboxArchiveUploadApi(Resource):
    def put(self, tenant_id: str, sandbox_id: str):
        args = SandboxArchiveQuery.model_validate(request.args.to_dict(flat=True))

        try:
            archive_path = SandboxArchivePath(tenant_id=UUID(tenant_id), sandbox_id=UUID(sandbox_id))
        except ValueError as exc:
            raise Forbidden(str(exc)) from exc

        if not SandboxArchiveSigner.verify_upload_signature(
            archive_path=archive_path,
            expires_at=args.expires_at,
            nonce=args.nonce,
            sign=args.sign,
        ):
            raise Forbidden("Invalid or expired upload link")

        storage.save(archive_path.get_storage_key(), request.get_data())
        return Response(status=204)
