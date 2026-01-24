from urllib.parse import quote

from flask import Response, request
from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import Forbidden, NotFound

from controllers.files import files_ns
from core.app_assets.storage import AppAssetSigner, AssetPath, app_asset_storage
from extensions.ext_storage import storage

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class AppAssetDownloadQuery(BaseModel):
    expires_at: int = Field(..., description="Unix timestamp when the link expires")
    nonce: str = Field(..., description="Random string for signature")
    sign: str = Field(..., description="HMAC signature")


files_ns.schema_model(
    AppAssetDownloadQuery.__name__,
    AppAssetDownloadQuery.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)


@files_ns.route("/app-assets/<string:asset_type>/<string:tenant_id>/<string:app_id>/<string:resource_id>/download")
@files_ns.route(
    "/app-assets/<string:asset_type>/<string:tenant_id>/<string:app_id>/<string:resource_id>/<string:sub_resource_id>/download"
)
class AppAssetDownloadApi(Resource):
    def get(
        self,
        asset_type: str,
        tenant_id: str,
        app_id: str,
        resource_id: str,
        sub_resource_id: str | None = None,
    ):
        args = AppAssetDownloadQuery.model_validate(request.args.to_dict(flat=True))

        try:
            asset_path = AssetPath.from_components(
                asset_type=asset_type,
                tenant_id=tenant_id,
                app_id=app_id,
                resource_id=resource_id,
                sub_resource_id=sub_resource_id,
            )
        except ValueError as exc:
            raise Forbidden(str(exc)) from exc

        if not AppAssetSigner.verify_download_signature(
            asset_path=asset_path,
            expires_at=args.expires_at,
            nonce=args.nonce,
            sign=args.sign,
        ):
            raise Forbidden("Invalid or expired download link")

        storage_key = app_asset_storage.get_storage_key(asset_path)

        try:
            generator = storage.load_stream(storage_key)
        except FileNotFoundError as exc:
            raise NotFound("File not found") from exc

        encoded_filename = quote(storage_key.split("/")[-1])

        return Response(
            generator,
            mimetype="application/octet-stream",
            direct_passthrough=True,
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
            },
        )
