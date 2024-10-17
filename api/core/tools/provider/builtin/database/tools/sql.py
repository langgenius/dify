import datetime
from typing import Any, Union

from sqlalchemy import create_engine, text

from configs import dify_config
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

if dify_config.TOOL_DATABASE_URI:
    engine = create_engine(dify_config.TOOL_DATABASE_URI, echo=True)


class SQLTool(BuiltinTool):

    @staticmethod
    def _convert_to_markdown(columns, query_result):
        markdown_table = []

        header = "| " + " | ".join(columns) + " |"
        markdown_table.append(header)

        separator = "| " + " | ".join(["---"] * len(columns)) + " |"
        markdown_table.append(separator)

        for row in query_result:
            row_data = "| " + " | ".join(str(r) for r in row) + " |"
            markdown_table.append(row_data)

        return "\n".join(markdown_table)

    @staticmethod
    def _convert_to_json(columns, query_result):
        converted_data = []
        for record in query_result:
            converted_item = []
            for element in record:
                if isinstance(element, datetime.datetime):
                    converted_item.append(element.strftime('%Y-%m-%d %H:%M:%S'))
                elif isinstance(element, datetime.date):
                    converted_item.append(element.strftime('%Y-%m-%d'))
                else:
                    converted_item.append(element)
            converted_data.append(converted_item)
        return [dict(zip(columns, row)) for row in converted_data]

    def _invoke(
            self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        sql_string = tool_parameters.get("sql_string")
        output_format = tool_parameters.get("output_format", "json")

        forbidden_keywords = dify_config.TOOL_DATABASE_FORBIDDEN

        if any(keyword in sql_string.lower() for keyword in forbidden_keywords):
            return self.create_text_message("Query contains forbidden keywords")

        with engine.connect() as connection:
            trans = connection.begin()
            try:
                result_proxy = connection.execute(text(sql_string))

                if result_proxy.returns_rows:
                    result = result_proxy.fetchall()
                    columns = result_proxy.keys()
                    if output_format == "json":
                        result = self._convert_to_json(columns, result)
                    else:
                        result = self._convert_to_markdown(columns, result)
                else:
                    result = f"Query executed successfully. Affected Rows: {result_proxy.rowcount}"
                trans.commit()
            except Exception as e:
                trans.rollback()
                result = f"Error executing query: {str(e)}"

        if isinstance(result, list):
            return [self.create_json_message(r) for r in result]
        return self.create_text_message(result)
