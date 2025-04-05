import io
import urllib.parse
import uuid
from pathlib import Path
from typing import Optional, Tuple

import markdown
from controllers.inner_tools import api
from core.tools.tool_file_manager import ToolFileManager
from flask import Response, jsonify, request
from flask_restful import Resource  # type: ignore
from models.account import Tenant
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas


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
        markdown_text = data.get('markdown_text')
        title = data.get('title', 'Document')

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
        tool_file = ToolFileManager.create_file_by_raw(
            user_id=None,
            tenant_id=tenant_id,
            conversation_id=None,
            file_binary=pdf_binary,
            mimetype='application/pdf',
        )

        # Return the file info with URL
        file_url = ToolFileManager.sign_file(tool_file.id, '.pdf')
        return jsonify({'url': file_url, 'file_id': tool_file.id, 'file_name': filename, 'file_size': tool_file.size})

    def _generate_pdf_binary(self, markdown_text: str, title: str) -> Tuple[bytes, str]:
        """Generate PDF from markdown text and return the binary data and filename"""
        # Convert markdown to HTML (for potential future enhancement)
        html_content = markdown.markdown(markdown_text, extensions=['extra'])

        # Create PDF using reportlab
        buffer = io.BytesIO()
        pdf = canvas.Canvas(buffer, pagesize=letter)

        # Add title
        pdf.setFont("Helvetica-Bold", 16)
        pdf.drawString(72, 760, title)

        # Add markdown content
        pdf.setFont("Helvetica", 12)
        y_position = 730

        # Simple text rendering - each line as a separate line in the PDF
        for line in markdown_text.split('\n'):
            if line.startswith('# '):  # H1 heading
                pdf.setFont("Helvetica-Bold", 14)
                pdf.drawString(72, y_position, line[2:])
                y_position -= 20
                pdf.setFont("Helvetica", 12)
            elif line.startswith('## '):  # H2 heading
                pdf.setFont("Helvetica-Bold", 13)
                pdf.drawString(72, y_position, line[3:])
                y_position -= 18
                pdf.setFont("Helvetica", 12)
            elif line.startswith('### '):  # H3 heading
                pdf.setFont("Helvetica-Bold", 12)
                pdf.drawString(72, y_position, line[4:])
                y_position -= 16
                pdf.setFont("Helvetica", 12)
            elif line.strip() == '':  # Empty line
                y_position -= 12
            else:  # Regular text
                pdf.drawString(72, y_position, line)
                y_position -= 14

            # Check if we need a new page
            if y_position < 72:
                pdf.showPage()
                y_position = 760
                pdf.setFont("Helvetica", 12)

        # Save the PDF
        pdf.save()
        buffer.seek(0)

        # Generate a filename based on the title
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
            result = ToolFileManager.get_file_binary(file_id)

            if result is None:
                return {"error": "File not found"}, 404

            # Safely unpack result only after confirming it's not None
            file_binary, mimetype = result

            if mimetype != 'application/pdf':
                return {"error": "File is not a PDF"}, 400

            # Return the PDF
            response = Response(
                file_binary,
                mimetype='application/pdf',
                headers={
                    'Content-Disposition': f'attachment; filename="{file_id}.pdf"',
                    'Content-Type': 'application/pdf',
                },
            )
            return response
        except Exception as e:
            return {"error": str(e)}, 500


api.add_resource(MarkdownToPDFApi, '/markdown-to-pdf')
api.add_resource(MarkdownToPDFFileApi, '/markdown-to-pdf/<string:file_id>')
