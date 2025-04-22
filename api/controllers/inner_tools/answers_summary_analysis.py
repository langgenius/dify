import json
import uuid
from typing import Any, Dict, List, Optional, Tuple

import chardet
from controllers.inner_tools import api
from core.tools.tool_file_manager import ToolFileManager
from extensions.ext_database import db
from extensions.ext_storage import storage
from flask import jsonify, request, send_file
from flask_restful import Resource  # type: ignore
from jinja2 import Template
from models.account import Tenant
from models.model import UploadFile
from models.workflow import WorkflowRun
from weasyprint import HTML


class AnswersSummaryAnalysisApi(Resource):
    def post(self):
        """Analyze answers and provide summary statistics by category.

        This endpoint takes a file_id of an answer sheet and a JSON payload of problem categories.
        It reads the file, parses answers, and calculates success rates by category.
        """
        # Parse request arguments
        if not request.is_json:
            return {"error": "Request must be JSON"}, 400

        data = request.get_json()
        categories = data.get('categories')
        workflow_run_id = data.get('workflow_run_id')

        # read the arg of this workflow run
        workflow_run = WorkflowRun.query.filter_by(id=workflow_run_id).first()
        if not workflow_run:
            return {"error": "workflow_run not found"}, 400

        workflow_run_args = workflow_run.inputs
        if not workflow_run_args:
            return {"error": "workflow_run_args not found"}, 400

        # get the file_id from the workflow_run_args
        try:
            args_json = json.loads(workflow_run_args)
            user_answers_file_id = args_json.get('user_answers').get('related_id')
        except json.JSONDecodeError:
            return {"error": "workflow_run_args must be a valid JSON string"}, 400

        if not user_answers_file_id:
            return {"error": "file_id is required"}, 400
        if not categories:
            return {"error": "categories is required"}, 400

        # Read the file content with encoding detection
        file_content, detected_encoding = self._read_file_with_encoding_detection(user_answers_file_id)
        if not file_content:
            return {"error": "Failed to read file or file not found"}, 404

        # Parse the answers
        parsed_answers = self._parse_answers(file_content)
        if not parsed_answers:
            return {"error": "Failed to parse answers from file"}, 400

        # Calculate category statistics
        summary_analysis = self._calculate_category_statistics(parsed_answers, categories)

        # Return the response
        return jsonify({'user_answers': parsed_answers, 'summary_analysis': summary_analysis})

    def _read_file_with_encoding_detection(self, file_id: str) -> Tuple[Optional[str], Optional[str]]:
        """Read file content with automatic encoding detection."""
        try:
            upload_file = db.session.query(UploadFile).filter(UploadFile.id == file_id).first()

            # Get the file content from storage
            file_content = storage.load_once(upload_file.key)

            # Detect the encoding
            detection = chardet.detect(file_content)
            encoding = detection.get('encoding', 'utf-8')

            # Try multiple encodings if needed
            encodings_to_try = [encoding, 'utf-8', 'gbk', 'gb2312', 'iso-8859-1', 'latin-1']
            decoded_content = None
            detected_encoding = None

            for enc in encodings_to_try:
                try:
                    decoded_content = file_content.decode(enc)
                    detected_encoding = enc
                    break
                except UnicodeDecodeError:
                    continue

            return decoded_content, detected_encoding
        except Exception as e:
            print(f"Error reading file: {str(e)}")
            return None, None

    def _parse_answers(self, file_content: str) -> List[Dict[str, Any]]:
        """Parse answers from the file content.

        Expected format is CSV with the following structure:
        - First column: Student ID (准考证号)
        - Second column: Name (姓名)
        - Third column: Score (得分)
        - Remaining columns: Answers to questions (1, 2, 3, etc.)
        """
        try:
            import csv
            from io import StringIO

            # Create a CSV reader from the string content
            csv_file = StringIO(file_content)
            csv_reader = csv.reader(csv_file)

            # Get the header row
            header = next(csv_reader, None)
            if not header:
                return []

            result = []
            for row in csv_reader:
                if not row or len(row) < 4:  # Skip empty rows or rows with insufficient data
                    continue

                # Extract student ID and name
                student_id = row[0].strip()
                name = row[1].strip()

                # Extract answers (skip ID, name, and score columns)
                answers = [ans.strip() for ans in row[3:]]

                result.append({'user_name': name, 'code': student_id, 'answers': answers})

            return result
        except Exception as e:
            # Log the exception for debugging
            print(f"Error parsing answers: {str(e)}")
            return []

    def _calculate_category_statistics(
        self, parsed_answers: List[Dict[str, Any]], categories: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Calculate statistics by category.

        For demonstration, we're assuming:
        - Correct answers are predetermined or defined in the system
        - We're calculating the percentage of correct answers per category

        Returns:
            A list of dictionaries with category statistics:
            [
                {
                    "category": str,
                    "correct_rate": float,
                    "error_count": int,
                    "total_count": int
                }
            ]
        """
        # Simplified example: assume we have correct answers defined
        # In a real system, these would come from a database or predefined source
        # For now, we'll just count non-empty answers

        summary = []

        # For each category in the list
        for category in categories:
            # Based on the image, categories format is like ['理由原因类': [...], '时间类': [...]]
            # Extract category name (the key) and question numbers (the values)
            if isinstance(category, dict):
                # Original format with 'name' and 'items'
                category_name = category.get('name', '')
                question_numbers = category.get('items', [])

                if not category_name or not question_numbers:
                    category_name = next(iter(category))
                    question_numbers = category.get(category_name, [])
            elif isinstance(category, list) and len(category) == 2:
                # New format from image: ['category_name', ['30', '36', '39', '50']]
                category_name = category[0]
                question_numbers = category[1]
            else:
                continue  # Skip invalid category format

            total_answers = 0
            valid_answers = 0

            for answer_data in parsed_answers:
                answers = answer_data.get('answers', [])

                # Check each question in this category
                for q_num in question_numbers:
                    try:
                        # Convert to 0-based index
                        idx = int(q_num) - 1
                        if idx < 0 or idx >= len(answers):
                            continue

                        total_answers += 1
                        # Count non-empty and non-placeholder answers as valid
                        if answers[idx] and answers[idx] not in ['#', '?', '-']:
                            valid_answers += 1
                    except (ValueError, IndexError):
                        continue

            # Calculate percentage
            correct_rate = valid_answers / total_answers if total_answers > 0 else 0
            error_count = total_answers - valid_answers

            summary.append(
                {
                    "category": category_name,
                    "correct_rate": round(correct_rate, 2),
                    "error_count": error_count,
                    "total_count": total_answers,
                }
            )

        return summary


class GenerateAnalysisReportApi(Resource):
    def post(self):
        """Generate a PDF analysis report based on the provided data."""
        if not request.is_json:
            return {"error": "Request must be JSON"}, 400

        data = request.get_json()
        summary_analysis = data.get('summary_analysis')
        school_name = data.get('school_name', '山东单县一中')  # Default value if not provided

        if not summary_analysis:
            return {"error": "summary_analysis is required"}, 400

        # HTML template for the report
        html_template = """
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body {
                    font-family: "SimHei", "Microsoft YaHei", sans-serif;
                    padding: 20px;
                }
                .title {
                    text-align: center;
                    font-size: 24px;
                    margin-bottom: 20px;
                }
                .subtitle {
                    text-align: center;
                    font-size: 18px;
                    color: #666;
                    margin-bottom: 30px;
                }
                .summary-section {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 30px;
                }
                .summary-item {
                    margin: 10px 0;
                }
                .analysis-section {
                    margin-top: 20px;
                }
                .category-bar {
                    display: flex;
                    align-items: center;
                    margin: 10px 0;
                }
                .bar {
                    background-color: #e6f3ff;
                    height: 20px;
                    margin-right: 10px;
                }
                .stats {
                    color: #666;
                }
            </style>
        </head>
        <body>
            <h1 class="title">模拟考分析报告</h1>
            <div class="subtitle">Analysis of Examination</div>
            
            <h2 class="title">{{ school_name }}</h2>
            
            <div class="summary-section">
                <div class="left-summary">
                    <div class="summary-item">总参考人数:</div>
                    <div class="summary-item">总平均分:</div>
                    <div class="summary-item">省内排名:</div>
                </div>
                <div class="right-summary">
                    <div class="summary-item">省内总人数:</div>
                    <div class="summary-item">省内平均分:</div>
                    <div class="summary-item">全国排名:</div>
                </div>
            </div>

            <div class="analysis-section">
                <h3>题目分析:</h3>
                
                {% for category in summary_analysis %}
                <div class="category-item">
                    <div>{{ category.category }}</div>
                    <div class="category-bar">
                        <div class="bar" style="width: {{ category.error_count * 2 }}px;"></div>
                        <span class="stats">
                            错误数{{ category.error_count }} / 总数{{ category.total_count }}
                            失分比{{ (1 - category.correct_rate) * 100 }}%
                        </span>
                    </div>
                </div>
                {% endfor %}
            </div>
        </body>
        </html>
        """

        # Create the HTML with the template
        template = Template(html_template)
        html_content = template.render(school_name=school_name, summary_analysis=summary_analysis)

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
        filename = f"analysis_report_{school_name}_{uuid.uuid4().hex[:8]}.pdf"

        # Save the file using ToolFileManager
        tool_file = ToolFileManager.create_file_by_raw(
            user_id=None,
            tenant_id=tenant_id,
            conversation_id=None,
            file_binary=pdf_file,
            mimetype='application/pdf',
        )

        # Return the file info with URL
        file_url = ToolFileManager.sign_file(tool_file.id, '.pdf')
        return jsonify({'url': file_url, 'file_id': tool_file.id, 'file_name': filename, 'file_size': tool_file.size})


# Add API endpoints
api.add_resource(AnswersSummaryAnalysisApi, '/answers-summary-analysis')
api.add_resource(GenerateAnalysisReportApi, '/generate-analysis-report')
