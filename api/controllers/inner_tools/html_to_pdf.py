import uuid

from flask import jsonify, request
from flask_restful import Resource  # type: ignore
from weasyprint import HTML

from controllers.inner_tools import api
from core.tools.tool_file_manager import ToolFileManager
from models.account import Tenant


class HtmlToPdfApi(Resource):
    def post(self):
        """Generate a PDF from the provided HTML content."""
        if not request.data:
            return {"error": "No HTML content provided"}, 400

        html_content = request.data

        # Generate PDF
        html = HTML(string=html_content)
        pdf_file = html.write_pdf()

        if pdf_file is None:
            return {"error": "Failed to generate PDF"}, 500

        # Get the first tenant from database (similar to markdown_to_pdf.py)
        tenant = Tenant.query.first()
        if not tenant:
            return {"error": "No tenant found"}, 400

        tenant_id = tenant.id

        # Generate filename
        filename = f"html_to_pdf_{uuid.uuid4().hex[:8]}.pdf"

        # Save the file using ToolFileManager
        tool_file = ToolFileManager().create_file_by_raw(
            user_id=None,
            tenant_id=tenant_id,
            conversation_id=None,
            file_binary=pdf_file,
            mimetype="application/pdf",
        )

        # Return the file info with URL
        file_url = ToolFileManager.sign_file(tool_file.id, ".pdf")
        return jsonify(
            {
                "url": file_url,
                "file_id": tool_file.id,
                "file_name": filename,
                "file_size": tool_file.size,
            }
        )


api.add_resource(HtmlToPdfApi, "/html-to-pdf")
