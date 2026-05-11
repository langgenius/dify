from core.datasource.entities.api_entities import DatasourceApiEntity, DatasourceProviderApiEntity
from core.datasource.entities.datasource_entities import DatasourceParameter
from core.tools.entities.common_entities import I18nObject


def test_datasource_api_entity():
    label = I18nObject(en_US="label", zh_Hans="标签")
    description = I18nObject(en_US="desc", zh_Hans="描述")

    entity = DatasourceApiEntity(
        author="author", name="name", label=label, description=description, labels=["l1", "l2"]
    )

    assert entity.author == "author"
    assert entity.name == "name"
    assert entity.label == label
    assert entity.description == description
    assert entity.labels == ["l1", "l2"]
    assert entity.parameters is None
    assert entity.output_schema is None


def test_datasource_provider_api_entity_defaults():
    description = I18nObject(en_US="desc", zh_Hans="描述")
    label = I18nObject(en_US="label", zh_Hans="标签")

    entity = DatasourceProviderApiEntity(
        id="id", author="author", name="name", description=description, icon="icon", label=label, type="type"
    )

    assert entity.id == "id"
    assert entity.datasources == []
    assert entity.is_team_authorization is False
    assert entity.allow_delete is True
    assert entity.plugin_id == ""
    assert entity.plugin_unique_identifier == ""
    assert entity.labels == []


def test_datasource_provider_api_entity_convert_none_to_empty_list():
    description = I18nObject(en_US="desc", zh_Hans="描述")
    label = I18nObject(en_US="label", zh_Hans="标签")

    # Implicitly testing the field_validator "convert_none_to_empty_list"
    entity = DatasourceProviderApiEntity(
        id="id",
        author="author",
        name="name",
        description=description,
        icon="icon",
        label=label,
        type="type",
        datasources=None,  # type: ignore
    )

    assert entity.datasources == []


def test_datasource_provider_api_entity_to_dict():
    description = I18nObject(en_US="desc", zh_Hans="描述")
    label = I18nObject(en_US="label", zh_Hans="标签")

    # Create a parameter that should be converted
    param = DatasourceParameter.get_simple_instance(
        name="test_param", typ=DatasourceParameter.DatasourceParameterType.SYSTEM_FILES, required=True
    )

    ds_entity = DatasourceApiEntity(
        author="author", name="ds_name", label=label, description=description, parameters=[param]
    )

    provider_entity = DatasourceProviderApiEntity(
        id="id",
        author="author",
        name="name",
        description=description,
        icon="icon",
        label=label,
        type="type",
        masked_credentials={"key": "masked"},
        datasources=[ds_entity],
        labels=["l1"],
    )

    result = provider_entity.to_dict()

    assert result["id"] == "id"
    assert result["author"] == "author"
    assert result["name"] == "name"
    assert result["description"] == description.to_dict()
    assert result["icon"] == "icon"
    assert result["label"] == label.to_dict()
    assert result["type"] == "type"
    assert result["team_credentials"] == {"key": "masked"}
    assert result["is_team_authorization"] is False
    assert result["allow_delete"] is True
    assert result["labels"] == ["l1"]

    # Check if parameter type was converted from SYSTEM_FILES to files
    assert result["datasources"][0]["parameters"][0]["type"] == "files"


def test_datasource_provider_api_entity_to_dict_no_params():
    description = I18nObject(en_US="desc", zh_Hans="描述")
    label = I18nObject(en_US="label", zh_Hans="标签")

    ds_entity = DatasourceApiEntity(
        author="author", name="ds_name", label=label, description=description, parameters=None
    )

    provider_entity = DatasourceProviderApiEntity(
        id="id",
        author="author",
        name="name",
        description=description,
        icon="icon",
        label=label,
        type="type",
        datasources=[ds_entity],
    )

    result = provider_entity.to_dict()
    assert result["datasources"][0]["parameters"] is None


def test_datasource_provider_api_entity_to_dict_other_param_type():
    description = I18nObject(en_US="desc", zh_Hans="描述")
    label = I18nObject(en_US="label", zh_Hans="标签")

    param = DatasourceParameter.get_simple_instance(
        name="test_param", typ=DatasourceParameter.DatasourceParameterType.STRING, required=True
    )

    ds_entity = DatasourceApiEntity(
        author="author", name="ds_name", label=label, description=description, parameters=[param]
    )

    provider_entity = DatasourceProviderApiEntity(
        id="id",
        author="author",
        name="name",
        description=description,
        icon="icon",
        label=label,
        type="type",
        datasources=[ds_entity],
    )

    result = provider_entity.to_dict()
    assert result["datasources"][0]["parameters"][0]["type"] == "string"
