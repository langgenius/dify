from typing import Any, Dict, Optional, Tuple

from extensions.ext_database import db
from models.account import Account
from models.model import EndUser
from services.account_service import AccountService


class EndUserService:
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

        # Get major from extra_profile if it exists
        major = None
        if end_user.extra_profile and 'major' in end_user.extra_profile:
            major = end_user.extra_profile.get('major')

        # Get email from Account table
        account = db.session.query(Account).filter(Account.id == end_user_id).first()
        email = account.email if account else None

        return {
            "username": end_user.name,
            "gender": gender_map.get(end_user.gender, "unknown"),
            "major": major,
            "email": email,
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

                # Initialize extra_profile if it doesn't exist
                if not end_user.extra_profile:
                    end_user.extra_profile = {}

                # Update major in extra_profile
                end_user.extra_profile['major'] = major

            # Save changes to database
            db.session.commit()
            return True, None

        except Exception as e:
            db.session.rollback()
            return False, str(e)
