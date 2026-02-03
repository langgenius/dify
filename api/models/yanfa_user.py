"""
Yanfa User Model
映射Yanfa系统的user表，实现共用账号体系
"""
from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Column, DateTime, Integer, Numeric, SmallInteger, String, text
from sqlalchemy.ext.declarative import declarative_base

# Yanfa数据库的Base
YanfaBase = declarative_base()


class YanfaUser(YanfaBase):
    """
    Yanfa用户模型 - 映射到Yanfa数据库的user表

    CREATE TABLE `user` (
      `id` bigint unsigned NOT NULL AUTO_INCREMENT,
      `name` varchar(64) - 用户名称
      `email` varchar(64) - 用户email
      `password` varchar(32) - 用户密码
      `balance` decimal(12,6) - 充值余额
      `source` varchar(16) - 用户来源
      `status` int - 1 启用 0 禁用
      `created_at` timestamp - 创建时间
      `updated_at` timestamp - 更新时间
      ...
    )
    """
    __tablename__ = 'user'

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(64), nullable=True, comment='用户名称')
    email = Column(String(64), nullable=True, comment='用户email')
    password = Column(String(32), nullable=True, comment='用户密码')
    balance = Column(Numeric(12, 6), nullable=False, default=Decimal('0.000000'), comment='充值余额')
    block_amount = Column(Numeric(12, 6), nullable=False, default=Decimal('0.000000'), comment='冻结金额')
    chain_account = Column(String(64), nullable=True, comment='用户链上地址')
    source = Column(String(16), nullable=False, comment='用户来源')
    assign_chain_account = Column(String(64), nullable=False, comment='分配给用户的地址')
    private_key = Column(String(5120), nullable=False, comment='用户链上地址私钥')
    inviter_account = Column(String(255), nullable=True, comment='邀请人的平台的地址')
    created_at = Column(DateTime, nullable=False, server_default=text('CURRENT_TIMESTAMP'), comment='创建时间')
    updated_at = Column(DateTime, nullable=False, server_default=text('CURRENT_TIMESTAMP'), comment='更新时间')
    telegram_id = Column(String(128), nullable=True, comment='telegram user id')
    nal_protocol_wallet_address = Column(String(128), nullable=True)
    channel = Column(String(20), nullable=True, default='direct', comment='用户推广渠道')
    top_up_tag = Column(SmallInteger, nullable=True, default=0, comment='用户充值标签')
    subscription_tag = Column(SmallInteger, nullable=True, default=0, comment='用户订阅标签')
    device_type = Column(String(10), nullable=True, comment='设备类型：pc|mobile')
    status = Column(Integer, nullable=True, comment='1 启用 0 禁用')
    hubtopath = Column(String(1024), nullable=True)
    loginpath = Column(String(1024), nullable=True)
    paddle_customer_id = Column(String(32), nullable=True)
    airwallex_customer_id = Column(String(32), nullable=True)
    jumppath = Column(String(1000), nullable=True, comment='seo跳转路由')
    sourceid = Column(String(255), nullable=True, comment='wordpress id')
    stripe_customer_id = Column(String(100), nullable=True, comment='客户ID')

    def __repr__(self):
        return f'<YanfaUser {self.id}: {self.name or self.email}>'

    @property
    def display_name(self) -> str:
        """获取显示名称"""
        return self.name or self.email or f'User_{self.id}'

    @property
    def is_active(self) -> bool:
        """用户是否启用"""
        return self.status == 1 or self.status is None

    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            'id': self.id,
            'name': self.name,
            'email': self.email,
            'source': self.source,
            'channel': self.channel,
            'status': self.status,
            'balance': float(self.balance) if self.balance else 0,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class YanfaUserService:
    """Yanfa用户服务 - 提供用户查询功能"""

    @staticmethod
    def get_by_id(user_id: int) -> YanfaUser | None:
        """根据ID获取用户"""
        from extensions.ext_yanfa_database import yanfa_db

        if not yanfa_db.is_enabled():
            return None

        session = yanfa_db.get_session()
        try:
            return session.query(YanfaUser).filter(YanfaUser.id == user_id).first()
        except Exception as e:
            print(f"Error fetching Yanfa user by id {user_id}: {e}")
            return None

    @staticmethod
    def get_by_email(email: str) -> YanfaUser | None:
        """根据邮箱获取用户"""
        from extensions.ext_yanfa_database import yanfa_db

        if not yanfa_db.is_enabled():
            return None

        session = yanfa_db.get_session()
        try:
            return session.query(YanfaUser).filter(YanfaUser.email == email).first()
        except Exception as e:
            print(f"Error fetching Yanfa user by email {email}: {e}")
            return None

    @staticmethod
    def verify_password(user: YanfaUser, password: str) -> bool:
        """验证用户密码"""
        if not user or not user.password:
            return False
        # 注意：这里假设密码是MD5或其他哈希，需要根据实际情况调整
        import hashlib
        hashed = hashlib.md5(password.encode()).hexdigest()
        return user.password == hashed
