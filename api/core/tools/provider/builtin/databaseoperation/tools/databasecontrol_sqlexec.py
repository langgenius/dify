import json
from typing import Any, Union

import psycopg2
import pymysql
from pymysql.constants import CLIENT

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class DatabaseControlSqlExecTool(BuiltinTool):
    def _invoke(self,
                user_id: str,
                tool_parameters: dict[str, Any]
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        sql = tool_parameters.get('sql')
        output_format = tool_parameters.get('output_format', 'json')
        dbtype = tool_parameters.get('dbtype')
        host = tool_parameters.get('host')
        port = tool_parameters.get('port')
        username = tool_parameters.get('username')
        password = tool_parameters.get('password')
        dbname = tool_parameters.get('dbname')

        result_str = ''
        if dbtype == 'postgresql':
            result_str = self._pg_exec(sql, output_format, host, port, username, password, dbname)
        elif dbtype == 'mysql':
            result_str = self._mysql_exec(sql, output_format, host, port, username, password, dbname)
        else:
            raise ValueError(f"Unsupported database type: {dbtype}")

        return self.create_text_message(result_str)

    def _pg_exec(self, sql: str, output_format: str, host: str, port: str,
                 username: str, password: str, dbname: str) -> str:
        result_str = ''

        conn = psycopg2.connect(
            database=dbname,
            user=username,
            password=password,
            host=host,
            port=port
        )
        cur = conn.cursor()
        cur.execute(sql)
        conn.commit()

        if cur.description is not None:
            fields_tuple = cur.description
            fields_list = [i[0] for i in fields_tuple]

            if cur.rowcount == 0:
                result_str = self._convert_to_markdown_table(fields_list, []) \
                    if output_format == 'markdown' else '[]'
            else:
                result_data_list = cur.fetchall()
                result_list = [dict(zip(fields_list, data_tuple)) for data_tuple in result_data_list]
                if output_format == 'markdown':
                    result_str = self._convert_to_markdown_table(fields_list, result_list)
                else:
                    result_str = json.dumps(result_list)
        else:
            result_str = ''

        cur.close()
        conn.close()

        return result_str

    def _mysql_exec(self, sql: str, output_format: str, host: str, port: str,
                    username: str, password: str, dbname: str) -> str:
        result_str = ''

        conn = pymysql.connect(
            host=host,
            port=int(port),
            user=username,
            passwd=password,
            db=dbname,
            client_flag=CLIENT.MULTI_STATEMENTS
        )

        try:
            with conn.cursor() as cur:
                conn.begin()

                try:
                    cur.execute(sql)

                    result_list = []
                    fields_list = []

                    while True:
                        result_list = []
                        fields_list = []
                        if cur.description is not None:
                            fields_tuple = cur.description
                            fields_list = [i[0] for i in fields_tuple]

                            if cur.rowcount > 0:
                                result_data_list = cur.fetchall()
                                result_list = [dict(zip(fields_list, data_tuple)) for data_tuple in result_data_list]

                        if not cur.nextset():
                            break

                    if fields_list:
                        if output_format == 'markdown':
                            result_str = self._convert_to_markdown_table(fields_list, result_list)
                        else:
                            result_str = json.dumps(result_list)
                    else:
                        result_str = ''
                except Exception as e:
                    conn.rollback()
                    raise e
                else:
                    conn.commit()
        finally:
            conn.close()

        return result_str

    def _convert_to_markdown_table(self, fields: list, data: list[dict[str, Any]]) -> str:
        if not fields:
            return ""

        markdown_table = ["| " + " | ".join(fields) + " |", "| " + " | ".join(["---"] * len(fields)) + " |"]

        for item in data:
            # Convert each entry to a Markdown table row
            row = [str(item.get(header, "")) for header in fields]
            markdown_row = "| " + " | ".join(row) + " |"
            markdown_table.append(markdown_row)

        # Combine all rows into a single string
        markdown_result = "\n".join(markdown_table)

        return markdown_result
