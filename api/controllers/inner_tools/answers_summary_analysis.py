import io
import json
from typing import Any, Dict, List, Optional, Tuple

import chardet
from controllers.inner_tools import api
from extensions.ext_database import db
from extensions.ext_storage import storage
from flask import jsonify, request
from flask_restful import Resource  # type: ignore
from models.model import UploadFile
from models.workflow import WorkflowRun


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
    ) -> Dict[str, float]:
        """Calculate statistics by category.

        For demonstration, we're assuming:
        - Correct answers are predetermined or defined in the system
        - We're calculating the percentage of correct answers per category
        """
        # Simplified example: assume we have correct answers defined
        # In a real system, these would come from a database or predefined source
        # For now, we'll just count non-empty answers

        summary = {}

        # For each category in the list
        for category in categories:
            category_name = category.get('name', '')
            question_numbers = category.get('items', [])

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
            rate = valid_answers / total_answers if total_answers > 0 else 0
            summary[category_name] = round(rate, 2)

        return summary


# Add API endpoint
api.add_resource(AnswersSummaryAnalysisApi, '/answers-summary-analysis')
