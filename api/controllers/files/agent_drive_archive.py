from urllib.parse import quote

from flask import Response, request
from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import Forbidden, NotFound

from controllers.common.file_response import enforce_download_for_html
from controllers.common.schema import register_schema_models
from controllers.files import files_ns
from extensions.ext_database import db
from models.agent import AgentDriveFileKind
from services.agent_drive_service import AgentDriveError, AgentDriveService


class AgentDriveArchiveMemberQuery(BaseModel):
    tenant_id: str = Field(..., description="Tenant ID")
    agent_id: str = Field(..., description="Agent ID")
    key: str = Field(..., description="Virtual drive key")
    archive_file_kind: AgentDriveFileKind = Field(..., description="Archive file kind")
    archive_file_id: str = Field(..., description="Archive file id")
    member_path: str = Field(..., description="Zip member path")
    timestamp: str = Field(..., description="Unix timestamp")
    nonce: str = Field(..., description="Random nonce")
    sign: str = Field(..., description="HMAC signature")
    as_attachment: bool = Field(default=False, description="Download as attachment")


register_schema_models(files_ns, AgentDriveArchiveMemberQuery)


@files_ns.route("/agent-drive/archive-member")
class AgentDriveArchiveMemberApi(Resource):
    @files_ns.doc("get_agent_drive_archive_member")
    @files_ns.doc(description="Download a lazily resolved Agent Skill archive member by signed parameters")
    def get(self):
        args = AgentDriveArchiveMemberQuery.model_validate(request.args.to_dict(flat=True))
        if not AgentDriveService.verify_archive_member_signature(
            tenant_id=args.tenant_id,
            agent_id=args.agent_id,
            key=args.key,
            archive_file_kind=args.archive_file_kind,
            archive_file_id=args.archive_file_id,
            member_path=args.member_path,
            timestamp=args.timestamp,
            nonce=args.nonce,
            sign=args.sign,
        ):
            raise Forbidden("Invalid request.")
        try:
            payload, mime_type, filename = AgentDriveService().load_archive_member_for_signed_request(
                tenant_id=args.tenant_id,
                agent_id=args.agent_id,
                key=args.key,
                archive_file_kind=args.archive_file_kind,
                archive_file_id=args.archive_file_id,
                member_path=args.member_path,
                session=db.session,
            )
        except AgentDriveError as exc:
            raise NotFound(exc.message) from exc

        response = Response(payload, mimetype=mime_type, direct_passthrough=True, headers={})
        response.headers["Content-Length"] = str(len(payload))
        if args.as_attachment and filename:
            encoded_filename = quote(filename)
            response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{encoded_filename}"
        enforce_download_for_html(response, mime_type=mime_type, filename=filename, extension="")
        return response
