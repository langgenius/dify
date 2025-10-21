from collections.abc import Callable, Iterable
from enum import StrEnum
from typing import Any, NamedTuple, TypeVar

import pytest
import sqlalchemy as sa
from sqlalchemy import exc as sa_exc
from sqlalchemy import insert
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from sqlalchemy.sql.sqltypes import VARCHAR

from models.types import EnumText

_user_type_admin = "admin"
_user_type_normal = "normal"


class _Base(DeclarativeBase):
    pass


class _UserType(StrEnum):
    admin = _user_type_admin
    normal = _user_type_normal


class _EnumWithLongValue(StrEnum):
    unknown = "unknown"
    a_really_long_enum_values = "a_really_long_enum_values"


class _User(_Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    name: Mapped[str] = mapped_column(sa.String(length=255), nullable=False)
    user_type: Mapped[_UserType] = mapped_column(
        EnumText(enum_class=_UserType), nullable=False, default=_UserType.normal
    )
    user_type_nullable: Mapped[_UserType | None] = mapped_column(EnumText(enum_class=_UserType), nullable=True)


class _ColumnTest(_Base):
    __tablename__ = "column_test"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)

    user_type: Mapped[_UserType] = mapped_column(
        EnumText(enum_class=_UserType), nullable=False, default=_UserType.normal
    )
    explicit_length: Mapped[_UserType | None] = mapped_column(
        EnumText(_UserType, length=50), nullable=True, default=_UserType.normal
    )
    long_value: Mapped[_EnumWithLongValue] = mapped_column(EnumText(enum_class=_EnumWithLongValue), nullable=False)


_T = TypeVar("_T")


def _first(it: Iterable[_T]) -> _T:
    ls = list(it)
    if not ls:
        raise ValueError("List is empty")
    return ls[0]


class TestEnumText:
    def test_column_impl(self):
        engine = sa.create_engine("sqlite://", echo=False)
        _Base.metadata.create_all(engine)

        inspector = sa.inspect(engine)
        columns = inspector.get_columns(_ColumnTest.__tablename__)

        user_type_column = _first(c for c in columns if c["name"] == "user_type")
        sql_type = user_type_column["type"]
        assert isinstance(user_type_column["type"], VARCHAR)
        assert sql_type.length == 20
        assert user_type_column["nullable"] is False

        explicit_length_column = _first(c for c in columns if c["name"] == "explicit_length")
        sql_type = explicit_length_column["type"]
        assert isinstance(sql_type, VARCHAR)
        assert sql_type.length == 50
        assert explicit_length_column["nullable"] is True

        long_value_column = _first(c for c in columns if c["name"] == "long_value")
        sql_type = long_value_column["type"]
        assert isinstance(sql_type, VARCHAR)
        assert sql_type.length == len(_EnumWithLongValue.a_really_long_enum_values)

    def test_insert_and_select(self):
        engine = sa.create_engine("sqlite://", echo=False)
        _Base.metadata.create_all(engine)

        with Session(engine) as session:
            admin_user = _User(
                name="admin",
                user_type=_UserType.admin,
                user_type_nullable=None,
            )
            session.add(admin_user)
            session.flush()
            admin_user_id = admin_user.id

            normal_user = _User(
                name="normal",
                user_type=_UserType.normal.value,
                user_type_nullable=_UserType.normal.value,
            )
            session.add(normal_user)
            session.flush()
            normal_user_id = normal_user.id
            session.commit()

        with Session(engine) as session:
            user = session.query(_User).where(_User.id == admin_user_id).first()
            assert user.user_type == _UserType.admin
            assert user.user_type_nullable is None

        with Session(engine) as session:
            user = session.query(_User).where(_User.id == normal_user_id).first()
            assert user.user_type == _UserType.normal
            assert user.user_type_nullable == _UserType.normal

    def test_insert_invalid_values(self):
        def _session_insert_with_value(sess: Session, user_type: Any):
            user = _User(name="test_user", user_type=user_type)
            sess.add(user)
            sess.flush()

        def _insert_with_user(sess: Session, user_type: Any):
            stmt = insert(_User).values(
                {
                    "name": "test_user",
                    "user_type": user_type,
                }
            )
            sess.execute(stmt)

        class TestCase(NamedTuple):
            name: str
            action: Callable[[Session], None]
            exc_type: type[Exception]

        engine = sa.create_engine("sqlite://", echo=False)
        _Base.metadata.create_all(engine)
        cases = [
            TestCase(
                name="session insert with invalid value",
                action=lambda s: _session_insert_with_value(s, "invalid"),
                exc_type=ValueError,
            ),
            TestCase(
                name="session insert with invalid type",
                action=lambda s: _session_insert_with_value(s, 1),
                exc_type=ValueError,
            ),
            TestCase(
                name="insert with invalid value",
                action=lambda s: _insert_with_user(s, "invalid"),
                exc_type=ValueError,
            ),
            TestCase(
                name="insert with invalid type",
                action=lambda s: _insert_with_user(s, 1),
                exc_type=ValueError,
            ),
        ]
        for idx, c in enumerate(cases, 1):
            with pytest.raises(sa_exc.StatementError) as exc:
                with Session(engine) as session:
                    c.action(session)

            assert isinstance(exc.value.orig, c.exc_type), f"test case {idx} failed, name={c.name}"

    def test_select_invalid_values(self):
        engine = sa.create_engine("sqlite://", echo=False)
        _Base.metadata.create_all(engine)

        insertion_sql = """
                        INSERT INTO users (id, name, user_type) VALUES
                            (1, 'invalid_value', 'invalid');
                        """
        with Session(engine) as session:
            session.execute(sa.text(insertion_sql))
            session.commit()

        with pytest.raises(ValueError) as exc:
            with Session(engine) as session:
                _user = session.query(_User).where(_User.id == 1).first()
