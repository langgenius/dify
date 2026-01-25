from flask import Response, request
from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import Forbidden

from controllers.files import files_ns
from core.app_assets.storage import AppAssetSigner, AssetPath, app_asset_storage

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class AppAssetUploadQuery(BaseModel):
    expires_at: int = Field(..., description="Unix timestamp when the link expires")
    nonce: str = Field(..., description="Random string for signature")
    sign: str = Field(..., description="HMAC signature")


files_ns.schema_model(
    AppAssetUploadQuery.__name__,
    AppAssetUploadQuery.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)


@files_ns.route("/app-assets/<string:asset_type>/<string:tenant_id>/<string:app_id>/<string:resource_id>/upload")
@files_ns.route(
    "/app-assets/<string:asset_type>/<string:tenant_id>/<string:app_id>/<string:resource_id>/<string:sub_resource_id>/upload"
)
class AppAssetUploadApi(Resource):
    def put(
        self,
        asset_type: str,
        tenant_id: str,
        app_id: str,
        resource_id: str,
        sub_resource_id: str | None = None,
    ):
        args = AppAssetUploadQuery.model_validate(request.args.to_dict(flat=True))

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

        if not AppAssetSigner.verify_upload_signature(
            asset_path=asset_path,
            expires_at=args.expires_at,
            nonce=args.nonce,
            sign=args.sign,
        ):
            raise Forbidden("Invalid or expired upload link")

        content = request.get_data()
        app_asset_storage.save(asset_path, content)
        return Response(status=204)
