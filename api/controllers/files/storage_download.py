from urllib.parse import quote, unquote

from flask import Response, request
from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import Forbidden, NotFound

from controllers.files import files_ns
from extensions.ext_storage import storage
from extensions.storage.file_presign_storage import FilePresignStorage

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class StorageDownloadQuery(BaseModel):
    timestamp: str = Field(..., description="Unix timestamp used in the signature")
    nonce: str = Field(..., description="Random string for signature")
    sign: str = Field(..., description="HMAC signature")


files_ns.schema_model(
    StorageDownloadQuery.__name__,
    StorageDownloadQuery.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)


@files_ns.route("/storage/<path:filename>/download")
class StorageFileDownloadApi(Resource):
    def get(self, filename: str):
        filename = unquote(filename)

        args = StorageDownloadQuery.model_validate(request.args.to_dict(flat=True))

        if not FilePresignStorage.verify_signature(
            filename=filename,
            timestamp=args.timestamp,
            nonce=args.nonce,
            sign=args.sign,
        ):
            raise Forbidden("Invalid or expired download link")

        try:
            generator = storage.load_stream(filename)
        except FileNotFoundError:
            raise NotFound("File not found")

        encoded_filename = quote(filename.split("/")[-1])

        return Response(
            generator,
            mimetype="application/octet-stream",
            direct_passthrough=True,
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
            },
        )
