from typing import Any, Dict, Optional, Tuple

from extensions.ext_database import db
from libs.infinite_scroll_pagination import MultiPagePagination
from models.account import Account
from models.model import App, Conversation, EndUser, Message
from services.organization_service import OrganizationService
from sqlalchemy import and_, desc, func


class EndUserService:
    @staticmethod
    def pagination_by_filters(
        app_model: App, filters: Dict[str, Any], offset: int, limit: int, organization_id: Optional[str] = None
    ) -> MultiPagePagination:
        """
        Get a list of end users with filtering and pagination

        Args:
            app_model: The app model
            filters: Dictionary containing filter criteria
            offset: Number of records to skip
            limit: Maximum number of records to return
            organization_id: Optional organization ID to filter users by

        Returns:
            Dictionary containing total count and list of end users
        """
        # Get message data to calculate active days
        message_days_subq = (
            db.session.query(
                Message.from_end_user_id,
                func.count(
                    func.distinct(func.date(func.timezone('UTC+8', func.timezone('UTC', Message.created_at))))
                ).label('active_days'),
            )
            .filter(Message.app_id == app_model.id)
            .group_by(Message.from_end_user_id)
            .subquery()
        )

        # Start with base query - using join and subqueries for the chat timing data
        subq = (
            db.session.query(
                Conversation.from_end_user_id,
                func.max(Conversation.created_at).label('last_chat_at'),
                func.min(Conversation.created_at).label('first_chat_at'),
                func.count(Message.id).label('total_messages'),
            )
            .filter(Conversation.app_id == app_model.id)
            .join(Message, Message.conversation_id == Conversation.id)
            .group_by(Conversation.from_end_user_id)
            .subquery()
        )

        query = (
            db.session.query(
                EndUser,
                subq.c.last_chat_at,
                subq.c.first_chat_at,
                subq.c.total_messages,
                message_days_subq.c.active_days,
            )
            .outerjoin(subq, EndUser.id == subq.c.from_end_user_id)
            .outerjoin(message_days_subq, EndUser.id == message_days_subq.c.from_end_user_id)
            .filter(EndUser.app_id == app_model.id)
            .filter(EndUser.external_user_id != None)
        )

        # Filter by organization if specified
        if organization_id:
            query = query.filter(EndUser.organization_id == organization_id)

        # Apply filters
        filter_conditions = []

        if 'health_status' in filters:
            filter_conditions.append(EndUser.health_status == filters['health_status'])

        if 'last_chat_at__gte' in filters:
            filter_conditions.append(subq.c.last_chat_at >= filters['last_chat_at__gte'])

        if 'last_chat_at__lte' in filters:
            filter_conditions.append(subq.c.last_chat_at <= filters['last_chat_at__lte'])

        # Apply all filter conditions
        if filter_conditions:
            query = query.filter(and_(*filter_conditions))

        # Get total count before applying pagination
        total_count = query.count()

        # Apply pagination - now ordering by the joined column
        query = query.order_by(desc(subq.c.last_chat_at))
        query = query.offset(offset).limit(limit)

        # Execute query
        results = query.all()

        # Process results to include the chat timing data
        users = []
        for result in results:
            end_user = result[0]
            end_user.last_chat_at = result[1]
            end_user.first_chat_at = result[2]
            end_user.total_messages = result[3] if result[3] is not None else 0
            end_user.active_days = result[4] if result[4] is not None else 0

            # Convert to dictionary for JSON serialization
            end_user_dict = {
                'id': end_user.external_user_id,
                'email': end_user.email,
                'first_chat_at': end_user.first_chat_at,
                'last_chat_at': end_user.last_chat_at,
                'total_messages': end_user.total_messages,
                'active_days': end_user.active_days,
                'health_status': end_user.health_status,
                'topics': end_user.topics,
                'summary': end_user.summary,
                'major': end_user.major,
                'organization_id': end_user.organization_id,
            }

            users.append(end_user_dict)

        # Format and return results
        return MultiPagePagination(data=users, total=total_count)

    @staticmethod
    def load_end_user_by_id(end_user_id: str) -> EndUser:
        return db.session.query(EndUser).filter(EndUser.external_user_id == end_user_id).first()

    @staticmethod
    def get_user_profile(end_user_id: str) -> Dict[str, Any]:
        """
        Get user profile information

        Args:
            end_user_id: The ID of the end user

        Returns:
            Dict containing user profile information
        """
        # Get EndUser information
        end_user = db.session.query(EndUser).filter(EndUser.external_user_id == end_user_id).first()

        if not end_user:
            return {"username": None, "gender": "unknown", "major": None, "email": None}

        # Map numeric gender to string representation
        gender_map = {0: "unknown", 1: "male", 2: "female"}

        return {
            "username": end_user.name,
            "gender": gender_map.get(end_user.gender, "unknown"),
            "major": end_user.major,
            "email": end_user.email,
        }

    @staticmethod
    def update_user_profile(end_user: EndUser, profile_data: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
        """
        Update user profile information

        Args:
            end_user: The EndUser object to update
            profile_data: Dictionary containing profile data to update

        Returns:
            Tuple of (success, error_message)
        """
        try:
            # Update username if provided
            if 'username' in profile_data:
                end_user.name = profile_data['username']

            # Update gender if provided
            if 'gender' in profile_data:
                gender_str = profile_data['gender']
                gender_map = {"unknown": 0, "male": 1, "female": 2}
                end_user.gender = gender_map[gender_str]

            # Update major if provided
            if 'major' in profile_data:
                major = profile_data['major']

                # Create a new dictionary if extra_profile is None
                if end_user.extra_profile is None:
                    end_user.extra_profile = {}

                # Make a copy of the existing dictionary to ensure changes are detected
                extra_profile = dict(end_user.extra_profile)
                extra_profile['major'] = major
                end_user.extra_profile = extra_profile

                # Force the change to be detected
                db.session.add(end_user)

            # Save changes to database
            db.session.commit()
            return True, None

        except Exception as e:
            db.session.rollback()
            return False, str(e)

    @classmethod
    def get_or_create_end_user(cls, app_model: App, user_id: str, user_type: str = "service_api_with_auth") -> EndUser:
        """
        Get or create an end user with organization awareness

        Args:
            app_model: The app model
            user_id: The external user ID (often an account ID)
            user_type: The type of end user (default: service_api_with_auth)

        Returns:
            The end user
        """
        if not user_id:
            user_id = "DEFAULT-USER"

        # Find existing end user
        end_user = (
            db.session.query(EndUser)
            .filter(
                EndUser.tenant_id == app_model.tenant_id,
                EndUser.app_id == app_model.id,
                EndUser.external_user_id == user_id,
                EndUser.type == user_type,
            )
            .first()
        )

        # Get organization if the user has an account
        organization_id = None
        if user_id != "DEFAULT-USER":
            account = db.session.query(Account).filter(Account.id == user_id).first()
            if account:
                organization = OrganizationService.get_organization_for_account_or_assign(account, app_model.tenant_id)
                if organization:
                    organization_id = organization.id

        if not end_user:
            # Create new end user
            end_user = EndUser(
                tenant_id=app_model.tenant_id,
                app_id=app_model.id,
                type=user_type,
                external_user_id=user_id,
                session_id=user_id,
                organization_id=organization_id,
            )
            db.session.add(end_user)
            db.session.commit()
        elif organization_id and end_user.organization_id != organization_id:
            # Update organization if needed
            OrganizationService.assign_end_user_to_organization(end_user, organization_id)

        return end_user

    @classmethod
    def get_organization_for_end_user(cls, end_user: EndUser) -> Optional[dict]:
        """
        Get organization info for an end user

        Args:
            end_user: The end user

        Returns:
            Organization info as dict or None
        """
        if not end_user or not end_user.organization_id:
            return None

        organization = OrganizationService.get_organization_by_id(end_user.organization_id)
        if organization:
            return {
                "id": organization.id,
                "name": organization.name,
                "code": organization.code,
                "type": organization.type,
            }

        return None

    @classmethod
    def update_end_user(
        cls, end_user: EndUser, name: Optional[str] = None, organization_id: Optional[str] = None
    ) -> EndUser:
        """
        Update an end user's properties

        Args:
            end_user: The end user to update
            name: New name (optional)
            organization_id: New organization ID (optional)

        Returns:
            The updated end user
        """
        if not end_user:
            raise ValueError("End user cannot be None")

        if name:
            end_user.name = name

        if organization_id and end_user.organization_id != organization_id:
            OrganizationService.assign_end_user_to_organization(end_user, organization_id)

        db.session.commit()
        return end_user
