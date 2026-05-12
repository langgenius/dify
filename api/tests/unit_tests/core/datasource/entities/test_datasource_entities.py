from unittest.mock import patch

import pytest

from core.datasource.entities.datasource_entities import (
    DatasourceEntity,
    DatasourceIdentity,
    DatasourceInvokeMeta,
    DatasourceLabel,
    DatasourceMessage,
    DatasourceParameter,
    DatasourceProviderEntity,
    DatasourceProviderEntityWithPlugin,
    DatasourceProviderIdentity,
    DatasourceProviderType,
    GetOnlineDocumentPageContentRequest,
    GetOnlineDocumentPageContentResponse,
    GetWebsiteCrawlRequest,
    OnlineDocumentInfo,
    OnlineDocumentPage,
    OnlineDocumentPageContent,
    OnlineDocumentPagesMessage,
    OnlineDriveBrowseFilesRequest,
    OnlineDriveBrowseFilesResponse,
    OnlineDriveDownloadFileRequest,
    OnlineDriveFile,
    OnlineDriveFileBucket,
    WebsiteCrawlMessage,
    WebSiteInfo,
    WebSiteInfoDetail,
)
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolLabelEnum


def test_datasource_provider_type():
    assert DatasourceProviderType.value_of("online_document") == DatasourceProviderType.ONLINE_DOCUMENT
    assert DatasourceProviderType.value_of("local_file") == DatasourceProviderType.LOCAL_FILE

    with pytest.raises(ValueError, match="invalid mode value invalid"):
        DatasourceProviderType.value_of("invalid")


def test_datasource_parameter_type():
    param_type = DatasourceParameter.DatasourceParameterType.STRING
    assert param_type.as_normal_type() == "string"
    assert param_type.cast_value("test") == "test"

    param_type = DatasourceParameter.DatasourceParameterType.NUMBER
    assert param_type.cast_value("123") == 123


def test_datasource_parameter():
    param = DatasourceParameter.get_simple_instance(
        name="test_param",
        typ=DatasourceParameter.DatasourceParameterType.STRING,
        required=True,
        options=["opt1", "opt2"],
    )
    assert param.name == "test_param"
    assert param.type == DatasourceParameter.DatasourceParameterType.STRING
    assert param.required is True
    assert len(param.options) == 2
    assert param.options[0].value == "opt1"

    param_no_options = DatasourceParameter.get_simple_instance(
        name="test_param_2", typ=DatasourceParameter.DatasourceParameterType.NUMBER, required=False
    )
    assert param_no_options.options == []

    # Test init_frontend_parameter
    # For STRING, it should just return the value as is (or cast to str)
    frontend_param = param.init_frontend_parameter("val")
    assert frontend_param == "val"

    # Test parameter type methods
    assert DatasourceParameter.DatasourceParameterType.STRING.as_normal_type() == "string"
    assert DatasourceParameter.DatasourceParameterType.NUMBER.as_normal_type() == "number"
    assert DatasourceParameter.DatasourceParameterType.SECRET_INPUT.as_normal_type() == "string"

    assert DatasourceParameter.DatasourceParameterType.NUMBER.cast_value("10.5") == 10.5
    assert DatasourceParameter.DatasourceParameterType.BOOLEAN.cast_value("true") is True
    assert DatasourceParameter.DatasourceParameterType.FILES.cast_value(["f1", "f2"]) == ["f1", "f2"]


def test_datasource_identity():
    label = I18nObject(en_US="label", zh_Hans="标签")
    identity = DatasourceIdentity(author="author", name="name", label=label, provider="provider", icon="icon")
    assert identity.author == "author"
    assert identity.name == "name"
    assert identity.label == label
    assert identity.provider == "provider"
    assert identity.icon == "icon"


def test_datasource_entity():
    label = I18nObject(en_US="label", zh_Hans="标签")
    identity = DatasourceIdentity(author="author", name="name", label=label, provider="provider")
    description = I18nObject(en_US="desc", zh_Hans="描述")

    entity = DatasourceEntity(
        identity=identity,
        description=description,
        parameters=None,  # Should be handled by validator
    )
    assert entity.parameters == []

    param = DatasourceParameter.get_simple_instance("p1", DatasourceParameter.DatasourceParameterType.STRING, True)
    entity_with_params = DatasourceEntity(identity=identity, description=description, parameters=[param])
    assert entity_with_params.parameters == [param]


def test_datasource_provider_identity():
    label = I18nObject(en_US="label", zh_Hans="标签")
    description = I18nObject(en_US="desc", zh_Hans="描述")
    identity = DatasourceProviderIdentity(
        author="author", name="name", description=description, icon="icon.png", label=label, tags=[ToolLabelEnum.SEARCH]
    )

    assert identity.author == "author"
    assert identity.name == "name"
    assert identity.description == description
    assert identity.icon == "icon.png"
    assert identity.label == label
    assert identity.tags == [ToolLabelEnum.SEARCH]

    # Test generate_datasource_icon_url
    with patch("core.datasource.entities.datasource_entities.dify_config") as mock_config:
        mock_config.CONSOLE_API_URL = "http://api.example.com"
        url = identity.generate_datasource_icon_url("tenant123")
        assert "http://api.example.com/console/api/workspaces/current/plugin/icon" in url
        assert "tenant_id=tenant123" in url
        assert "filename=icon.png" in url

    # Test hardcoded icon
    identity.icon = "https://assets.dify.ai/images/File%20Upload.svg"
    assert identity.generate_datasource_icon_url("tenant123") == identity.icon

    # Test with empty CONSOLE_API_URL
    identity.icon = "test.png"
    with patch("core.datasource.entities.datasource_entities.dify_config") as mock_config:
        mock_config.CONSOLE_API_URL = None
        url = identity.generate_datasource_icon_url("tenant123")
        assert url.startswith("/console/api/workspaces/current/plugin/icon")


def test_datasource_provider_entity():
    label = I18nObject(en_US="label", zh_Hans="标签")
    description = I18nObject(en_US="desc", zh_Hans="描述")
    identity = DatasourceProviderIdentity(
        author="author", name="name", description=description, icon="icon", label=label
    )

    entity = DatasourceProviderEntity(
        identity=identity,
        provider_type=DatasourceProviderType.ONLINE_DOCUMENT,
        credentials_schema=[],
        oauth_schema=None,
    )
    assert entity.identity == identity
    assert entity.provider_type == DatasourceProviderType.ONLINE_DOCUMENT
    assert entity.credentials_schema == []


def test_datasource_provider_entity_with_plugin():
    label = I18nObject(en_US="label", zh_Hans="标签")
    description = I18nObject(en_US="desc", zh_Hans="描述")
    identity = DatasourceProviderIdentity(
        author="author", name="name", description=description, icon="icon", label=label
    )

    entity = DatasourceProviderEntityWithPlugin(
        identity=identity, provider_type=DatasourceProviderType.ONLINE_DOCUMENT, datasources=[]
    )
    assert entity.datasources == []


def test_datasource_invoke_meta():
    meta = DatasourceInvokeMeta(time_cost=1.5, error="some error", tool_config={"k": "v"})
    assert meta.time_cost == 1.5
    assert meta.error == "some error"
    assert meta.tool_config == {"k": "v"}

    d = meta.to_dict()
    assert d == {"time_cost": 1.5, "error": "some error", "tool_config": {"k": "v"}}

    empty_meta = DatasourceInvokeMeta.empty()
    assert empty_meta.time_cost == 0.0
    assert empty_meta.error is None
    assert empty_meta.tool_config == {}

    error_meta = DatasourceInvokeMeta.error_instance("fatal error")
    assert error_meta.time_cost == 0.0
    assert error_meta.error == "fatal error"
    assert error_meta.tool_config == {}


def test_datasource_label():
    label_obj = I18nObject(en_US="label", zh_Hans="标签")
    ds_label = DatasourceLabel(name="name", label=label_obj, icon="icon")
    assert ds_label.name == "name"
    assert ds_label.label == label_obj
    assert ds_label.icon == "icon"


def test_online_document_models():
    page = OnlineDocumentPage(
        page_id="p1",
        page_name="name",
        page_icon={"type": "emoji"},
        type="page",
        last_edited_time="2023-01-01",
        parent_id=None,
    )
    assert page.page_id == "p1"

    info = OnlineDocumentInfo(workspace_id="w1", workspace_name="name", workspace_icon="icon", total=1, pages=[page])
    assert info.total == 1

    msg = OnlineDocumentPagesMessage(result=[info])
    assert msg.result == [info]

    req = GetOnlineDocumentPageContentRequest(workspace_id="w1", page_id="p1", type="page")
    assert req.workspace_id == "w1"

    content = OnlineDocumentPageContent(workspace_id="w1", page_id="p1", content="hello")
    assert content.content == "hello"

    resp = GetOnlineDocumentPageContentResponse(result=content)
    assert resp.result == content


def test_website_crawl_models():
    req = GetWebsiteCrawlRequest(crawl_parameters={"url": "http://test.com"})
    assert req.crawl_parameters == {"url": "http://test.com"}

    detail = WebSiteInfoDetail(source_url="http://test.com", content="content", title="title", description="desc")
    assert detail.title == "title"

    info = WebSiteInfo(status="completed", web_info_list=[detail], total=1, completed=1)
    assert info.status == "completed"

    msg = WebsiteCrawlMessage(result=info)
    assert msg.result == info

    # Test default values
    msg_default = WebsiteCrawlMessage()
    assert msg_default.result.status == ""
    assert msg_default.result.web_info_list == []


def test_online_drive_models():
    file = OnlineDriveFile(id="f1", name="file.txt", size=100, type="file")
    assert file.name == "file.txt"

    bucket = OnlineDriveFileBucket(bucket="b1", files=[file], is_truncated=False, next_page_parameters=None)
    assert bucket.bucket == "b1"

    req = OnlineDriveBrowseFilesRequest(bucket="b1", prefix="folder1", max_keys=10, next_page_parameters=None)
    assert req.prefix == "folder1"

    resp = OnlineDriveBrowseFilesResponse(result=[bucket])
    assert resp.result == [bucket]

    dl_req = OnlineDriveDownloadFileRequest(id="f1", bucket="b1")
    assert dl_req.id == "f1"


def test_datasource_message():
    # Use proper dict for message to avoid Pydantic Union validation ambiguity/crashes
    msg = DatasourceMessage(type="text", message={"text": "hello"})
    assert msg.message.text == "hello"

    msg_json = DatasourceMessage(type="json", message={"json_object": {"k": "v"}})
    assert msg_json.message.json_object == {"k": "v"}
