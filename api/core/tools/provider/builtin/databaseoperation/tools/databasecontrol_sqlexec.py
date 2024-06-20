import json
from typing import Any, Union

import psycopg2
import pymysql

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class DatabaseControlSqlExecTool(BuiltinTool):
    def _invoke(self,
                user_id: str,
                tool_parameters: dict[str, Any]
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke tools
            output format: [{"column1":"value1","column2":"value2"},{"column1":"value1","column2":"value2"}]
        """

        sql = tool_parameters.get('sql')
        dbtype = tool_parameters.get('dbtype')
        host = tool_parameters.get('host')
        port = tool_parameters.get('port')
        username = tool_parameters.get('username')
        password = tool_parameters.get('password')
        dbname = tool_parameters.get('dbname')

        result_str = ''
        if dbtype == 'postgresql':
            result_str = self._pg_exec(sql, host, port, username, password, dbname)
        elif dbtype == 'mysql':
            result_str = self._mysql_exec(sql, host, port, username, password, dbname)
        else:
            raise ValueError(f"Unsupported database type: {dbtype}")

        return self.create_text_message(result_str)

    def _pg_exec(self, sql: str, host: str, port: str, username: str, password: str, dbname: str) -> str:
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
            if cur.rowcount == 0:
                result_str = '[]'

            fields_tuple = cur.description
            result_data_list = cur.fetchall()
            result_list = [dict(zip([i[0] for i in fields_tuple], data_tuple)) for data_tuple in result_data_list]
            result_str = json.dumps(result_list)
        else:
            result_str = ''

        cur.close()
        conn.close()

        return result_str

    def _mysql_exec(self, sql: str, host: str, port: str, username: str, password: str, dbname: str) -> str:
        result_str = ''

        conn = pymysql.connect(
            host=host,
            port=int(port),
            user=username,
            passwd=password,
            db=dbname
        )
        cur = conn.cursor()
        cur.execute(sql)
        conn.commit()

        if cur.description is not None:
            if cur.rowcount == 0:
                result_str = '[]'

            fields_tuple = cur.description
            result_data_list = cur.fetchall()
            result_list = [dict(zip([i[0] for i in fields_tuple], data_tuple)) for data_tuple in result_data_list]
            result_str = json.dumps(result_list)
        else:
            result_str = ''

        cur.close()
        conn.close()

        return result_str
