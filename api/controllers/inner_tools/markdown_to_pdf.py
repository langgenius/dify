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
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, SimpleDocTemplate


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

        buffer = io.BytesIO()

        # Create a PDF document with platypus for better CJK text handling
        doc = SimpleDocTemplate(buffer, pagesize=letter, rightMargin=72, leftMargin=72, topMargin=72, bottomMargin=72)

        # Register Noto Sans CJK font which should be available in the Docker container
        # (as specified in the Dockerfile: apt-get install -y fonts-noto-cjk)
        try:
            pdfmetrics.registerFont(TTFont('NotoSansCJK', '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc'))
            cjk_font_name = 'NotoSansCJK'
        except:
            # Fallback to DejaVuSans which has decent Unicode support
            try:
                pdfmetrics.registerFont(TTFont('DejaVuSans', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
                cjk_font_name = 'DejaVuSans'
            except:
                # If neither font is available, fall back to the default
                cjk_font_name = 'Helvetica'

        # Create styles for our document
        styles = getSampleStyleSheet()

        # Create a custom style for title with CJK font support
        title_style = ParagraphStyle(
            'Title', parent=styles['Title'], fontName=cjk_font_name, fontSize=16, alignment=TA_LEFT
        )

        # Create a custom style for headings with CJK font support
        h1_style = ParagraphStyle('Heading1', parent=styles['Heading1'], fontName=cjk_font_name, fontSize=14)

        h2_style = ParagraphStyle('Heading2', parent=styles['Heading2'], fontName=cjk_font_name, fontSize=13)

        h3_style = ParagraphStyle('Heading3', parent=styles['Heading3'], fontName=cjk_font_name, fontSize=12)

        # Create a custom style for normal text with CJK font support
        normal_style = ParagraphStyle(
            'Normal', parent=styles['Normal'], fontName=cjk_font_name, fontSize=12, leading=14  # Line spacing
        )

        # Create a list of flowables for our document
        flowables = []

        # Add title
        flowables.append(Paragraph(title, title_style))
        flowables.append(Paragraph("<br/>", normal_style))  # Add some space

        # Process each line of markdown and add appropriate paragraphs
        for line in markdown_text.split('\n'):
            if line.startswith('# '):  # H1 heading
                flowables.append(Paragraph(line[2:], h1_style))
            elif line.startswith('## '):  # H2 heading
                flowables.append(Paragraph(line[3:], h2_style))
            elif line.startswith('### '):  # H3 heading
                flowables.append(Paragraph(line[4:], h3_style))
            elif line.strip() == '':  # Empty line
                flowables.append(Paragraph("<br/>", normal_style))
            else:  # Regular text
                flowables.append(Paragraph(line, normal_style))

        # Build the PDF
        doc.build(flowables)
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
