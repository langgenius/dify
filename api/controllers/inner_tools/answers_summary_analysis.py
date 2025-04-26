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
            exam_answers_file_id = args_json.get('exam_answers').get('related_id')
        except json.JSONDecodeError:
            return {"error": "workflow_run_args must be a valid JSON string"}, 400

        if not user_answers_file_id:
            return {"error": "user_answers file_id is required"}, 400
        if not exam_answers_file_id:
            return {"error": "exam_answers file_id is required"}, 400

        # Read the exam answers file to get categories and correct answers
        exam_answers_file_content, _ = self._read_file_with_encoding_detection(exam_answers_file_id)
        if not exam_answers_file_content:
            return {"error": "Failed to read exam answers file or file not found"}, 404

        # Parse the exam answers file
        exam_answers, categories, correct_answer = self._parse_exam_answers(exam_answers_file_content)
        if not categories or not correct_answer:
            return {"error": "Failed to parse categories and correct answers from exam file"}, 400

        # Read the user answers file content with encoding detection
        user_answers_file_content, _ = self._read_file_with_encoding_detection(user_answers_file_id)
        if not user_answers_file_content:
            return {"error": "Failed to read user answers file or file not found"}, 404

        # Parse the user answers
        user_answers = self._parse_answers(user_answers_file_content)
        if not user_answers:
            return {"error": "Failed to parse user answers from file"}, 400

        # Calculate category statistics
        summary_analysis = self._calculate_category_statistics(user_answers, correct_answer, categories)

        # Return the response
        return jsonify(
            {'user_answers': user_answers, 'summary_analysis': summary_analysis, 'exam_answers': exam_answers}
        )

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
            # Filter out any None values
            encodings_to_try = [enc for enc in encodings_to_try if enc is not None]
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

    def _parse_exam_answers(self, file_content: str) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[str]]:
        """Parse exam answers from the file content.

        Expected format is CSV with columns:
        - 题号 (Question Number)
        - 题目分类 (Category)
        - 正确答案 (Correct Answer)
        - 题目分析 (Question Analysis)

        Returns:
            Tuple containing:
            - exam_answers: List of dictionaries with question details
            - categories: List of categories with question numbers
            - correct_answer: List of correct answers
        """
        try:
            import csv
            from collections import defaultdict
            from io import StringIO

            # Create a CSV reader from the string content
            csv_file = StringIO(file_content)
            csv_reader = csv.reader(csv_file)

            # Get the header row
            header = next(csv_reader, None)
            if not header:
                return [], [], []

            exam_answers = []
            category_map = defaultdict(list)
            correct_answers = [""] * 1000  # Initialize with empty strings, we'll trim later
            max_question_num = 0

            for row in csv_reader:
                if not row or len(row) < 3:  # Skip rows with insufficient data
                    continue

                try:
                    question_num = int(row[0].strip())
                    category = row[1].strip()
                    correct_ans = row[2].strip()
                    analysis = row[3].strip() if len(row) > 3 else ""

                    # Record the maximum question number
                    max_question_num = max(max_question_num, question_num)

                    # Add to exam_answers
                    exam_answers.append(
                        {
                            "question_num": question_num,
                            "category": category,
                            "correct_answer": correct_ans,
                            "analysis": analysis,
                        }
                    )

                    # Map category to question numbers
                    category_map[category].append(str(question_num))

                    # Set correct answer
                    correct_answers[question_num - 1] = correct_ans
                except (ValueError, IndexError):
                    continue

            # Trim correct_answers to the maximum question number
            correct_answers = correct_answers[:max_question_num]

            # Convert category_map to the expected categories format
            categories = [{"name": cat, "items": items} for cat, items in category_map.items()]

            return exam_answers, categories, correct_answers
        except Exception as e:
            # Log the exception for debugging
            print(f"Error parsing exam answers: {str(e)}")
            return [], [], []

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
        self, parsed_answers: List[Dict[str, Any]], correct_answer: List[str], categories: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Calculate statistics by category.

        Args:
            parsed_answers: List of dictionaries containing parsed student answers
            correct_answer: List of correct answers for all questions
            categories: List of question categories

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

        summary = []

        # For each category in the list
        for category in categories:
            # Extract category name and question numbers
            if isinstance(category, dict):
                # Original format with 'name' and 'items'
                category_name = category.get('name', '')
                question_numbers = category.get('items', [])

                if not category_name or not question_numbers:
                    category_name = next(iter(category))
                    question_numbers = category.get(category_name, [])
            elif isinstance(category, list) and len(category) == 2:
                # New format: ['category_name', ['30', '36', '39', '50']]
                category_name = category[0]
                question_numbers = category[1]
            else:
                continue  # Skip invalid category format

            total_answers = 0
            correct_answers = 0

            for answer_data in parsed_answers:
                answers = answer_data.get('answers', [])

                # Check each question in this category
                for q_num in question_numbers:
                    try:
                        # Convert to 0-based index
                        idx = int(q_num) - 1
                        if idx < 0 or idx >= len(answers) or idx >= len(correct_answer):
                            continue

                        student_answer = answers[idx].strip()
                        # Skip empty answers or placeholders
                        if not student_answer or student_answer in ['#', '?', '-']:
                            continue

                        total_answers += 1
                        # Compare with correct answer (case insensitive)
                        if student_answer.lower() == correct_answer[idx].lower():
                            correct_answers += 1
                    except (ValueError, IndexError):
                        continue

            # Calculate statistics
            correct_rate = correct_answers / total_answers if total_answers > 0 else 0
            error_count = total_answers - correct_answers

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
        html_template = data.get('html_template')

        if not summary_analysis:
            return {"error": "summary_analysis is required"}, 400

        if not html_template:  # default template
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
                    .category-item {
                        margin-bottom: 20px;
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
                            <div class="bar" style="width: 500px; position: relative; background-color: #e1e9f3;">
                                <div style="position: absolute; left: 0; top: 0; height: 100%; width: {% if category.error_count > 0 %}{% if (1 - category.correct_rate) * 100 < 0.1 %}0.1{% else %}{{ (1 - category.correct_rate) * 100 }}{% endif %}{% else %}0{% endif %}%; background-color: #7eb0e3; display: flex; align-items: center; justify-content: center;">
                                    {% if category.error_count > 0 %}
                                    <span style="color: #333; font-size: 14px;">做错{{ category.error_count }}</span>
                                    {% endif %}
                                </div>
                                <div style="position: absolute; right: 10px; top: 0; height: 100%; display: flex; align-items: center;">
                                    <span style="color: #666;">总考生数{{ category.total_count }}</span>
                                </div>
                                <div style="position: absolute; right: -130px; top: 0; height: 100%; display: flex; align-items: center;">
                                    <span style="color: #666;">失分比{% if category.error_count == 0 %}0{% else %}{{ ((1 - category.correct_rate) * 100)|round }}{% endif %}%</span>
                                </div>
                            </div>
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
