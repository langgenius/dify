import uuid
from unittest.mock import create_autospec, patch

import pytest
from faker import Faker
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from core.rag.index_processor.constant.index_type import IndexTechniqueType
from models import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset
from models.enums import DataSourceType, TagType
from models.model import App, Tag, TagBinding
from services.tag_service import (
    SaveTagPayload,
    TagBindingCreatePayload,
    TagBindingDeletePayload,
    TagService,
    UpdateTagPayload,
)


class TestTagService:
    @pytest.fixture
    def mock_external_service_dependencies(self):

        with (
            patch("services.tag_service.current_user", create_autospec(Account, instance=True)) as mock_current_user,
        ):
            mock_current_user.current_tenant_id = "test-tenant-id"
            mock_current_user.id = "test-user-id"

            yield {
                "current_user": mock_current_user,
            }

    def _create_test_account_and_tenant(self, db_session_with_containers: Session, mock_external_service_dependencies):

        fake = Faker()

        account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status="active",
        )

        db_session_with_containers.add(account)
        db_session_with_containers.commit()

        tenant = Tenant(
            name=fake.company(),
            status="normal",
        )
        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()

        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db_session_with_containers.add(join)
        db_session_with_containers.commit()

        account.current_tenant = tenant

        mock_external_service_dependencies["current_user"].current_tenant_id = tenant.id
        mock_external_service_dependencies["current_user"].id = account.id

        return account, tenant

    def _create_test_dataset(self, db_session_with_containers: Session, mock_external_service_dependencies, tenant_id):

        fake = Faker()

        dataset = Dataset(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            provider="vendor",
            permission="only_me",
            data_source_type=DataSourceType.UPLOAD_FILE,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            tenant_id=tenant_id,
            created_by=mock_external_service_dependencies["current_user"].id,
        )

        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()

        return dataset

    def _create_test_app(self, db_session_with_containers: Session, mock_external_service_dependencies, tenant_id):

        fake = Faker()

        app = App(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            mode="chat",
            icon_type="emoji",
            icon="🤖",
            icon_background="#FF6B6B",
            enable_site=False,
            enable_api=False,
            tenant_id=tenant_id,
            created_by=mock_external_service_dependencies["current_user"].id,
        )

        db_session_with_containers.add(app)
        db_session_with_containers.commit()

        return app

    def _create_test_tags(
        self, db_session_with_containers: Session, mock_external_service_dependencies, tenant_id, tag_type, count=3
    ):

        fake = Faker()
        tags = []

        for i in range(count):
            tag = Tag(
                name=f"tag_{tag_type}_{i}_{fake.word()}",
                type=tag_type,
                tenant_id=tenant_id,
                created_by=mock_external_service_dependencies["current_user"].id,
            )
            tags.append(tag)

        for tag in tags:
            db_session_with_containers.add(tag)
        db_session_with_containers.commit()

        return tags

    def _create_test_tag_bindings(
        self, db_session_with_containers: Session, mock_external_service_dependencies, tags, target_id, tenant_id
    ):

        tag_bindings = []

        for tag in tags:
            tag_binding = TagBinding(
                tag_id=tag.id,
                target_id=target_id,
                tenant_id=tenant_id,
                created_by=mock_external_service_dependencies["current_user"].id,
            )
            tag_bindings.append(tag_binding)

        for tag_binding in tag_bindings:
            db_session_with_containers.add(tag_binding)
        db_session_with_containers.commit()

        return tag_bindings

    def test_get_tags_success(self, db_session_with_containers: Session, mock_external_service_dependencies):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        tags = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "knowledge", 3
        )

        dataset = self._create_test_dataset(db_session_with_containers, mock_external_service_dependencies, tenant.id)
        self._create_test_tag_bindings(
            db_session_with_containers, mock_external_service_dependencies, tags[:2], dataset.id, tenant.id
        )

        result = TagService.get_tags(db_session_with_containers, "knowledge", tenant.id)

        assert result is not None
        assert len(result) == 3

        for tag_result in result:
            assert hasattr(tag_result, "id")
            assert hasattr(tag_result, "type")
            assert hasattr(tag_result, "name")
            assert hasattr(tag_result, "binding_count")
            assert tag_result.type == "knowledge"

        tag_with_bindings = next((t for t in result if t.binding_count > 0), None)
        assert tag_with_bindings is not None
        assert tag_with_bindings.binding_count >= 1

        assert len(result) == 3

    def test_get_tags_with_keyword_filter(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        tags = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "app", 3
        )

        tags[0].name = "python_development"
        tags[1].name = "machine_learning"
        tags[2].name = "web_development"
        db_session_with_containers.commit()

        result = TagService.get_tags(db_session_with_containers, "app", tenant.id, keyword="development")

        assert result is not None
        assert len(result) == 2

        for tag_result in result:
            assert "development" in tag_result.name.lower()

        result_no_match = TagService.get_tags(db_session_with_containers, "app", tenant.id, keyword="nonexistent")
        assert len(result_no_match) == 0

    def test_get_tags_with_special_characters_in_keyword(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        tag_with_percent = Tag(
            name="50% discount",
            type="app",
            tenant_id=tenant.id,
            created_by=account.id,
        )
        tag_with_percent.id = str(uuid.uuid4())
        db_session_with_containers.add(tag_with_percent)

        tag_with_underscore = Tag(
            name="test_data_tag",
            type="app",
            tenant_id=tenant.id,
            created_by=account.id,
        )
        tag_with_underscore.id = str(uuid.uuid4())
        db_session_with_containers.add(tag_with_underscore)

        tag_with_backslash = Tag(
            name="path\\to\\tag",
            type="app",
            tenant_id=tenant.id,
            created_by=account.id,
        )
        tag_with_backslash.id = str(uuid.uuid4())
        db_session_with_containers.add(tag_with_backslash)

        tag_no_match = Tag(
            name="100% different",
            type="app",
            tenant_id=tenant.id,
            created_by=account.id,
        )
        tag_no_match.id = str(uuid.uuid4())
        db_session_with_containers.add(tag_no_match)

        db_session_with_containers.commit()

        result = TagService.get_tags(db_session_with_containers, "app", tenant.id, keyword="50%")
        assert len(result) == 1
        assert result[0].name == "50% discount"

        result = TagService.get_tags(db_session_with_containers, "app", tenant.id, keyword="test_data")
        assert len(result) == 1
        assert result[0].name == "test_data_tag"

        result = TagService.get_tags(db_session_with_containers, "app", tenant.id, keyword="path\\to\\tag")
        assert len(result) == 1
        assert result[0].name == "path\\to\\tag"

        result = TagService.get_tags(db_session_with_containers, "app", tenant.id, keyword="50%")
        assert len(result) == 1
        assert all("50%" in item.name for item in result)

    def test_get_tags_empty_result(self, db_session_with_containers: Session, mock_external_service_dependencies):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        result = TagService.get_tags(db_session_with_containers, "knowledge", tenant.id)

        assert result is not None
        assert len(result) == 0
        assert isinstance(result, list)

    def test_get_target_ids_by_tag_ids_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        tags = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "knowledge", 3
        )

        datasets = []
        for i in range(2):
            dataset = self._create_test_dataset(
                db_session_with_containers, mock_external_service_dependencies, tenant.id
            )
            datasets.append(dataset)

            tags_to_bind = tags[:2] if i == 0 else tags[2:]
            self._create_test_tag_bindings(
                db_session_with_containers, mock_external_service_dependencies, tags_to_bind, dataset.id, tenant.id
            )

        tag_ids = [tag.id for tag in tags]
        result = TagService.get_target_ids_by_tag_ids("knowledge", tenant.id, tag_ids, db_session_with_containers)

        assert result is not None
        assert len(result) == 3

        dataset_ids = [dataset.id for dataset in datasets]
        for target_id in result:
            assert target_id in dataset_ids

        first_dataset_count = result.count(datasets[0].id)
        assert first_dataset_count == 2

        second_dataset_count = result.count(datasets[1].id)
        assert second_dataset_count == 1

    def test_get_target_ids_by_tag_ids_empty_tag_ids(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        result = TagService.get_target_ids_by_tag_ids("knowledge", tenant.id, [], db_session_with_containers)

        assert result is not None
        assert len(result) == 0
        assert isinstance(result, list)

    def test_get_target_ids_by_tag_ids_match_all(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):

        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )
        tags = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "knowledge", 2
        )
        dataset_with_all_tags = self._create_test_dataset(
            db_session_with_containers, mock_external_service_dependencies, tenant.id
        )
        dataset_with_one_tag = self._create_test_dataset(
            db_session_with_containers, mock_external_service_dependencies, tenant.id
        )
        self._create_test_tag_bindings(
            db_session_with_containers,
            mock_external_service_dependencies,
            tags,
            dataset_with_all_tags.id,
            tenant.id,
        )
        self._create_test_tag_bindings(
            db_session_with_containers,
            mock_external_service_dependencies,
            tags[:1],
            dataset_with_one_tag.id,
            tenant.id,
        )

        tag_ids = [tag.id for tag in tags]
        result = TagService.get_target_ids_by_tag_ids(
            "knowledge", tenant.id, tag_ids, db_session_with_containers, match_all=True
        )

        assert result == [dataset_with_all_tags.id]

        missing_tag_result = TagService.get_target_ids_by_tag_ids(
            "knowledge",
            tenant.id,
            [tags[0].id, str(uuid.uuid4())],
            db_session_with_containers,
            match_all=True,
        )
        assert missing_tag_result == []

    def test_get_target_ids_by_tag_ids_no_matching_tags(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        import uuid

        non_existent_tag_ids = [str(uuid.uuid4()), str(uuid.uuid4())]

        result = TagService.get_target_ids_by_tag_ids(
            "knowledge", tenant.id, non_existent_tag_ids, db_session_with_containers
        )

        assert result is not None
        assert len(result) == 0
        assert isinstance(result, list)

    def test_get_tag_by_tag_name_success(self, db_session_with_containers: Session, mock_external_service_dependencies):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        tags = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "app", 2
        )

        tags[0].name = "python_tag"
        tags[1].name = "ml_tag"
        db_session_with_containers.commit()

        result = TagService.get_tag_by_tag_name("app", tenant.id, "python_tag", db_session_with_containers)

        assert result is not None
        assert len(result) == 1
        assert result[0].name == "python_tag"
        assert result[0].type == TagType.APP
        assert result[0].tenant_id == tenant.id

    def test_get_tag_by_tag_name_no_matches(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        result = TagService.get_tag_by_tag_name("knowledge", tenant.id, "nonexistent_tag", db_session_with_containers)

        assert result is not None
        assert len(result) == 0
        assert isinstance(result, list)

    def test_get_tag_by_tag_name_empty_parameters(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        result_empty_type = TagService.get_tag_by_tag_name("", tenant.id, "test_tag", db_session_with_containers)
        result_empty_name = TagService.get_tag_by_tag_name("knowledge", tenant.id, "", db_session_with_containers)

        assert result_empty_type is not None
        assert len(result_empty_type) == 0
        assert result_empty_name is not None
        assert len(result_empty_name) == 0

    def test_get_tags_by_target_id_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        tags = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "app", 3
        )

        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, tenant.id)
        self._create_test_tag_bindings(
            db_session_with_containers, mock_external_service_dependencies, tags, app.id, tenant.id
        )

        result = TagService.get_tags_by_target_id("app", tenant.id, app.id, db_session_with_containers)

        assert result is not None
        assert len(result) == 3

        for tag in result:
            assert tag.type == TagType.APP
            assert tag.tenant_id == tenant.id
            assert tag.id in [t.id for t in tags]

    def test_get_tags_by_target_id_no_bindings(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, tenant.id)

        result = TagService.get_tags_by_target_id("app", tenant.id, app.id, db_session_with_containers)

        assert result is not None
        assert len(result) == 0
        assert isinstance(result, list)

    def test_save_tags_success(self, db_session_with_containers: Session, mock_external_service_dependencies):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        tag_args = SaveTagPayload(name="test_tag_name", type="knowledge")

        result = TagService.save_tags(tag_args, db_session_with_containers)

        assert result is not None
        assert result.name == "test_tag_name"
        assert result.type == "knowledge"
        assert result.tenant_id == tenant.id
        assert result.created_by == account.id
        assert result.id is not None

        db_session_with_containers.refresh(result)
        assert result.id is not None

        saved_tag = db_session_with_containers.query(Tag).where(Tag.id == result.id).first()
        assert saved_tag is not None
        assert saved_tag.name == "test_tag_name"

    def test_save_tags_duplicate_name_error(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        tag_args = SaveTagPayload(name="duplicate_tag", type="app")
        TagService.save_tags(tag_args, db_session_with_containers)

        with pytest.raises(ValueError) as exc_info:
            TagService.save_tags(tag_args, db_session_with_containers)
        assert "Tag name already exists" in str(exc_info.value)

    def test_update_tags_success(self, db_session_with_containers: Session, mock_external_service_dependencies):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        tag_args = SaveTagPayload(name="original_name", type="knowledge")
        tag = TagService.save_tags(tag_args, db_session_with_containers)

        update_args = UpdateTagPayload(name="updated_name")

        result = TagService.update_tags(update_args, tag.id, db_session_with_containers)

        assert result is not None
        assert result.name == "updated_name"
        assert result.type == "knowledge"
        assert result.id == tag.id

        db_session_with_containers.refresh(result)
        assert result.name == "updated_name"

        updated_tag = db_session_with_containers.query(Tag).where(Tag.id == tag.id).first()
        assert updated_tag is not None
        assert updated_tag.name == "updated_name"

    def test_update_tags_not_found_error(self, db_session_with_containers: Session, mock_external_service_dependencies):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        import uuid

        non_existent_tag_id = str(uuid.uuid4())

        update_args = UpdateTagPayload(name="updated_name")

        with pytest.raises(NotFound) as exc_info:
            TagService.update_tags(update_args, non_existent_tag_id, db_session_with_containers)
        assert "Tag not found" in str(exc_info.value)

    def test_update_tags_duplicate_name_error(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        tag1_args = SaveTagPayload(name="first_tag", type="app")
        tag1 = TagService.save_tags(tag1_args, db_session_with_containers)

        tag2_args = SaveTagPayload(name="second_tag", type="app")
        tag2 = TagService.save_tags(tag2_args, db_session_with_containers)

        update_args = UpdateTagPayload(name="first_tag")

        with pytest.raises(ValueError) as exc_info:
            TagService.update_tags(update_args, tag2.id, db_session_with_containers)
        assert "Tag name already exists" in str(exc_info.value)

    def test_get_tag_binding_count_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        tags = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "knowledge", 2
        )

        dataset = self._create_test_dataset(db_session_with_containers, mock_external_service_dependencies, tenant.id)
        self._create_test_tag_bindings(
            db_session_with_containers, mock_external_service_dependencies, [tags[0]], dataset.id, tenant.id
        )

        result_tag_with_bindings = TagService.get_tag_binding_count(tags[0].id, db_session_with_containers)
        result_tag_without_bindings = TagService.get_tag_binding_count(tags[1].id, db_session_with_containers)

        assert result_tag_with_bindings == 1
        assert result_tag_without_bindings == 0

    def test_get_tag_binding_count_non_existent_tag(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        import uuid

        non_existent_tag_id = str(uuid.uuid4())

        result = TagService.get_tag_binding_count(non_existent_tag_id, db_session_with_containers)

        assert result == 0

    def test_delete_tag_success(self, db_session_with_containers: Session, mock_external_service_dependencies):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        tag = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "app", 1
        )[0]

        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, tenant.id)
        self._create_test_tag_bindings(
            db_session_with_containers, mock_external_service_dependencies, [tag], app.id, tenant.id
        )

        tag_before = db_session_with_containers.query(Tag).where(Tag.id == tag.id).first()
        assert tag_before is not None

        binding_before = db_session_with_containers.query(TagBinding).where(TagBinding.tag_id == tag.id).first()
        assert binding_before is not None

        TagService.delete_tag(tag.id, db_session_with_containers)

        tag_after = db_session_with_containers.query(Tag).where(Tag.id == tag.id).first()
        assert tag_after is None

        binding_after = db_session_with_containers.query(TagBinding).where(TagBinding.tag_id == tag.id).first()
        assert binding_after is None

    def test_delete_tag_not_found_error(self, db_session_with_containers: Session, mock_external_service_dependencies):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        import uuid

        non_existent_tag_id = str(uuid.uuid4())

        with pytest.raises(NotFound) as exc_info:
            TagService.delete_tag(non_existent_tag_id, db_session_with_containers)
        assert "Tag not found" in str(exc_info.value)

    def test_save_tag_binding_success(self, db_session_with_containers: Session, mock_external_service_dependencies):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        tags = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "knowledge", 2
        )

        dataset = self._create_test_dataset(db_session_with_containers, mock_external_service_dependencies, tenant.id)

        binding_payload = TagBindingCreatePayload(
            type="knowledge", target_id=dataset.id, tag_ids=[tag.id for tag in tags]
        )
        TagService.save_tag_binding(binding_payload, db_session_with_containers)

        for tag in tags:
            binding = (
                db_session_with_containers.query(TagBinding)
                .where(TagBinding.tag_id == tag.id, TagBinding.target_id == dataset.id)
                .first()
            )
            assert binding is not None
            assert binding.tenant_id == tenant.id
            assert binding.created_by == account.id

    def test_save_tag_binding_duplicate_handling(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        tag = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "app", 1
        )[0]

        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, tenant.id)

        binding_payload = TagBindingCreatePayload(type="app", target_id=app.id, tag_ids=[tag.id])
        TagService.save_tag_binding(binding_payload, db_session_with_containers)

        TagService.save_tag_binding(binding_payload, db_session_with_containers)

        bindings = db_session_with_containers.scalars(
            select(TagBinding).where(TagBinding.tag_id == tag.id, TagBinding.target_id == app.id)
        ).all()
        assert len(bindings) == 1

    def test_save_tag_binding_invalid_target_type(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        tag = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "knowledge", 1
        )[0]

        import uuid

        non_existent_target_id = str(uuid.uuid4())

        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            TagBindingCreatePayload(type="invalid_type", target_id=non_existent_target_id, tag_ids=[tag.id])

    def test_delete_tag_binding_success(self, db_session_with_containers: Session, mock_external_service_dependencies):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        tags = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "knowledge", 2
        )

        dataset = self._create_test_dataset(db_session_with_containers, mock_external_service_dependencies, tenant.id)
        self._create_test_tag_bindings(
            db_session_with_containers, mock_external_service_dependencies, tags, dataset.id, tenant.id
        )

        bindings_before = (
            db_session_with_containers.query(TagBinding)
            .where(TagBinding.tag_id.in_([tag.id for tag in tags]), TagBinding.target_id == dataset.id)
            .all()
        )
        assert len(bindings_before) == 2

        delete_payload = TagBindingDeletePayload(
            type="knowledge", target_id=dataset.id, tag_ids=[tag.id for tag in tags]
        )
        TagService.delete_tag_binding(delete_payload, db_session_with_containers)

        bindings_after = (
            db_session_with_containers.query(TagBinding)
            .where(TagBinding.tag_id.in_([tag.id for tag in tags]), TagBinding.target_id == dataset.id)
            .all()
        )
        assert len(bindings_after) == 0

    def test_delete_tag_binding_non_existent_binding(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        tag = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "app", 1
        )[0]
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, tenant.id)

        delete_payload = TagBindingDeletePayload(type="app", target_id=app.id, tag_ids=[tag.id])
        TagService.delete_tag_binding(delete_payload, db_session_with_containers)

        bindings = db_session_with_containers.scalars(
            select(TagBinding).where(TagBinding.tag_id == tag.id, TagBinding.target_id == app.id)
        ).all()
        assert len(bindings) == 0

    def test_check_target_exists_knowledge_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        dataset = self._create_test_dataset(db_session_with_containers, mock_external_service_dependencies, tenant.id)

        TagService.check_target_exists("knowledge", dataset.id, db_session_with_containers)

    def test_check_target_exists_knowledge_not_found(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        import uuid

        non_existent_dataset_id = str(uuid.uuid4())

        with pytest.raises(NotFound) as exc_info:
            TagService.check_target_exists("knowledge", non_existent_dataset_id, db_session_with_containers)
        assert "Dataset not found" in str(exc_info.value)

    def test_check_target_exists_app_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, tenant.id)

        TagService.check_target_exists("app", app.id, db_session_with_containers)

    def test_check_target_exists_app_not_found(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        import uuid

        non_existent_app_id = str(uuid.uuid4())

        with pytest.raises(NotFound) as exc_info:
            TagService.check_target_exists("app", non_existent_app_id, db_session_with_containers)
        assert "App not found" in str(exc_info.value)

    def test_check_target_exists_invalid_type(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        import uuid

        non_existent_target_id = str(uuid.uuid4())

        with pytest.raises(NotFound) as exc_info:
            TagService.check_target_exists("invalid_type", non_existent_target_id, db_session_with_containers)
        assert "Invalid binding type" in str(exc_info.value)
