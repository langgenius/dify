import io
import uuid

from flask import Response, jsonify, request
from flask_restful import Resource  # type: ignore
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

from controllers.inner_tools import api
from core.tools.tool_file_manager import ToolFileManager
from models.account import Tenant


class MarkdownToPDFApi(Resource):
    def post(self):
        """Convert markdown to PDF

        This endpoint takes markdown text and converts it to a PDF document.
        Returns URL of uploaded PDF file.
        No authentication required.
        """
        # Parse request arguments
        if not request.is_json:
            return {"error": "Request must be JSON"}, 400

        data = request.get_json()
        markdown_text = data.get("markdown_text")
        title = data.get("title", "Document")

        if not markdown_text:
            return {"error": "markdown_text is required"}, 400

        # get first tenant from database
        tenant = Tenant.query.first()
        if not tenant:
            return {"error": "no tenant found"}, 400

        tenant_id = tenant.id

        # Generate PDF
        pdf_binary, filename = self._generate_pdf_binary(markdown_text, title)

        # Save the file using ToolFileManager
        tool_file = ToolFileManager().create_file_by_raw(
            user_id=None,
            tenant_id=tenant_id,
            conversation_id=None,
            file_binary=pdf_binary,
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

    def _generate_pdf_binary(self, markdown_text: str, title: str) -> tuple[bytes, str]:
        """Generate PDF from markdown text and return the binary data and filename"""
        buffer = io.BytesIO()

        # Create PDF document with proper margins
        doc = SimpleDocTemplate(
            buffer,
            pagesize=letter,
            rightMargin=72,
            leftMargin=72,
            topMargin=72,
            bottomMargin=72,
        )

        # Register Chinese font
        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))

        # Define styles
        title_style = ParagraphStyle(
            "CustomTitle",
            fontName="STSong-Light",
            fontSize=16,
            spaceAfter=30,
            leading=20,
        )

        h1_style = ParagraphStyle(
            "CustomH1",
            fontName="STSong-Light",
            fontSize=14,
            spaceAfter=12,
            spaceBefore=12,
            leading=18,
        )

        h2_style = ParagraphStyle(
            "CustomH2",
            fontName="STSong-Light",
            fontSize=13,
            spaceAfter=10,
            spaceBefore=10,
            leading=16,
        )

        normal_style = ParagraphStyle(
            "CustomNormal",
            fontName="STSong-Light",
            fontSize=12,
            spaceAfter=8,
            leading=14,
        )

        # Prepare content elements
        elements = []

        # Add title
        elements.append(Paragraph(title, title_style))
        elements.append(Spacer(1, 20))

        # Process markdown content
        lines = markdown_text.split("\n")
        for line in lines:
            if not line.strip():
                elements.append(Spacer(1, 10))
                continue

            if line.startswith("# "):
                elements.append(Paragraph(line[2:], h1_style))
            elif line.startswith("## "):
                elements.append(Paragraph(line[3:], h2_style))
            elif line.startswith("### "):
                elements.append(Paragraph(line[4:], h2_style))
            else:
                elements.append(Paragraph(line, normal_style))

        # Build PDF
        doc.build(elements)
        buffer.seek(0)

        # Generate filename
        filename = f"{title.replace(' ', '_')}_{uuid.uuid4().hex[:8]}.pdf"

        return buffer.getvalue(), filename


# Add API endpoint for getting PDF from stored file
class MarkdownToPDFFileApi(Resource):
    def get(self, file_id):
        """Get a PDF file by its tool file ID

        This endpoint retrieves a PDF file stored in the system using its tool file ID.
        No authentication required.
        """
        try:
            # Get the file binary from ToolFileManager
            result = ToolFileManager().get_file_binary(file_id)

            if result is None:
                return {"error": "File not found"}, 404

            # Safely unpack result only after confirming it's not None
            file_binary, mimetype = result

            if mimetype != "application/pdf":
                return {"error": "File is not a PDF"}, 400

            # Return the PDF
            response = Response(
                file_binary,
                mimetype="application/pdf",
                headers={
                    "Content-Disposition": f'attachment; filename="{file_id}.pdf"',
                    "Content-Type": "application/pdf",
                },
            )
            return response
        except Exception as e:
            return {"error": str(e)}, 500


api.add_resource(MarkdownToPDFApi, "/markdown-to-pdf")
api.add_resource(MarkdownToPDFFileApi, "/markdown-to-pdf/<string:file_id>")
