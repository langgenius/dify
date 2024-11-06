from typing import Any, Union

from vanna.remote import VannaDefault

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.tool.builtin_tool import BuiltinTool


class VannaTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        api_key = self.runtime.credentials.get("api_key", None)
        if not api_key:
            raise ToolProviderCredentialValidationError("Please input api key")

        model = tool_parameters.get("model", "")
        if not model:
            return self.create_text_message("Please input RAG model")

        prompt = tool_parameters.get("prompt", "")
        if not prompt:
            return self.create_text_message("Please input prompt")

        url = tool_parameters.get("url", "")
        if not url:
            return self.create_text_message("Please input URL/Host/DSN")

        db_name = tool_parameters.get("db_name", "")
        username = tool_parameters.get("username", "")
        password = tool_parameters.get("password", "")
        port = tool_parameters.get("port", 0)

        base_url = self.runtime.credentials.get("base_url", None)
        vn = VannaDefault(model=model, api_key=api_key, config={"endpoint": base_url})

        db_type = tool_parameters.get("db_type", "")
        if db_type in {"Postgres", "MySQL", "Hive", "ClickHouse"}:
            if not db_name:
                return self.create_text_message("Please input database name")
            if not username:
                return self.create_text_message("Please input username")
            if port < 1:
                return self.create_text_message("Please input port")

        schema_sql = "SELECT * FROM INFORMATION_SCHEMA.COLUMNS"
        match db_type:
            case "SQLite":
                schema_sql = "SELECT type, sql FROM sqlite_master WHERE sql is not null"
                vn.connect_to_sqlite(url)
            case "Postgres":
                vn.connect_to_postgres(host=url, dbname=db_name, user=username, password=password, port=port)
            case "DuckDB":
                vn.connect_to_duckdb(url=url)
            case "SQLServer":
                vn.connect_to_mssql(url)
            case "MySQL":
                vn.connect_to_mysql(host=url, dbname=db_name, user=username, password=password, port=port)
            case "Oracle":
                vn.connect_to_oracle(user=username, password=password, dsn=url)
            case "Hive":
                vn.connect_to_hive(host=url, dbname=db_name, user=username, password=password, port=port)
            case "ClickHouse":
                vn.connect_to_clickhouse(host=url, dbname=db_name, user=username, password=password, port=port)

        enable_training = tool_parameters.get("enable_training", False)
        reset_training_data = tool_parameters.get("reset_training_data", False)
        if enable_training:
            if reset_training_data:
                existing_training_data = vn.get_training_data()
                if len(existing_training_data) > 0:
                    for _, training_data in existing_training_data.iterrows():
                        vn.remove_training_data(training_data["id"])

            ddl = tool_parameters.get("ddl", "")
            question = tool_parameters.get("question", "")
            sql = tool_parameters.get("sql", "")
            memos = tool_parameters.get("memos", "")
            training_metadata = tool_parameters.get("training_metadata", False)

            if training_metadata:
                if db_type == "SQLite":
                    df_ddl = vn.run_sql(schema_sql)
                    for ddl in df_ddl["sql"].to_list():
                        vn.train(ddl=ddl)
                else:
                    df_information_schema = vn.run_sql(schema_sql)
                    plan = vn.get_training_plan_generic(df_information_schema)
                    vn.train(plan=plan)

            if ddl:
                vn.train(ddl=ddl)

            if sql:
                if question:
                    vn.train(question=question, sql=sql)
                else:
                    vn.train(sql=sql)
            if memos:
                vn.train(documentation=memos)

        #########################################################################################
        # Due to CVE-2024-5565, we have to disable the chart generation feature
        # The Vanna library uses a prompt function to present the user with visualized results,
        # it is possible to alter the prompt using prompt injection and run arbitrary Python code
        # instead of the intended visualization code.
        # Specifically - allowing external input to the library’s “ask” method
        # with "visualize" set to True (default behavior) leads to remote code execution.
        # Affected versions: <= 0.5.5
        #########################################################################################
        allow_llm_to_see_data = tool_parameters.get("allow_llm_to_see_data", False)
        res = vn.ask(
            prompt, print_results=False, auto_train=True, visualize=False, allow_llm_to_see_data=allow_llm_to_see_data
        )

        result = []

        if res is not None:
            result.append(self.create_text_message(res[0]))
            if len(res) > 1 and res[1] is not None:
                result.append(self.create_text_message(res[1].to_markdown()))
            if len(res) > 2 and res[2] is not None:
                result.append(
                    self.create_blob_message(blob=res[2].to_image(format="svg"), meta={"mime_type": "image/svg+xml"})
                )

        return result
