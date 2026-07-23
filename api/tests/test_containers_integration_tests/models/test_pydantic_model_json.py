from collections.abc import Iterator
from typing import Annotated, Literal

import pytest
import sqlalchemy as sa
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter
from sqlalchemy import Engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from models.types import PydanticModelJSON


class _ConcretePayload(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, validate_default=True)

    name: str
    count: int


class _EmailDestination(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, validate_default=True)

    channel: Literal["email"] = "email"
    address: str


class _SlackDestination(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, validate_default=True)

    channel: Literal["slack"] = "slack"
    channel_id: str


type _Destination = Annotated[_EmailDestination | _SlackDestination, Field(discriminator="channel")]


class _Base(DeclarativeBase):
    pass


class _PydanticJSONRecord(_Base):
    __tablename__ = "integration_pydantic_json_records"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True, autoincrement=True)
    concrete: Mapped[_ConcretePayload] = mapped_column(
        PydanticModelJSON(
            _ConcretePayload,
            model_types=_ConcretePayload,
            field_name="concrete",
        ),
        nullable=False,
    )
    destination: Mapped[_Destination] = mapped_column(
        PydanticModelJSON(
            TypeAdapter(_Destination),
            model_types=(_EmailDestination, _SlackDestination),
            field_name="destination",
        ),
        nullable=False,
    )


@pytest.fixture
def pydantic_json_engine(db_session_with_containers: Session) -> Engine:
    bind = db_session_with_containers.get_bind()
    assert isinstance(bind, Engine)
    return bind


@pytest.fixture(autouse=True)
def _pydantic_json_schema(pydantic_json_engine: Engine) -> Iterator[None]:
    _Base.metadata.create_all(pydantic_json_engine)
    try:
        yield
    finally:
        _Base.metadata.drop_all(pydantic_json_engine)


def test_real_json_column_round_trips_a_concrete_model(pydantic_json_engine: Engine) -> None:
    with Session(pydantic_json_engine) as session:
        record = _PydanticJSONRecord(
            concrete=_ConcretePayload(name="container", count=3),
            destination=_EmailDestination(address="reviewer@example.com"),
        )
        session.add(record)
        session.commit()
        record_id = record.id

    with Session(pydantic_json_engine) as session:
        restored = session.scalar(select(_PydanticJSONRecord).where(_PydanticJSONRecord.id == record_id))

        assert restored is not None
        assert restored.concrete == _ConcretePayload(name="container", count=3)
        assert isinstance(restored.concrete, _ConcretePayload)


def test_real_json_column_restores_the_discriminated_union_subtype(pydantic_json_engine: Engine) -> None:
    with Session(pydantic_json_engine) as session:
        record = _PydanticJSONRecord(
            concrete=_ConcretePayload(name="container", count=4),
            destination=_SlackDestination(channel_id="C123"),
        )
        session.add(record)
        session.commit()
        record_id = record.id

    with Session(pydantic_json_engine) as session:
        restored = session.scalar(select(_PydanticJSONRecord).where(_PydanticJSONRecord.id == record_id))

        assert restored is not None
        assert restored.destination == _SlackDestination(channel_id="C123")
        assert isinstance(restored.destination, _SlackDestination)
