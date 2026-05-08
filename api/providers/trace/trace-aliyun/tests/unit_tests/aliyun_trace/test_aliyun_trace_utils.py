import json
from collections.abc import Mapping
from typing import Any, cast
from unittest.mock import MagicMock

import pytest
from dify_trace_aliyun.entities.semconv import (
    GEN_AI_FRAMEWORK,
    GEN_AI_SESSION_ID,
    GEN_AI_SPAN_KIND,
    GEN_AI_USER_ID,
    INPUT_VALUE,
    OUTPUT_VALUE,
)
from dify_trace_aliyun.utils import (
    create_common_span_attributes,
    create_links_from_trace_id,
    create_status_from_error,
    extract_retrieval_documents,
    format_input_messages,
    format_output_messages,
    format_retrieval_documents,
    get_user_id_from_message_data,
    get_workflow_node_status,
    serialize_json_data,
)
from opentelemetry.trace import Link, StatusCode

from core.rag.models.document import Document
from graphon.entities import WorkflowNodeExecution
from graphon.enums import WorkflowNodeExecutionStatus
from models import EndUser


def test_get_user_id_from_message_data_no_end_user(monkeypatch: pytest.MonkeyPatch):
    message_data = MagicMock()
    message_data.from_account_id = "account_id"
    message_data.from_end_user_id = None

    assert get_user_id_from_message_data(message_data) == "account_id"


def test_get_user_id_from_message_data_with_end_user(monkeypatch: pytest.MonkeyPatch):
    message_data = MagicMock()
    message_data.from_account_id = "account_id"
    message_data.from_end_user_id = "end_user_id"

    end_user_data = MagicMock(spec=EndUser)
    end_user_data.session_id = "session_id"

    mock_session = MagicMock()
    mock_session.get.return_value = end_user_data

    from dify_trace_aliyun.utils import db

    monkeypatch.setattr(db, "session", mock_session)

    assert get_user_id_from_message_data(message_data) == "session_id"


def test_get_user_id_from_message_data_end_user_not_found(monkeypatch: pytest.MonkeyPatch):
    message_data = MagicMock()
    message_data.from_account_id = "account_id"
    message_data.from_end_user_id = "end_user_id"

    mock_session = MagicMock()
    mock_session.get.return_value = None

    from dify_trace_aliyun.utils import db

    monkeypatch.setattr(db, "session", mock_session)

    assert get_user_id_from_message_data(message_data) == "account_id"


def test_create_status_from_error():
    # Case OK
    status_ok = create_status_from_error(None)
    assert status_ok.status_code == StatusCode.OK

    # Case Error
    status_err = create_status_from_error("some error")
    assert status_err.status_code == StatusCode.ERROR
    assert status_err.description == "some error"


def test_get_workflow_node_status():
    node_execution = MagicMock(spec=WorkflowNodeExecution)

    # SUCCEEDED
    node_execution.status = WorkflowNodeExecutionStatus.SUCCEEDED
    status = get_workflow_node_status(node_execution)
    assert status.status_code == StatusCode.OK

    # FAILED
    node_execution.status = WorkflowNodeExecutionStatus.FAILED
    node_execution.error = "node fail"
    status = get_workflow_node_status(node_execution)
    assert status.status_code == StatusCode.ERROR
    assert status.description == "node fail"

    # EXCEPTION
    node_execution.status = WorkflowNodeExecutionStatus.EXCEPTION
    node_execution.error = "node exception"
    status = get_workflow_node_status(node_execution)
    assert status.status_code == StatusCode.ERROR
    assert status.description == "node exception"

    # UNSET/OTHER
    node_execution.status = WorkflowNodeExecutionStatus.RUNNING
    status = get_workflow_node_status(node_execution)
    assert status.status_code == StatusCode.UNSET


def test_create_links_from_trace_id(monkeypatch: pytest.MonkeyPatch):
    # Mock create_link
    mock_link = MagicMock(spec=Link)
    import dify_trace_aliyun.data_exporter.traceclient

    monkeypatch.setattr(dify_trace_aliyun.data_exporter.traceclient, "create_link", lambda trace_id_str: mock_link)

    # Trace ID None
    assert create_links_from_trace_id(None) == []

    # Trace ID Present
    links = create_links_from_trace_id("trace_id")
    assert len(links) == 1
    assert links[0] == mock_link


def test_extract_retrieval_documents():
    doc1 = MagicMock(spec=Document)
    doc1.page_content = "content1"
    doc1.metadata = {"dataset_id": "ds1", "doc_id": "di1", "document_id": "dd1", "score": 0.9}

    doc2 = MagicMock(spec=Document)
    doc2.page_content = "content2"
    doc2.metadata = {"dataset_id": "ds2"}  # Missing some keys

    documents = [doc1, doc2]
    extracted = extract_retrieval_documents(documents)

    assert len(extracted) == 2
    assert extracted[0]["content"] == "content1"
    assert extracted[0]["metadata"]["dataset_id"] == "ds1"
    assert extracted[0]["score"] == 0.9

    assert extracted[1]["content"] == "content2"
    assert extracted[1]["metadata"]["dataset_id"] == "ds2"
    assert extracted[1]["metadata"]["doc_id"] is None
    assert extracted[1]["score"] is None


def test_serialize_json_data():
    data = {"a": 1}
    # Test ensure_ascii default (False)
    assert serialize_json_data(data) == json.dumps(data, ensure_ascii=False)
    # Test ensure_ascii True
    assert serialize_json_data(data, ensure_ascii=True) == json.dumps(data, ensure_ascii=True)


def test_create_common_span_attributes():
    attrs = create_common_span_attributes(
        session_id="s1", user_id="u1", span_kind="kind1", framework="fw1", inputs="in1", outputs="out1"
    )
    assert attrs[GEN_AI_SESSION_ID] == "s1"
    assert attrs[GEN_AI_USER_ID] == "u1"
    assert attrs[GEN_AI_SPAN_KIND] == "kind1"
    assert attrs[GEN_AI_FRAMEWORK] == "fw1"
    assert attrs[INPUT_VALUE] == "in1"
    assert attrs[OUTPUT_VALUE] == "out1"


def test_format_retrieval_documents():
    # Not a list
    assert format_retrieval_documents(cast(list[object], "not a list")) == []

    # Valid list
    docs = [
        {"metadata": {"score": 0.8, "document_id": "doc1", "source": "src1"}, "content": "c1", "title": "t1"},
        {
            "metadata": {"_source": "src2", "doc_metadata": {"extra": "val"}},
            "content": "c2",
            # Missing title
        },
        "not a dict",  # Should be skipped
    ]
    formatted = format_retrieval_documents(docs)

    assert len(formatted) == 2
    assert formatted[0]["document"]["content"] == "c1"
    assert formatted[0]["document"]["metadata"]["title"] == "t1"
    assert formatted[0]["document"]["metadata"]["source"] == "src1"
    assert formatted[0]["document"]["score"] == 0.8
    assert formatted[0]["document"]["id"] == "doc1"

    assert formatted[1]["document"]["content"] == "c2"
    assert formatted[1]["document"]["metadata"]["source"] == "src2"
    assert formatted[1]["document"]["metadata"]["extra"] == "val"
    assert "title" not in formatted[1]["document"]["metadata"]
    assert formatted[1]["document"]["score"] == 0.0  # Default

    # Exception handling
    # We can trigger an exception by passing something that causes an error in the loop logic,
    # but the try/except covers the whole function.
    # Passing a list that contains something that throws when calling .get() - though dicts won't.
    # Let's mock a dict that raises on get.
    class BadDict:
        def get(self, *args, **kwargs):
            raise Exception("boom")

    assert format_retrieval_documents([BadDict()]) == []


def test_format_input_messages():
    # Not a dict
    assert format_input_messages(cast(Mapping[str, Any], None)) == serialize_json_data([])

    # No prompts
    assert format_input_messages({}) == serialize_json_data([])

    # Valid prompts
    process_data = {
        "prompts": [
            {"role": "user", "text": "hello"},
            {"role": "assistant", "text": "hi"},
            {"role": "system", "text": "be helpful"},
            {"role": "tool", "text": "result"},
            {"role": "invalid", "text": "skip me"},
            "not a dict",
            {"role": "user", "text": ""},  # Empty text, should be skipped? Code says `if text: message = ...`
        ]
    }
    result = format_input_messages(process_data)
    result_list = json.loads(result)

    assert len(result_list) == 4
    assert result_list[0]["role"] == "user"
    assert result_list[0]["parts"][0]["content"] == "hello"
    assert result_list[1]["role"] == "assistant"
    assert result_list[2]["role"] == "system"
    assert result_list[3]["role"] == "tool"

    # Exception path
    assert format_input_messages({"prompts": [None]}) == serialize_json_data([])


def test_format_output_messages():
    # Not a dict
    assert format_output_messages(cast(Mapping[str, Any], None)) == serialize_json_data([])

    # No text
    assert format_output_messages({"finish_reason": "stop"}) == serialize_json_data([])

    # Valid
    outputs = {"text": "done", "finish_reason": "length"}
    result = format_output_messages(outputs)
    result_list = json.loads(result)
    assert len(result_list) == 1
    assert result_list[0]["role"] == "assistant"
    assert result_list[0]["parts"][0]["content"] == "done"
    assert result_list[0]["finish_reason"] == "length"

    # Invalid finish reason
    outputs2 = {"text": "done", "finish_reason": "unknown"}
    result2 = format_output_messages(outputs2)
    result_list2 = json.loads(result2)
    assert result_list2[0]["finish_reason"] == "stop"

    # Exception path
    # Trigger exception in serialize_json_data by passing non-serializable
    assert format_output_messages({"text": MagicMock()}) == serialize_json_data([])
