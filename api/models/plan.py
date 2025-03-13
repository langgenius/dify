from sqlalchemy.orm import Mapped, mapped_column
from .engine import db
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from enum import Enum

# 定义枚举类型
class PlanType(Enum):
    SANDBOX = "sandbox"
    BASIC = "basic"
    PRO = "pro"

    @staticmethod
    def value_of(value):
        for member in PlanType:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")


class QuotaType(Enum):
    FREE = "free"
    PAID = "paid"
    TRIAL = "trial"

    @staticmethod
    def value_of(value):
        for member in QuotaType:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")


# 创建基础类，用于定义映射类
class Plan(db.Model):
    __tablename__ = 'plans'  # 表名 'plans'
    __table_args__ = (db.PrimaryKeyConstraint("id", name="plan_key"),)

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(db.String(50), nullable=False, default=PlanType.SANDBOX.value)  # 当前套餐，默认值为"Sandbox"
    team_members: Mapped[int] = mapped_column(db.Integer, nullable=False, default=0)  # 团队成员数量，默认值为0
    app_count: Mapped[int] = mapped_column(db.Integer, nullable=False, default=0)  # 应用程序数量，默认值为0
    vector_space: Mapped[int] = mapped_column(db.Integer, nullable=False, default=0)  # 向量空间大小，默认值为0
    annotation_count: Mapped[int] = mapped_column(db.Integer, nullable=False, default=0)  # 标注数量，默认值为0
    document_upload_quota: Mapped[int] = mapped_column(db.Integer, nullable=False, default=0)  # 文档上传配额，默认值为0
    unit_price: Mapped[float] = mapped_column(db.Numeric(precision=10, scale=2), nullable=False, default=0.00)  # 单价字段




