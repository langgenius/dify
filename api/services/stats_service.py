from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from extensions.ext_database import db
from models import Conversation, EndUser, Message
from models.model import HealthStatus
from sqlalchemy import and_, distinct, func


class StatsService:
    @staticmethod
    def get_risk_stats(app_id: Optional[str] = None, organization_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Get statistics about high risk users

        Args:
            start_date: The start date for the statistics
            end_date: The end date for the statistics
            app_id: Optional app ID to filter users by
            organization_id: Optional organization ID to filter users by

        Returns:
            Dictionary containing high risk user count and changes
        """
        # Build query with filters
        high_risk_query = db.session.query(EndUser).filter(EndUser.health_status == HealthStatus.CRITICAL.value)
        total_query = db.session.query(EndUser)

        # Apply app_id filter if provided
        if app_id:
            high_risk_query = high_risk_query.filter(EndUser.app_id == app_id)
            total_query = total_query.filter(EndUser.app_id == app_id)

        # Apply organization_id filter if provided
        if organization_id:
            high_risk_query = high_risk_query.filter(EndUser.organization_id == organization_id)
            total_query = total_query.filter(EndUser.organization_id == organization_id)

        high_risk_count = high_risk_query.count()
        total_count = total_query.count()

        # Get yesterday's count
        yesterday = datetime.now() - timedelta(days=1)
        yesterday_query = db.session.query(EndUser).filter(
            EndUser.health_status == HealthStatus.CRITICAL.value, EndUser.updated_at <= yesterday
        )

        # Apply app_id filter if provided
        if app_id:
            yesterday_query = yesterday_query.filter(EndUser.app_id == app_id)

        # Apply organization_id filter if provided
        if organization_id:
            yesterday_query = yesterday_query.filter(EndUser.organization_id == organization_id)

        yesterday_high_risk_count = yesterday_query.count()

        # Get last week's count
        last_week = datetime.now() - timedelta(days=7)
        last_week_query = db.session.query(EndUser).filter(
            EndUser.health_status == HealthStatus.CRITICAL.value, EndUser.updated_at <= last_week
        )

        # Apply app_id filter if provided
        if app_id:
            last_week_query = last_week_query.filter(EndUser.app_id == app_id)

        # Apply organization_id filter if provided
        if organization_id:
            last_week_query = last_week_query.filter(EndUser.organization_id == organization_id)

        last_week_high_risk_count = last_week_query.count()

        # Calculate changes
        from_yesterday = high_risk_count - yesterday_high_risk_count
        from_last_week = high_risk_count - last_week_high_risk_count

        return {
            "high_risk_count": high_risk_count,
            "high_risk_percentage": round(high_risk_count / total_count, 2),
            "daily_changes": {"from_yesterday": from_yesterday, "from_last_week": from_last_week},
        }

    @staticmethod
    def get_user_stats(
        start_date: datetime, end_date: datetime, app_id: Optional[str] = None, organization_id: Optional[str] = None
    ) -> Dict[str, List[Dict[str, Any]]]:
        """
        Get user statistics for a date range

        Args:
            start_date: The start date for the statistics
            end_date: The end date for the statistics
            app_id: Optional app ID to filter users by
            organization_id: Optional organization ID to filter users by

        Returns:
            Dictionary containing daily user statistics
        """
        # Calculate date range
        date_range = []
        current_date = start_date
        while current_date <= end_date:
            date_range.append(current_date.strftime('%Y-%m-%d'))
            current_date += timedelta(days=1)

        daily_stats = []

        for date_str in date_range:
            date = datetime.strptime(date_str, '%Y-%m-%d')
            next_date = date + timedelta(days=1)

            # Count active users (users who had a conversation on this date)
            active_users_query = db.session.query(distinct(Message.from_end_user_id)).filter(
                Message.created_at >= date, Message.created_at < next_date
            )

            # Apply app_id filter if provided
            if app_id:
                active_users_query = active_users_query.filter(Message.app_id == app_id)

            # Apply organization filters for conversations
            if organization_id:
                active_users_query = active_users_query.filter(Message.organization_id == organization_id)

            active_users = active_users_query.count()

            # Count active new users (users who were created on this date AND had activity)
            # First get IDs of users created on this date
            new_user_ids_query = db.session.query(EndUser.id).filter(
                EndUser.created_at >= date, EndUser.created_at < next_date
            )

            # Apply app_id filter if provided
            if app_id:
                new_user_ids_query = new_user_ids_query.filter(EndUser.app_id == app_id)

            # Apply organization_id filter if provided
            if organization_id:
                new_user_ids_query = new_user_ids_query.filter(EndUser.organization_id == organization_id)

            # Get IDs of users who had activity on this date
            active_user_ids_query = db.session.query(distinct(Message.from_end_user_id)).filter(
                Message.created_at >= date, Message.created_at < next_date
            )

            # Apply app_id filter if provided
            if app_id:
                active_user_ids_query = active_user_ids_query.filter(Message.app_id == app_id)

            # Apply organization_id filter if provided
            if organization_id:
                active_user_ids_query = active_user_ids_query.filter(Message.organization_id == organization_id)

            # Get the intersection to find active new users
            new_user_ids = [user_id for user_id, in new_user_ids_query.all()]
            active_user_ids = [user_id for user_id, in active_user_ids_query.all()]

            # Count users who appear in both lists (created today AND active today)
            active_new_users = len(set(new_user_ids).intersection(set(active_user_ids)))

            daily_stats.append({"date": date_str, "active_users": active_users, "new_active_users": active_new_users})

        return {"daily_stats": daily_stats}

    @staticmethod
    def get_conversation_stats(
        start_date: datetime, end_date: datetime, app_id: Optional[str] = None, organization_id: Optional[str] = None
    ) -> Dict[str, List[Dict[str, Any]]]:
        """
        Get conversation statistics for a date range

        Args:
            start_date: The start date for the statistics
            end_date: The end date for the statistics
            app_id: Optional app ID to filter conversations by
            organization_id: Optional organization ID to filter conversations by

        Returns:
            Dictionary containing daily conversation statistics
        """
        # Calculate date range
        date_range = []
        current_date = start_date
        while current_date <= end_date:
            date_range.append(current_date.strftime('%Y-%m-%d'))
            current_date += timedelta(days=1)

        daily_stats = []

        for date_str in date_range:
            date = datetime.strptime(date_str, '%Y-%m-%d')
            next_date = date + timedelta(days=1)

            # Count total conversations for this date
            conv_query = db.session.query(Message).filter(Message.created_at >= date, Message.created_at < next_date)

            # Apply app_id filter if provided
            if app_id:
                conv_query = conv_query.filter(Message.app_id == app_id)

            # Apply organization_id filter if provided
            if organization_id:
                conv_query = conv_query.filter(Message.organization_id == organization_id)

            total_conversations = conv_query.count()

            # Count unique users who had conversations on this date
            unique_users_query = db.session.query(distinct(Message.from_end_user_id)).filter(
                Message.created_at >= date, Message.created_at < next_date
            )

            # Apply app_id filter if provided
            if app_id:
                unique_users_query = unique_users_query.filter(Message.app_id == app_id)

            # Apply organization_id filter if provided
            if organization_id:
                unique_users_query = unique_users_query.filter(Message.organization_id == organization_id)

            unique_users = unique_users_query.count()

            # Calculate average conversations per user
            avg_conversations_per_user = 0
            if unique_users > 0:
                avg_conversations_per_user = round(total_conversations / unique_users, 2)

            daily_stats.append(
                {
                    "date": date_str,
                    "total_conversations": total_conversations,
                    "avg_conversations_per_user": avg_conversations_per_user,
                }
            )

        return {"daily_stats": daily_stats}
