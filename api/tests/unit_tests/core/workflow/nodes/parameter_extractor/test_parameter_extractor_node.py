from unittest.mock import MagicMock, patch

import pytest

from core.model_runtime.entities.llm_entities import LLMUsage
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessageRole,
    SystemPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.entities.model_entities import ModelFeature, ModelPropertyKey
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.prompt.entities.advanced_prompt_entities import CompletionModelPromptTemplate
from core.prompt.simple_prompt_transform import ModelMode
from core.variables.types import SegmentType
from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.nodes.base.node import NodeState
from core.workflow.nodes.parameter_extractor.exc import (
    InvalidModelModeError,
    InvalidModelTypeError,
    InvalidNumberOfParametersError,
    InvalidSelectValueError,
    InvalidTextContentTypeError,
    InvalidValueTypeError,
    ModelSchemaNotFoundError,
    RequiredParameterMissingError,
)
from core.workflow.nodes.parameter_extractor.parameter_extractor_node import (
    ParameterExtractorNode,
    extract_json,
)

# ============================================================
# Fixtures
# ============================================================


@pytest.fixture
def node(mocker):
    # Patch hydration to avoid pydantic validation
    mocker.patch(
        "core.workflow.nodes.base.node.Node._hydrate_node_data",
        return_value=MagicMock(),
    )

    graph_init_params = MagicMock()
    graph_init_params.tenant_id = "tenant"
    graph_init_params.user_id = "user"
    graph_init_params.app_id = "app"
    graph_init_params.workflow_id = "workflow-id"
    graph_init_params.graph_config = {}
    graph_init_params.call_depth = 0
    graph_init_params.user_from = "account"
    graph_init_params.invoke_from = "web-app"

    graph_runtime_state = MagicMock()
    graph_runtime_state.variable_pool = MagicMock()

    node = ParameterExtractorNode(
        id="node-id",
        config={"id": "node-id"},
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
    )

    return node


@pytest.fixture
def mock_llm_schema():
    schema = MagicMock()
    schema.features = []
    schema.parameter_rules = []
    schema.model_properties = {}
    return schema


@pytest.fixture
def mock_model_instance():
    instance = MagicMock()

    instance.model_type_instance = MagicMock(spec=LargeLanguageModel)

    schema = MagicMock()
    schema.features = []
    instance.model_type_instance.get_model_schema.return_value = schema

    return instance


@pytest.fixture
def mock_model_config():
    config = MagicMock()

    # Model schema
    config.model_schema = MagicMock()
    config.model_schema.model_properties = {}
    config.model_schema.parameter_rules = [
        MagicMock(
            name="max_tokens",
            use_template=None,
        )
    ]

    config.parameters = {"max_tokens": 100}

    # Provider bundle
    provider_model_bundle = MagicMock()
    provider_model_bundle.model_type_instance = MagicMock()
    provider_model_bundle.model_type_instance.get_num_tokens.return_value = 50

    config.provider_model_bundle = provider_model_bundle

    config.model = "gpt"
    config.credentials = {}

    return config


@pytest.fixture
def mock_parameter():
    p = MagicMock()
    p.name = "age"
    p.required = True
    p.type = SegmentType.NUMBER

    p.options = None
    p.is_array_type.return_value = False

    return p


@pytest.fixture
def mock_node_data(mock_parameter):
    data = MagicMock()
    data.query = "q"
    data.parameters = [mock_parameter]
    data.get_parameter_json_schema.return_value = {"type": "object"}
    data.model.mode = "chat"
    data.model.completion_params = {}
    data.memory = None
    data.instruction = ""
    data.vision.enabled = False
    data.reasoning_mode = "prompt"
    return data


# ============================================================
# extract_json
# ============================================================


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ('{"a":1}', '{"a":1}'),
        ("[1,2]", "[1,2]"),
        ('{"a":[1]}xxx', '{"a":[1]}'),
        ("invalid", None),
        ('{"a":1', None),
    ],
)
def test_extract_json(text, expected):
    assert extract_json(text) == expected


# ============================================================
# _invoke
# ============================================================


def test_invoke_success(node, mock_model_instance):
    usage = MagicMock()
    usage.total_tokens = 5
    usage.total_price = 1
    usage.currency = "USD"

    message = MagicMock()
    message.get_text_content.return_value = "ok"
    message.tool_calls = []

    invoke_result = MagicMock()
    invoke_result.message = message
    invoke_result.usage = usage

    mock_model_instance.invoke_llm.return_value = invoke_result

    with patch("core.workflow.nodes.parameter_extractor.parameter_extractor_node.llm_utils.deduct_llm_quota"):
        text, u, tool = node._invoke(
            node_data_model=MagicMock(completion_params={}),
            model_instance=mock_model_instance,
            prompt_messages=[],
            tools=[],
            stop=[],
        )

    assert text == "ok"
    assert tool is None
    assert u == usage


def test_invoke_invalid_text(node, mock_model_instance):
    message = MagicMock()
    message.get_text_content.return_value = 123
    message.tool_calls = []

    invoke_result = MagicMock(message=message, usage=MagicMock())
    mock_model_instance.invoke_llm.return_value = invoke_result

    with pytest.raises(InvalidTextContentTypeError):
        node._invoke(MagicMock(completion_params={}), mock_model_instance, [], [], [])


# ============================================================
# _calculate_rest_token
# ============================================================


def test_calculate_rest_token_success(
    node,
    mock_node_data,
    mock_model_instance,
    mock_model_config,
):
    mock_model_config.model_schema.model_properties = {ModelPropertyKey.CONTEXT_SIZE: 2000}
    mock_model_config.parameters = {"max_tokens": 100}

    with patch.object(
        node,
        "_fetch_model_config",
        return_value=(mock_model_instance, mock_model_config),
    ):
        rest = node._calculate_rest_token(
            node_data=mock_node_data,
            query="q",
            variable_pool=MagicMock(),
            model_config=mock_model_config,
            context="",
        )

    assert isinstance(rest, int)
    assert rest >= 0


def test_calculate_rest_token_invalid_model(node, mock_node_data):
    instance = MagicMock()
    instance.model_type_instance = object()

    with patch.object(node, "_fetch_model_config", return_value=(instance, MagicMock())):
        with pytest.raises(InvalidModelTypeError):
            node._calculate_rest_token(mock_node_data, "", MagicMock(), MagicMock(), "")


def test_calculate_rest_token_schema_missing(node, mock_node_data):
    instance = MagicMock()
    instance.model_type_instance = MagicMock(spec=LargeLanguageModel)
    instance.model_type_instance.get_model_schema.return_value = None

    with patch.object(
        node,
        "_fetch_model_config",
        return_value=(instance, MagicMock()),
    ):
        with pytest.raises(ModelSchemaNotFoundError):
            node._calculate_rest_token(
                mock_node_data,
                "",
                MagicMock(),
                MagicMock(),
                "",
            )


# ============================================================
# _transform_number
# ============================================================


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (True, 1),
        (False, 0),
        (10, 10),
        (10.5, 10.5),
        ("10", 10),
        ("10.5", 10.5),
        ("x", None),
        (None, None),
    ],
)
def test_transform_number(node, value, expected):
    assert node._transform_number(value) == expected


# ============================================================
# _transform_result
# ============================================================


def test_transform_result_default(node, mock_node_data):
    node._node_data = mock_node_data  # ✅ property is read-only

    result = node._transform_result(mock_node_data, {})

    assert isinstance(result, dict)


# ============================================================
# _validate_result
# ============================================================


def test_validate_result_success(node, mock_node_data):
    out = node._validate_result(mock_node_data, {"age": 10})
    assert out["age"] == 10


def test_validate_result_invalid_count(node, mock_node_data):
    with pytest.raises(InvalidNumberOfParametersError):
        node._validate_result(mock_node_data, {})


# ============================================================
# _generate_default_result
# ============================================================


def test_generate_default_result(node):
    param = MagicMock()
    param.name = "x"
    param.type = "number"

    data = MagicMock()
    data.parameters = [param]

    result = node._generate_default_result(data)
    assert result["x"] == 0


# ============================================================
# _get_prompt_engineering_prompt_template
# ============================================================


def test_prompt_template_invalid_mode(node, mock_node_data):
    mock_node_data.model.mode = "invalid"

    with pytest.raises(ValueError):
        node._get_prompt_engineering_prompt_template(
            mock_node_data,
            "",
            MagicMock(convert_template=lambda x: MagicMock(text="")),
            None,
        )


# ============================================================
# _fetch_model_config caching
# ============================================================


def test_fetch_model_config_cache(node):
    node._model_instance = MagicMock()
    node._model_config = MagicMock()

    inst, conf = node._fetch_model_config(MagicMock())
    assert inst == node._model_instance
    assert conf == node._model_config


# ============================================================
# _extract_variable_selector_to_variable_mapping
# ============================================================


def test_extract_variable_selector_mapping():
    node_id = "node1"

    with patch(
        "core.workflow.nodes.parameter_extractor.parameter_extractor_node.ParameterExtractorNodeData.model_validate"
    ) as validate_mock:
        validate_mock.return_value.query = ["q"]
        validate_mock.return_value.instruction = None

        mapping = ParameterExtractorNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id=node_id,
            node_data={},
        )

    assert mapping[f"{node_id}.query"] == ["q"]


# ============================================================
# _run success and failure
# ============================================================


def test_run_success(
    node,
    mock_node_data,
    mock_model_instance,
    mock_model_config,
):
    usage = MagicMock(total_tokens=5, total_price=1, currency="USD")

    node._node_data = mock_node_data  # ✅ fix

    with (
        patch.object(
            node,
            "_fetch_model_config",
            return_value=(mock_model_instance, mock_model_config),
        ),
        patch.object(node, "_invoke", return_value=('{"age":10}', usage, None)),
        patch(
            "core.workflow.nodes.parameter_extractor.parameter_extractor_node.llm_utils.fetch_memory",
            return_value=None,
        ),
        patch(
            "core.workflow.nodes.parameter_extractor.parameter_extractor_node.llm_utils.fetch_files",
            return_value=[],
        ),
    ):
        result = node.run()

    assert result is not None


def test_run_invoke_failure(
    node,
    mock_node_data,
    mock_model_instance,
    mock_model_config,
):
    node._node_data = mock_node_data

    with (
        patch.object(
            node,
            "_fetch_model_config",
            return_value=(mock_model_instance, mock_model_config),
        ),
        patch.object(node, "_invoke", side_effect=Exception("boom")),
        patch(
            "core.workflow.nodes.parameter_extractor.parameter_extractor_node.llm_utils.fetch_memory",
            return_value=None,
        ),
        patch(
            "core.workflow.nodes.parameter_extractor.parameter_extractor_node.llm_utils.fetch_files",
            return_value=[],
        ),
    ):
        result = node.run()

    assert result is not None

    assert node.state == NodeState.UNKNOWN


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("10", 10),
        ("10.5", 10.5),
        (10, 10),
        (10.5, 10.5),
        (True, 1),
        (False, 0),
        ("invalid", None),
        (None, None),
        ("", None),
    ],
)
def test_transform_number_full(node, value, expected):
    result = node._transform_number(value)
    assert result == expected


def test_validate_result_missing_required(node, mock_parameter):
    mock_parameter.required = True

    node_data = MagicMock()
    node_data.parameters = [mock_parameter]

    result = {"age": None}

    with pytest.raises(ValueError):
        node._validate_result(node_data, result)


def test_generate_default_result_array(node):
    param = MagicMock()
    param.name = "items"
    param.required = False
    param.type = SegmentType.STRING
    param.is_array_type.return_value = True

    node_data = MagicMock()
    node_data.parameters = [param]

    result = node._generate_default_result(node_data)

    assert result["items"] == ""


def test_calculate_rest_token_multi_tool(node, mock_node_data):
    instance = MagicMock()
    instance.model_type_instance = MagicMock(spec=LargeLanguageModel)

    schema = MagicMock()
    schema.features = [ModelFeature.MULTI_TOOL_CALL]
    instance.model_type_instance.get_model_schema.return_value = schema

    config = MagicMock()
    config.model_schema.model_properties = {ModelPropertyKey.CONTEXT_SIZE: 2000}
    config.model_schema.parameter_rules = []
    config.parameters = {}
    config.provider_model_bundle.model_type_instance.get_num_tokens.return_value = 50
    config.model = "gpt"
    config.credentials = {}

    with patch.object(node, "_fetch_model_config", return_value=(instance, config)):
        rest = node._calculate_rest_token(
            mock_node_data,
            "q",
            MagicMock(),
            config,
            "",
        )

    assert isinstance(rest, int)


def test_calculate_rest_token_invalid_model_type(node, mock_node_data):
    instance = MagicMock()
    instance.model_type_instance = object()  # not LLM

    with patch.object(node, "_fetch_model_config", return_value=(instance, MagicMock())):
        with pytest.raises(InvalidModelTypeError):
            node._calculate_rest_token(
                mock_node_data,
                "",
                MagicMock(),
                MagicMock(),
                "",
            )


def test_transform_result_array(node):
    param = MagicMock()
    param.name = "items"
    param.required = False
    param.type = SegmentType.STRING
    param.is_array_type.return_value = True

    node_data = MagicMock()
    node_data.parameters = [param]

    result = node._transform_result(node_data, {"items": ["a", "b"]})

    assert result["items"] == ""


def test_prompt_template_valid(node, mock_node_data):
    mock_node_data.model.mode = ModelMode.CHAT.value

    result = node._get_prompt_engineering_prompt_template(
        mock_node_data,
        "",
        MagicMock(convert_template=lambda x: MagicMock(text="prompt")),
        None,
        2000,
    )

    assert result is not None


def test_run_with_memory(node, mock_node_data, mock_model_instance, mock_model_config):
    node._node_data = mock_node_data

    with (
        patch.object(node, "_fetch_model_config", return_value=(mock_model_instance, mock_model_config)),
        patch.object(node, "_invoke", return_value=('{"age":10}', MagicMock(), None)),
        patch(
            "core.workflow.nodes.parameter_extractor.parameter_extractor_node.llm_utils.fetch_memory",
            return_value=MagicMock(),
        ),
        patch(
            "core.workflow.nodes.parameter_extractor.parameter_extractor_node.llm_utils.fetch_files",
            return_value=[],
        ),
    ):
        result = node.run()

    assert result is not None


def test_run_invalid_json_response(node, mock_model_instance, mock_model_config):
    node._node_data = MagicMock()
    node._node_data.parameters = []
    node._node_data.memory = None

    usage = MagicMock(total_tokens=1, total_price=0, currency="USD")

    with (
        patch.object(node, "_fetch_model_config", return_value=(mock_model_instance, mock_model_config)),
        patch.object(node, "_invoke", return_value=("INVALID_JSON", usage, None)),
        patch(
            "core.workflow.nodes.parameter_extractor.parameter_extractor_node.llm_utils.fetch_memory", return_value=None
        ),
        patch(
            "core.workflow.nodes.parameter_extractor.parameter_extractor_node.llm_utils.fetch_files", return_value=[]
        ),
    ):
        result = node.run()

    assert result is not None


def test_validate_result_parameter_count_mismatch(node):
    param = MagicMock()
    param.name = "age"
    param.required = False

    node_data = MagicMock()
    node_data.parameters = [param]

    result = {"age": 1, "extra": 2}

    with pytest.raises(ValueError):
        node._validate_result(node_data, result)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("10", 10),
        ("10.5", 10.5),
        ("abc", None),
        (None, None),
    ],
)
def test_transform_number_branch(node, value, expected):
    result = node._transform_number(value)
    assert result == expected


def test_calculate_rest_token_negative_clamped(node, mock_node_data):
    instance = MagicMock()

    class FakeLLM:
        def get_model_schema(self, *a, **k):
            schema = MagicMock()
            schema.features = []
            schema.parameter_rules = []
            return schema

    instance.model_type_instance = FakeLLM()

    config = MagicMock()
    config.model_schema.model_properties = {ModelPropertyKey.CONTEXT_SIZE: 10}
    config.model_schema.parameter_rules = []
    config.parameters = {}
    config.provider_model_bundle.model_type_instance.get_num_tokens.return_value = 5000
    config.model = "gpt"
    config.credentials = {}

    with patch(
        "core.workflow.nodes.parameter_extractor.parameter_extractor_node.LargeLanguageModel",
        FakeLLM,
    ):
        with patch.object(node, "_fetch_model_config", return_value=(instance, config)):
            rest = node._calculate_rest_token(
                mock_node_data,
                "q",
                MagicMock(),
                config,
                "",
            )

    assert rest == 0


def test_reasoning_mode_branch(node):
    node_data = MagicMock()
    node_data.reasoning_mode = "some-mode"
    node_data.parameters = []

    result = node._generate_default_result(node_data)

    assert isinstance(result, dict)


def test_prompt_template_valid_mode(node):
    node_data = MagicMock()
    node_data.model.mode = ModelMode.CHAT.value
    node_data.instruction = ""
    node_data.memory = None

    variable_pool = MagicMock()
    variable_pool.convert_template.return_value = MagicMock(text="hello")

    result = node._get_prompt_engineering_prompt_template(
        node_data,
        "q",
        variable_pool,
        None,
        1000,
    )

    assert result is not None


def test_extract_json_mismatched_brackets_returns_prefix():
    assert extract_json("{] trailing") == "{"


def test_get_default_config_contains_completion_stop():
    config = ParameterExtractorNode.get_default_config()

    assert config["model"]["prompt_templates"]["completion_model"]["stop"] == ["Human:"]


def test_validate_result_raises_when_required_parameter_is_missing_by_name(node):
    parameter = MagicMock()
    parameter.name = "age"
    parameter.required = True
    parameter.type = SegmentType.NUMBER
    parameter.options = None

    data = MagicMock()
    data.parameters = [parameter]

    with pytest.raises(RequiredParameterMissingError):
        node._validate_result(data, {"other": 1})


def test_validate_result_raises_for_invalid_value_type(node):
    parameter = MagicMock()
    parameter.name = "age"
    parameter.required = False
    parameter.type = SegmentType.NUMBER
    parameter.options = None

    data = MagicMock()
    data.parameters = [parameter]

    with pytest.raises(InvalidValueTypeError):
        node._validate_result(data, {"age": "not-a-number"})


def test_validate_result_raises_for_invalid_select_option(node):
    parameter = MagicMock()
    parameter.name = "color"
    parameter.required = False
    parameter.type = SegmentType.STRING
    parameter.options = ["red", "blue"]

    data = MagicMock()
    data.parameters = [parameter]

    with pytest.raises(InvalidSelectValueError):
        node._validate_result(data, {"color": "green"})


def test_transform_result_handles_array_nested_types(node):
    number_param = MagicMock()
    number_param.name = "numbers"
    number_param.type = SegmentType.ARRAY_NUMBER
    number_param.is_array_type.return_value = True
    number_param.element_type.return_value = SegmentType.NUMBER

    object_param = MagicMock()
    object_param.name = "objects"
    object_param.type = SegmentType.ARRAY_OBJECT
    object_param.is_array_type.return_value = True
    object_param.element_type.return_value = SegmentType.OBJECT

    bool_param = MagicMock()
    bool_param.name = "flags"
    bool_param.type = SegmentType.ARRAY_BOOLEAN
    bool_param.is_array_type.return_value = True
    bool_param.element_type.return_value = SegmentType.BOOLEAN

    string_param = MagicMock()
    string_param.name = "title"
    string_param.type = SegmentType.STRING
    string_param.is_array_type.return_value = False

    data = MagicMock()
    data.parameters = [number_param, object_param, bool_param, string_param]

    transformed = node._transform_result(
        data,
        {
            "numbers": [1, "2", "x"],
            "objects": [{"a": 1}, "x"],
            "flags": [True, 1, False],
            "title": 123,
        },
    )

    assert transformed["numbers"].value == [1, 2]
    assert transformed["objects"].value == [{"a": 1}]
    assert transformed["flags"].value == [True, False]
    assert transformed["title"] == ""


def test_extract_complete_json_response_returns_none_when_json_not_found(node):
    assert node._extract_complete_json_response("plain text only") is None


def test_extract_json_from_tool_call_returns_none_for_empty_arguments(node):
    tool_call = AssistantPromptMessage.ToolCall(
        id="1",
        type="function",
        function=AssistantPromptMessage.ToolCall.ToolCallFunction(name="x", arguments=""),
    )

    assert node._extract_json_from_tool_call(tool_call) is None


def test_extract_json_from_tool_call_returns_none_for_invalid_json(node):
    tool_call = AssistantPromptMessage.ToolCall(
        id="1",
        type="function",
        function=AssistantPromptMessage.ToolCall.ToolCallFunction(name="x", arguments="not json"),
    )

    assert node._extract_json_from_tool_call(tool_call) is None


def test_get_function_calling_prompt_template_requires_chat_mode(node):
    node_data = MagicMock()
    node_data.model.mode = ModelMode.COMPLETION.value
    node_data.instruction = ""
    node_data.memory = None

    variable_pool = MagicMock()
    variable_pool.convert_template.return_value = MagicMock(text="")

    with pytest.raises(InvalidModelModeError):
        node._get_function_calling_prompt_template(
            node_data=node_data,
            query="q",
            variable_pool=variable_pool,
            memory=None,
            max_token_limit=2000,
        )


def test_get_prompt_engineering_prompt_template_completion_mode(node):
    node_data = MagicMock()
    node_data.model.mode = ModelMode.COMPLETION.value
    node_data.instruction = ""
    node_data.memory = None

    variable_pool = MagicMock()
    variable_pool.convert_template.return_value = MagicMock(text="instruction")

    result = node._get_prompt_engineering_prompt_template(
        node_data=node_data,
        query="question",
        variable_pool=variable_pool,
        memory=None,
        max_token_limit=2000,
    )

    assert isinstance(result, CompletionModelPromptTemplate)
    assert "question" in result.text


def test_calculate_rest_token_uses_parameter_rule_template_name(node, mock_node_data):
    class FakeLLM:
        def get_model_schema(self, *args, **kwargs):
            return MagicMock(features=[])

    model_instance = MagicMock()
    model_instance.model_type_instance = FakeLLM()

    model_config = MagicMock()
    model_config.model = "gpt"
    model_config.credentials = {}
    model_config.model_schema.model_properties = {ModelPropertyKey.CONTEXT_SIZE: 4000}
    model_config.model_schema.parameter_rules = [MagicMock(name="temperature", use_template="max_tokens")]
    model_config.parameters = {"max_tokens": 200}
    model_config.provider_model_bundle.model_type_instance.get_num_tokens.return_value = 100

    with (
        patch("core.workflow.nodes.parameter_extractor.parameter_extractor_node.LargeLanguageModel", FakeLLM),
        patch.object(node, "_fetch_model_config", return_value=(model_instance, model_config)),
        patch(
            "core.workflow.nodes.parameter_extractor.parameter_extractor_node.AdvancedPromptTransform.get_prompt",
            return_value=[],
        ),
    ):
        rest = node._calculate_rest_token(mock_node_data, "q", MagicMock(), model_config, "")

    assert rest == 2700


def test_extract_variable_selector_mapping_includes_instruction_selectors():
    with patch(
        "core.workflow.nodes.parameter_extractor.parameter_extractor_node.ParameterExtractorNodeData.model_validate"
    ) as validate_mock:
        validate_mock.return_value.query = ["start", "query"]
        validate_mock.return_value.instruction = "Use {{#node_a.answer#}}"

        mapping = ParameterExtractorNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id="n1",
            node_data={},
        )

    assert mapping["n1.query"] == ["start", "query"]
    assert mapping["n1.#node_a.answer#"] == ["node_a", "answer"]


def test_run_handles_parameter_extractor_errors(node, mock_node_data, mock_model_instance, mock_model_config):
    node._node_data = mock_node_data

    with (
        patch.object(node, "_fetch_model_config", return_value=(mock_model_instance, mock_model_config)),
        patch.object(node, "_invoke", side_effect=InvalidNumberOfParametersError("invalid")),
        patch(
            "core.workflow.nodes.parameter_extractor.parameter_extractor_node.llm_utils.fetch_memory", return_value=None
        ),
        patch(
            "core.workflow.nodes.parameter_extractor.parameter_extractor_node.llm_utils.fetch_files", return_value=[]
        ),
    ):
        result = node.run()

    assert result is not None


def test_generate_function_call_prompt_inserts_examples_and_tool(node):
    node_data = MagicMock()
    node_data.memory = None
    node_data.get_parameter_json_schema.return_value = {"type": "object", "properties": {}}

    model_config = MagicMock()
    variable_pool = MagicMock()

    with (
        patch.object(node, "_calculate_rest_token", return_value=1000),
        patch.object(node, "_get_function_calling_prompt_template", return_value=[]),
        patch(
            "core.workflow.nodes.parameter_extractor.parameter_extractor_node.AdvancedPromptTransform.get_prompt",
            return_value=[SystemPromptMessage(content="sys"), UserPromptMessage(content="user")],
        ),
    ):
        prompt_messages, tools = node._generate_function_call_prompt(
            node_data=node_data,
            query="extract this",
            variable_pool=variable_pool,
            model_config=model_config,
            memory=None,
            files=[],
        )

    assert len(prompt_messages) > 2
    assert len(tools) == 1
    assert tools[0].name == "extract_parameters"


def test_generate_prompt_engineering_chat_prompt_inserts_examples(node):
    node_data = MagicMock()
    node_data.memory = None
    node_data.get_parameter_json_schema.return_value = {"type": "object", "properties": {}}

    with (
        patch.object(node, "_calculate_rest_token", return_value=1000),
        patch.object(node, "_get_prompt_engineering_prompt_template", return_value=[]),
        patch(
            "core.workflow.nodes.parameter_extractor.parameter_extractor_node.AdvancedPromptTransform.get_prompt",
            return_value=[SystemPromptMessage(content="sys"), UserPromptMessage(content="user")],
        ),
    ):
        prompt_messages = node._generate_prompt_engineering_chat_prompt(
            node_data=node_data,
            query="query",
            variable_pool=MagicMock(),
            model_config=MagicMock(),
            memory=None,
            files=[],
        )

    assert len(prompt_messages) > 2


def test_generate_prompt_engineering_completion_prompt_returns_transformed_messages(node):
    node_data = MagicMock()
    node_data.memory = None
    node_data.get_parameter_json_schema.return_value = {"type": "object", "properties": {}}
    expected_prompt_messages = [UserPromptMessage(content="prompt")]

    with (
        patch.object(node, "_calculate_rest_token", return_value=1000),
        patch.object(node, "_get_prompt_engineering_prompt_template", return_value=[]),
        patch(
            "core.workflow.nodes.parameter_extractor.parameter_extractor_node.AdvancedPromptTransform.get_prompt",
            return_value=expected_prompt_messages,
        ),
    ):
        prompt_messages = node._generate_prompt_engineering_completion_prompt(
            node_data=node_data,
            query="query",
            variable_pool=MagicMock(),
            model_config=MagicMock(),
            memory=None,
            files=[],
        )

    assert prompt_messages == expected_prompt_messages


def test_get_function_calling_prompt_template_uses_memory_window(node):
    node_data = MagicMock()
    node_data.model.mode = ModelMode.CHAT.value
    node_data.instruction = ""
    node_data.memory.window.size = 2
    node_data.memory = MagicMock(window=MagicMock(size=2))

    variable_pool = MagicMock()
    variable_pool.convert_template.return_value = MagicMock(text="instruction")

    memory = MagicMock()
    memory.get_history_prompt_text.return_value = "history"

    messages = node._get_function_calling_prompt_template(
        node_data=node_data,
        query="query",
        variable_pool=variable_pool,
        memory=memory,
        max_token_limit=100,
    )

    assert messages[0].role == PromptMessageRole.SYSTEM
    assert "history" in messages[0].text


def test_get_prompt_engineering_prompt_template_uses_memory_window(node):
    node_data = MagicMock()
    node_data.model.mode = ModelMode.CHAT.value
    node_data.instruction = ""
    node_data.memory = MagicMock(window=MagicMock(size=2))

    variable_pool = MagicMock()
    variable_pool.convert_template.return_value = MagicMock(text="instruction")

    memory = MagicMock()
    memory.get_history_prompt_text.return_value = "history"

    messages = node._get_prompt_engineering_prompt_template(
        node_data=node_data,
        query="query",
        variable_pool=variable_pool,
        memory=memory,
        max_token_limit=100,
    )

    assert messages[0].role == PromptMessageRole.SYSTEM
    assert "history" in messages[0].text


def test_extract_complete_json_response_parses_prefixed_payload(node):
    result = node._extract_complete_json_response('prefix {"age": 18} trailing')

    assert result == {"age": 18}


def test_extract_json_from_tool_call_parses_prefixed_payload(node):
    tool_call = AssistantPromptMessage.ToolCall(
        id="1",
        type="function",
        function=AssistantPromptMessage.ToolCall.ToolCallFunction(name="extract", arguments='prefix {"a": 1} suffix'),
    )

    assert node._extract_json_from_tool_call(tool_call) == {"a": 1}


def test_transform_result_handles_boolean_and_string_values(node):
    bool_param = MagicMock()
    bool_param.name = "enabled"
    bool_param.type = SegmentType.BOOLEAN
    bool_param.is_array_type.return_value = False

    string_param = MagicMock()
    string_param.name = "title"
    string_param.type = SegmentType.STRING
    string_param.is_array_type.return_value = False

    array_string_param = MagicMock()
    array_string_param.name = "tags"
    array_string_param.type = SegmentType.ARRAY_STRING
    array_string_param.is_array_type.return_value = True
    array_string_param.element_type.return_value = SegmentType.STRING

    data = MagicMock()
    data.parameters = [bool_param, string_param, array_string_param]

    transformed = node._transform_result(
        data,
        {"enabled": 1, "title": "hello", "tags": ["a", 1, "b"]},
    )

    assert transformed["enabled"] is True
    assert transformed["title"] == "hello"
    assert transformed["tags"].value == ["a", "b"]


def test_run_success_path_with_prompt_engineering_branch(node, mock_node_data):
    class FakeLLM:
        def get_model_schema(self, *args, **kwargs):
            schema = MagicMock()
            schema.features = []
            return schema

    model_instance = MagicMock()
    model_instance.model_type_instance = FakeLLM()

    model_config = MagicMock()
    model_config.model = "gpt"
    model_config.credentials = {}
    model_config.mode = "chat"
    model_config.provider = "openai"
    model_config.stop = []

    usage = LLMUsage.empty_usage()
    usage.total_tokens = 10
    usage.total_price = 1
    usage.currency = "USD"
    node._node_data = mock_node_data
    node.graph_runtime_state.variable_pool.get.return_value = None

    with (
        patch("core.workflow.nodes.parameter_extractor.parameter_extractor_node.LargeLanguageModel", FakeLLM),
        patch.object(node, "_fetch_model_config", return_value=(model_instance, model_config)),
        patch(
            "core.workflow.nodes.parameter_extractor.parameter_extractor_node.llm_utils.fetch_memory", return_value=None
        ),
        patch(
            "core.workflow.nodes.parameter_extractor.parameter_extractor_node.llm_utils.fetch_files", return_value=[]
        ),
        patch.object(node, "_generate_prompt_engineering_prompt", return_value=[]),
        patch.object(node, "_invoke", return_value=('{"age": 10}', usage, None)),
    ):
        result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["__is_success"] == 1
