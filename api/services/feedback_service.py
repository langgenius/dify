import csv
import io
import json
from datetime import datetime

from flask import Response
from sqlalchemy import or_

from extensions.ext_database import db
from models.model import Account, App, Conversation, Message, MessageFeedback


class FeedbackService:
    @staticmethod
    def export_feedbacks(
        app_id: str,
        from_source: str | None = None,
        rating: str | None = None,
        has_comment: bool | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        format_type: str = "csv",
    ):
        """
        Export feedback data with message details for analysis

        Args:
            app_id: Application ID
            from_source: Filter by feedback source ('user' or 'admin')
            rating: Filter by rating ('like' or 'dislike')
            has_comment: Only include feedback with comments
            start_date: Start date filter (YYYY-MM-DD)
            end_date: End date filter (YYYY-MM-DD)
            format_type: Export format ('csv' or 'json')
        """

        # Validate format early to avoid hitting DB when unnecessary
        fmt = (format_type or "csv").lower()
        if fmt not in {"csv", "json"}:
            raise ValueError(f"Unsupported format: {format_type}")

        # Build base query
        query = (
            db.session.query(MessageFeedback, Message, Conversation, App, Account)
            .join(Message, MessageFeedback.message_id == Message.id)
            .join(Conversation, MessageFeedback.conversation_id == Conversation.id)
            .join(App, MessageFeedback.app_id == App.id)
            .outerjoin(Account, MessageFeedback.from_account_id == Account.id)
            .where(MessageFeedback.app_id == app_id)
        )

        # Apply filters
        if from_source:
            query = query.filter(MessageFeedback.from_source == from_source)

        if rating:
            query = query.filter(MessageFeedback.rating == rating)

        if has_comment is not None:
            if has_comment:
                query = query.filter(MessageFeedback.content.isnot(None), MessageFeedback.content != "")
            else:
                query = query.filter(or_(MessageFeedback.content.is_(None), MessageFeedback.content == ""))

        if start_date:
            try:
                start_dt = datetime.strptime(start_date, "%Y-%m-%d")
                query = query.filter(MessageFeedback.created_at >= start_dt)
            except ValueError:
                raise ValueError(f"Invalid start_date format: {start_date}. Use YYYY-MM-DD")

        if end_date:
            try:
                end_dt = datetime.strptime(end_date, "%Y-%m-%d")
                query = query.filter(MessageFeedback.created_at <= end_dt)
            except ValueError:
                raise ValueError(f"Invalid end_date format: {end_date}. Use YYYY-MM-DD")

        # Order by creation date (newest first)
        query = query.order_by(MessageFeedback.created_at.desc())

        # Execute query
        results = query.all()

        # Prepare data for export
        export_data = []
        for feedback, message, conversation, app, account in results:
            # Get the user query from the message
            user_query = message.query or (message.inputs.get("query", "") if message.inputs else "")

            # Format the feedback data
            feedback_record = {
                "feedback_id": str(feedback.id),
                "app_name": app.name,
                "app_id": str(app.id),
                "conversation_id": str(conversation.id),
                "conversation_name": conversation.name or "",
                "message_id": str(message.id),
                "user_query": user_query,
                "ai_response": message.answer[:500] + "..."
                if len(message.answer) > 500
                else message.answer,  # Truncate long responses
                "feedback_rating": "👍" if feedback.rating == "like" else "👎",
                "feedback_rating_raw": feedback.rating,
                "feedback_comment": feedback.content or "",
                "feedback_source": feedback.from_source,
                "feedback_date": feedback.created_at.strftime("%Y-%m-%d %H:%M:%S"),
                "message_date": message.created_at.strftime("%Y-%m-%d %H:%M:%S"),
                "from_account_name": account.name if account else "",
                "from_end_user_id": str(feedback.from_end_user_id) if feedback.from_end_user_id else "",
                "has_comment": "Yes" if feedback.content and feedback.content.strip() else "No",
            }
            export_data.append(feedback_record)

        # Export based on format
        if fmt == "csv":
            return FeedbackService._export_csv(export_data, app_id)
        else:  # fmt == "json"
            return FeedbackService._export_json(export_data, app_id)

    @staticmethod
    def _export_csv(data, app_id):
        """Export data as CSV"""
        if not data:
            pass  # allow empty CSV with headers only

        # Create CSV in memory
        output = io.StringIO()

        # Define headers
        headers = [
            "feedback_id",
            "app_name",
            "app_id",
            "conversation_id",
            "conversation_name",
            "message_id",
            "user_query",
            "ai_response",
            "feedback_rating",
            "feedback_rating_raw",
            "feedback_comment",
            "feedback_source",
            "feedback_date",
            "message_date",
            "from_account_name",
            "from_end_user_id",
            "has_comment",
        ]

        writer = csv.DictWriter(output, fieldnames=headers)
        writer.writeheader()
        writer.writerows(data)

        # Create response without requiring app context
        response = Response(output.getvalue(), mimetype="text/csv; charset=utf-8-sig")
        response.headers["Content-Disposition"] = (
            f"attachment; filename=dify_feedback_export_{app_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        )

        return response

    @staticmethod
    def _export_json(data, app_id):
        """Export data as JSON"""
        response_data = {
            "export_info": {
                "app_id": app_id,
                "export_date": datetime.now().isoformat(),
                "total_records": len(data),
                "data_source": "dify_feedback_export",
            },
            "feedback_data": data,
        }

        # Create response without requiring app context
        response = Response(
            json.dumps(response_data, ensure_ascii=False, indent=2),
            mimetype="application/json; charset=utf-8",
        )
        response.headers["Content-Disposition"] = (
            f"attachment; filename=dify_feedback_export_{app_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        )

        return response
