from urllib.parse import quote
from uuid import UUID

from flask import Response, request
from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import Forbidden, NotFound

from controllers.files import files_ns
from core.sandbox.security.sandbox_file_signer import SandboxFileDownloadPath, SandboxFileSigner
from extensions.ext_storage import storage

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class SandboxFileDownloadQuery(BaseModel):
    expires_at: int = Field(..., description="Unix timestamp when the link expires")
    nonce: str = Field(..., description="Random string for signature")
    sign: str = Field(..., description="HMAC signature")


files_ns.schema_model(
    SandboxFileDownloadQuery.__name__,
    SandboxFileDownloadQuery.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)


@files_ns.route(
    "/sandbox-file-downloads/<string:tenant_id>/<string:sandbox_id>/<string:export_id>/<path:filename>/download"
)
class SandboxFileDownloadDownloadApi(Resource):
    def get(self, tenant_id: str, sandbox_id: str, export_id: str, filename: str):
        args = SandboxFileDownloadQuery.model_validate(request.args.to_dict(flat=True))

        try:
            export_path = SandboxFileDownloadPath(
                tenant_id=UUID(tenant_id),
                sandbox_id=UUID(sandbox_id),
                export_id=export_id,
                filename=filename,
            )
        except ValueError as exc:
            raise Forbidden(str(exc)) from exc

        if not SandboxFileSigner.verify_download_signature(
            export_path=export_path,
            expires_at=args.expires_at,
            nonce=args.nonce,
            sign=args.sign,
        ):
            raise Forbidden("Invalid or expired download link")

        try:
            generator = storage.load_stream(export_path.get_storage_key())
        except FileNotFoundError as exc:
            raise NotFound("File not found") from exc

        encoded_filename = quote(filename.split("/")[-1])

        return Response(
            generator,
            mimetype="application/octet-stream",
            direct_passthrough=True,
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
            },
        )


@files_ns.route(
    "/sandbox-file-downloads/<string:tenant_id>/<string:sandbox_id>/<string:export_id>/<path:filename>/upload"
)
class SandboxFileDownloadUploadApi(Resource):
    def put(self, tenant_id: str, sandbox_id: str, export_id: str, filename: str):
        args = SandboxFileDownloadQuery.model_validate(request.args.to_dict(flat=True))

        try:
            export_path = SandboxFileDownloadPath(
                tenant_id=UUID(tenant_id),
                sandbox_id=UUID(sandbox_id),
                export_id=export_id,
                filename=filename,
            )
        except ValueError as exc:
            raise Forbidden(str(exc)) from exc

        if not SandboxFileSigner.verify_upload_signature(
            export_path=export_path,
            expires_at=args.expires_at,
            nonce=args.nonce,
            sign=args.sign,
        ):
            raise Forbidden("Invalid or expired upload link")

        storage.save(export_path.get_storage_key(), request.get_data())
        return Response(status=204)
