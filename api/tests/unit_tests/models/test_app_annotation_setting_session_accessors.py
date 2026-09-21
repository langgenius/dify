"""Regression coverage for the ``@property``→session-parameter refactor on
``AppAnnotationSetting.collection_binding_detail``.

The legacy ``@property`` reached for the global ``db.session`` internally and has been converted
to a plain method taking an explicit ``session: Session`` (per the pattern established in
#40370/#40797/#41394/#41830, tracked in #40372).

The accessor is exercised against the real ``sqlite_session`` fixture (a genuine SQLAlchemy
``Session`` bound to a pristine full-schema SQLite database) so the assertions cover actual query
behaviour rather than a mock's recorded call.
"""

from uuid import uuid4

from sqlalchemy.orm import Session

from models.dataset import DatasetCollectionBinding
from models.enums import CollectionBindingType
from models.model import AppAnnotationSetting


def _persist_collection_binding(session: Session) -> DatasetCollectionBinding:
    binding = DatasetCollectionBinding(
        collection_name="test_collection",
        provider_name="test_provider",
        model_name="test_model",
        type=CollectionBindingType.DATASET,
    )
    session.add(binding)
    session.flush()
    return binding


def _persist_setting(session: Session, *, collection_binding_id: str) -> AppAnnotationSetting:
    setting = AppAnnotationSetting(
        app_id=str(uuid4()),
        score_threshold=0.8,
        collection_binding_id=collection_binding_id,
        created_user_id=str(uuid4()),
        updated_user_id=str(uuid4()),
    )
    session.add(setting)
    session.flush()
    return setting


class TestAppAnnotationSettingCollectionBindingDetail:
    def test_returns_the_bound_collection_binding(self, sqlite_session: Session) -> None:
        binding = _persist_collection_binding(sqlite_session)
        setting = _persist_setting(sqlite_session, collection_binding_id=binding.id)

        result = setting.collection_binding_detail(session=sqlite_session)

        assert result is not None
        assert result.id == binding.id

    def test_returns_none_when_binding_missing(self, sqlite_session: Session) -> None:
        setting = _persist_setting(sqlite_session, collection_binding_id=str(uuid4()))

        assert setting.collection_binding_detail(session=sqlite_session) is None
