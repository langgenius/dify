from unittest.mock import patch

import pytest
from flask import Flask

from core.app.app_config.entities import ExternalDataVariableEntity
from core.external_data_tool.external_data_fetch import ExternalDataFetch


class TestExternalDataFetch:
    @pytest.fixture
    def app(self):
        app = Flask(__name__)
        return app

    def test_fetch_success(self, app):
        with app.app_context():
            fetcher = ExternalDataFetch()

            # Setup mocks
            tool1 = ExternalDataVariableEntity(variable="var1", type="type1", config={"c1": "v1"})
            tool2 = ExternalDataVariableEntity(variable="var2", type="type2", config={"c2": "v2"})

            external_data_tools = [tool1, tool2]
            inputs = {"input_key": "input_value"}
            query = "test query"

            with patch("core.external_data_tool.external_data_fetch.ExternalDataToolFactory") as MockFactory:
                # Mock query results
                # We need to return different results for different instances if possible,
                # or just use side_effect on the mock instance's query method.
                mock_factory_instance = MockFactory.return_value
                mock_factory_instance.query.side_effect = ["result1", "result2"]

                result_inputs = fetcher.fetch(
                    tenant_id="tenant1",
                    app_id="app1",
                    external_data_tools=external_data_tools,
                    inputs=inputs,
                    query=query,
                )

                # The order in result_inputs depends on which thread finishes first,
                # but both should be there.
                assert result_inputs["var1"] == "result1"
                assert result_inputs["var2"] == "result2"
                assert result_inputs["input_key"] == "input_value"
                assert len(result_inputs) == 3

                # Verify factory calls
                assert MockFactory.call_count == 2
                MockFactory.assert_any_call(
                    name="type1", tenant_id="tenant1", app_id="app1", variable="var1", config={"c1": "v1"}
                )
                MockFactory.assert_any_call(
                    name="type2", tenant_id="tenant1", app_id="app1", variable="var2", config={"c2": "v2"}
                )

    def test_fetch_no_tools(self):
        # We don't necessarily need app_context if there are no tools,
        # but fetch calls current_app._get_current_object() only inside the loop.
        # Wait, let's look at the code.
        # for tool in external_data_tools:
        #     executor.submit(..., current_app._get_current_object(), ...)
        # So if external_data_tools is empty, it shouldn't access current_app.
        fetcher = ExternalDataFetch()
        inputs = {"input_key": "input_value"}
        result_inputs = fetcher.fetch(
            tenant_id="tenant1", app_id="app1", external_data_tools=[], inputs=inputs, query="test query"
        )
        assert result_inputs == inputs
        assert result_inputs is not inputs  # Should be a copy

    def test_fetch_with_none_variable(self, app):
        with app.app_context():
            fetcher = ExternalDataFetch()
            tool = ExternalDataVariableEntity(variable="var1", type="type1", config={})

            # Patch _query_external_data_tool to return None variable
            with patch.object(ExternalDataFetch, "_query_external_data_tool") as mock_query:
                mock_query.return_value = (None, "some_result")

                result_inputs = fetcher.fetch(
                    tenant_id="t1", app_id="a1", external_data_tools=[tool], inputs={"in": "val"}, query="q"
                )

                assert "var1" not in result_inputs
                assert result_inputs == {"in": "val"}

    def test_query_external_data_tool(self, app):
        fetcher = ExternalDataFetch()
        tool = ExternalDataVariableEntity(variable="var1", type="type1", config={"k": "v"})

        with patch("core.external_data_tool.external_data_fetch.ExternalDataToolFactory") as MockFactory:
            mock_factory_instance = MockFactory.return_value
            mock_factory_instance.query.return_value = "query_result"

            var, res = fetcher._query_external_data_tool(
                flask_app=app, tenant_id="t1", app_id="a1", external_data_tool=tool, inputs={"i": "v"}, query="q"
            )

            assert var == "var1"
            assert res == "query_result"
            MockFactory.assert_called_once_with(
                name="type1", tenant_id="t1", app_id="a1", variable="var1", config={"k": "v"}
            )
            mock_factory_instance.query.assert_called_once_with(inputs={"i": "v"}, query="q")
