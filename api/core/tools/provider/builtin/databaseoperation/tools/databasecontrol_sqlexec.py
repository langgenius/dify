from typing import Any, Union

import psycopg2
import pymysql

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.databaseoperation.tools._sqltalker_base import SqlTalkerBase
from core.tools.tool.builtin_tool import BuiltinTool


class CommonSqlTalker(SqlTalkerBase):
    def __init__(self, host: str, port: str, username: str, password: str, dbname: str) -> None:
        super().__init__(host, port, username, password, dbname)
        self.conn = None

    def _close(self) -> None:
        self.conn.close()
        self.conn = None

    def _is_connected(self) -> bool:
        return self.conn is not None

    def _commit_transaction(self) -> None:
        self.conn.commit()

    def _rollback_transaction(self) -> None:
        self.conn.rollback()

    def _exec_single(self, sql: str) -> tuple[list[str], list[dict[str, Any]]]:
        cur = self.conn.cursor()
        cur.execute(sql)

        fields_tuple = cur.description

        if fields_tuple is None:
            return None, None

        fields_list = [i[0] for i in fields_tuple]
        data_list = []
        if cur.rowcount > 0:
            data_tuple_list = cur.fetchall()
            data_list = [dict(zip(fields_list, data_tuple)) for data_tuple in data_tuple_list]

        return fields_list, data_list

    def _validate_sqls(self, sqls: list[str]) -> bool:
        # TODO: Add more SQL types in the future
        supported_types = ['SELECT']

        unsupported_sqls = []

        for sql in sqls:
            if self.get_sql_type(sql) not in supported_types:
                unsupported_sqls.append(sql)

        if len(unsupported_sqls) > 0:
            raise Exception("Unsupported SQL statements: \n" + "\n".join([f"{i+1}. {sql}" for i, sql in enumerate(unsupported_sqls)]))

        return True


class PostgreSqlTalker(CommonSqlTalker):
    def _connect(self) -> None:
        self.conn = psycopg2.connect(
            database=self.dbname,
            user=self.username,
            password=self.password,
            host=self.host,
            port=self.port
        )

    def _begin_transaction(self) -> None:
        self.conn.autocommit = False


class MySqlTalker(CommonSqlTalker):
    def _connect(self) -> None:
        self.conn = pymysql.connect(
            database=self.dbname,
            user=self.username,
            password=self.password,
            host=self.host,
            port=int(self.port)
        )

    def _begin_transaction(self) -> None:
        self.conn.autocommit(False)
        self.conn.begin()


class DatabaseControlSqlExecTool(BuiltinTool):
    def _invoke(self,
                user_id: str,
                tool_parameters: dict[str, Any]
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        sql = tool_parameters.get('sql')
        output_format = tool_parameters.get('output_format', 'json')
        dbsystem = tool_parameters.get('dbsystem')
        host = tool_parameters.get('host')
        port = tool_parameters.get('port')
        username = tool_parameters.get('username')
        password = tool_parameters.get('password')
        dbname = tool_parameters.get('dbname')

        result_str = ''
        output_type = SqlTalkerBase.OutputType.Markdown if output_format == 'markdown' else SqlTalkerBase.OutputType.JSON
        if dbsystem == 'postgresql':
            with PostgreSqlTalker(host, port, username, password, dbname) as sqltalker:
                result_str = sqltalker.exec(sql, output_format=output_type)
        elif dbsystem == 'mysql':
            with MySqlTalker(host, port, username, password, dbname) as sqltalker:
                result_str = sqltalker.exec(sql, output_format=output_type)
        else:
            raise ValueError(f"Unsupported database system: {dbsystem}")

        return self.create_text_message(result_str)
