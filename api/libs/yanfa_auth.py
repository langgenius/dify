"""
Yanfa External Authentication Module
用于验证来自Java后端的JWT token，实现直接访问Dify
从Yanfa数据库读取用户信息，实现共用账号体系
"""
import jwt
from werkzeug.exceptions import Unauthorized

from configs import dify_config
from extensions.ext_database import db
from models import Account, EndUser
from models.account import TenantAccountRole
from services.account_service import AccountService


class YanfaAuthConfig:
    """Yanfa认证配置 - 从dify_config读取配置"""

    @staticmethod
    def get_jwt_secret() -> str:
        """获取JWT密钥"""
        return dify_config.YANFA_JWT_SECRET

    @staticmethod
    def is_enabled() -> bool:
        """是否启用Yanfa认证"""
        return dify_config.YANFA_AUTH_ENABLED

    @staticmethod
    def get_default_tenant_id() -> str | None:
        """获取默认租户ID"""
        return dify_config.YANFA_DEFAULT_TENANT_ID


class YanfaPassportService:
    """Yanfa JWT Token验证服务"""

    def __init__(self):
        self.secret_key = YanfaAuthConfig.get_jwt_secret()

    def verify(self, token: str) -> dict:
        """
        验证Yanfa JWT token

        Args:
            token: JWT token字符串

        Returns:
            解码后的payload，包含:
            - userId: 用户ID
            - accountId: 账户ID
            - channel: 渠道信息
            - t: 时间戳

        Raises:
            Unauthorized: token无效时抛出
        """
        try:
            payload = jwt.decode(
                token,
                self.secret_key,
                algorithms=["HS256"],
                options={"verify_exp": False}
            )
            return payload
        except jwt.InvalidSignatureError:
            raise Unauthorized("Invalid Yanfa token signature.")
        except jwt.DecodeError:
            raise Unauthorized("Invalid Yanfa token format.")
        except jwt.PyJWTError as e:
            raise Unauthorized(f"Invalid Yanfa token: {str(e)}")

    def is_yanfa_token(self, token: str) -> bool:
        """检查是否为Yanfa格式的token"""
        try:
            payload = jwt.decode(
                token,
                self.secret_key,
                algorithms=["HS256"],
                options={"verify_exp": False, "verify_signature": True}
            )
            return 'userId' in payload
        except:
            return False


class YanfaUserService:
    """Yanfa用户映射服务 - 从Yanfa数据库读取用户，映射到Dify用户"""

    @staticmethod
    def get_yanfa_user(yanfa_user_id: str):
        """
        从Yanfa数据库获取用户

        Args:
            yanfa_user_id: Yanfa系统的用户ID

        Returns:
            YanfaUser对象或None
        """
        try:
            from models.yanfa_user import YanfaUserService as YanfaDBService
            return YanfaDBService.get_by_id(int(yanfa_user_id))
        except Exception as e:
            print(f"Error fetching Yanfa user: {e}")
            return None

    @staticmethod
    def get_or_create_end_user(
        yanfa_user_id: str,
        channel: str,
        app_id: str = None
    ) -> EndUser:
        """
        获取或创建EndUser（用于Service API访问）
        """
        # 从Yanfa数据库获取用户
        yanfa_user = YanfaUserService.get_yanfa_user(yanfa_user_id)
        if not yanfa_user:
            raise Unauthorized(f"Yanfa user not found: {yanfa_user_id}")

        if not yanfa_user.is_active:
            raise Unauthorized("Yanfa user is disabled.")

        external_user_id = f"yanfa_{yanfa_user_id}"

        # 查找现有用户
        end_user = db.session.query(EndUser).filter(
            EndUser.external_user_id == external_user_id,
            EndUser.type == "service_api"
        ).first()

        if end_user:
            # 同步用户名称
            if yanfa_user.name and end_user.name != yanfa_user.name:
                end_user.name = yanfa_user.name
                db.session.commit()
            return end_user

        # 创建新用户
        end_user = EndUser(
            external_user_id=external_user_id,
            name=yanfa_user.display_name,
            type="service_api",
            is_anonymous=False,
            session_id=f"yanfa_session_{yanfa_user_id}"
        )

        if app_id:
            end_user.app_id = app_id

        db.session.add(end_user)
        db.session.commit()

        return end_user

    @staticmethod
    def get_or_create_account(
        yanfa_user_id: str,
        channel: str = None
    ) -> Account:
        """
        获取或创建Account（用于Console API访问）
        使用Yanfa数据库中的邮箱作为唯一标识
        """
        # 从Yanfa数据库获取用户
        yanfa_user = YanfaUserService.get_yanfa_user(yanfa_user_id)
        if not yanfa_user:
            raise Unauthorized(f"Yanfa user not found: {yanfa_user_id}")

        if not yanfa_user.is_active:
            raise Unauthorized("Yanfa user is disabled.")

        if not yanfa_user.email:
            raise Unauthorized("Yanfa user has no email.")

        # 通过邮箱查找Dify账户
        account = db.session.query(Account).filter(
            Account.email == yanfa_user.email
        ).first()

        if account:
            # 同步用户名称
            if yanfa_user.name and account.name != yanfa_user.name:
                account.name = yanfa_user.name
                db.session.commit()
            return AccountService.load_logged_in_account(account_id=account.id)

        # 创建新账户
        from services.account_service import RegisterService

        account = RegisterService.create_account(
            email=yanfa_user.email,
            name=yanfa_user.display_name,
            password=None,
            language="zh-Hans",
            timezone="Asia/Shanghai",
            interface_language="zh-Hans",
            status="active"
        )

        # 加入默认租户
        default_tenant_id = YanfaAuthConfig.get_default_tenant_id()
        if default_tenant_id:
            from models import TenantAccountJoin

            existing_join = db.session.query(TenantAccountJoin).filter(
                TenantAccountJoin.account_id == account.id,
                TenantAccountJoin.tenant_id == default_tenant_id
            ).first()

            if not existing_join:
                join = TenantAccountJoin(
                    account_id=account.id,
                    tenant_id=default_tenant_id,
                    role=TenantAccountRole.NORMAL
                )
                db.session.add(join)
                db.session.commit()

        return AccountService.load_logged_in_account(account_id=account.id)


def authenticate_yanfa_token(token: str, blueprint: str = None, app_id: str = None):
    """
    认证Yanfa token并返回对应的用户

    Args:
        token: JWT token
        blueprint: Flask blueprint名称
        app_id: Dify应用ID

    Returns:
        Account或EndUser对象

    Raises:
        Unauthorized: 认证失败
    """
    if not YanfaAuthConfig.is_enabled():
        raise Unauthorized("Yanfa authentication is disabled.")

    # 验证token
    passport = YanfaPassportService()
    payload = passport.verify(token)

    yanfa_user_id = payload.get('userId')
    channel = payload.get('channel', 'default')

    if not yanfa_user_id:
        raise Unauthorized("Invalid Yanfa token: missing userId.")

    # 根据blueprint返回不同类型的用户
    if blueprint in {'console', 'inner_api'}:
        return YanfaUserService.get_or_create_account(
            yanfa_user_id=yanfa_user_id,
            channel=channel
        )
    else:
        return YanfaUserService.get_or_create_end_user(
            yanfa_user_id=yanfa_user_id,
            channel=channel,
            app_id=app_id
        )
