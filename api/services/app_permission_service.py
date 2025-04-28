from sqlalchemy.orm import Session

from extensions.ext_database import db
from models.model import AppPermission


class AppPermissionService:
    @classmethod
    def get_app_permissions_by_app_id(cls, app_id: str):
        """
        Get a list of account IDs that have permission for an app.
        
        Args:
            app_id (str): The ID of the app.
            
        Returns:
            list: A list of account IDs with permissions for the app.
        """
        with Session(db.engine) as session:
            permissions = session.query(AppPermission).filter(
                AppPermission.app_id == app_id,
                AppPermission.has_permission == True
            ).all()
            
            return [permission.account_id for permission in permissions]
    
    @classmethod
    def get_app_permissions_by_account_id(cls, account_id: str):
        """
        Get a list of app IDs that an account has permission for.
        
        Args:
            account_id (str): The ID of the account.
            
        Returns:
            list: A list of app IDs the account has permission for.
        """
        with Session(db.engine) as session:
            permissions = session.query(AppPermission).filter(
                AppPermission.account_id == account_id,
                AppPermission.has_permission == True
            ).all()
            
            return [permission.app_id for permission in permissions]
    
    @classmethod
    def update_app_permissions(cls, tenant_id: str, app_id: str, account_ids: list):
        """
        Update the permissions for an app by replacing all existing permissions.
        
        Args:
            tenant_id (str): The ID of the tenant.
            app_id (str): The ID of the app.
            account_ids (list): A list of account IDs to grant permission to.
            
        Returns:
            bool: True if the operation succeeds.
        """
        try:
            with Session(db.engine) as session:
                # Delete existing permissions for the app
                session.query(AppPermission).filter(
                    AppPermission.app_id == app_id
                ).delete()
                
                # Create new permissions
                permissions = []
                for account_id in account_ids:
                    permission = AppPermission(
                        tenant_id=tenant_id,
                        app_id=app_id,
                        account_id=account_id,
                        has_permission=True
                    )
                    permissions.append(permission)
                
                session.add_all(permissions)
                session.commit()
                
            return True
        except Exception as e:
            db.session.rollback()
            raise e
    
    @classmethod
    def add_app_permission(cls, tenant_id: str, app_id: str, account_id: str):
        """
        Add permission for an account to access an app.
        
        Args:
            tenant_id (str): The ID of the tenant.
            app_id (str): The ID of the app.
            account_id (str): The ID of the account to grant permission to.
            
        Returns:
            AppPermission: The created permission object.
        """
        with Session(db.engine) as session:
            # Check if permission already exists
            existing_permission = session.query(AppPermission).filter(
                AppPermission.app_id == app_id,
                AppPermission.account_id == account_id
            ).first()
            
            if existing_permission:
                existing_permission.has_permission = True
                session.commit()
                return existing_permission
            
            # Create new permission
            permission = AppPermission(
                tenant_id=tenant_id,
                app_id=app_id,
                account_id=account_id,
                has_permission=True
            )
            
            session.add(permission)
            session.commit()
            
            return permission
    
    @classmethod
    def remove_app_permission(cls, app_id: str, account_id: str):
        """
        Remove permission for an account to access an app.
        
        Args:
            app_id (str): The ID of the app.
            account_id (str): The ID of the account to remove permission from.
            
        Returns:
            bool: True if the permission was removed.
        """
        with Session(db.engine) as session:
            permission = session.query(AppPermission).filter(
                AppPermission.app_id == app_id,
                AppPermission.account_id == account_id
            ).first()
            
            if permission:
                session.delete(permission)
                session.commit()
                return True
            
            return False
    
    @classmethod
    def check_app_permission(cls, app_id: str, account_id: str):
        """
        Check if an account has permission to access an app.
        
        Args:
            app_id (str): The ID of the app.
            account_id (str): The ID of the account.
            
        Returns:
            bool: True if the account has permission.
        """
        with Session(db.engine) as session:
            permission = session.query(AppPermission).filter(
                AppPermission.app_id == app_id,
                AppPermission.account_id == account_id,
                AppPermission.has_permission == True
            ).first()
            
            return permission is not None
            
    @classmethod
    def clear_app_permissions(cls, app_id: str):
        """
        Clear all permissions for an app.
        
        Args:
            app_id (str): The ID of the app.
            
        Returns:
            bool: True if the operation succeeds.
        """
        try:
            with Session(db.engine) as session:
                session.query(AppPermission).filter(
                    AppPermission.app_id == app_id
                ).delete()
                
                session.commit()
                
            return True
        except Exception as e:
            db.session.rollback()
            raise e 