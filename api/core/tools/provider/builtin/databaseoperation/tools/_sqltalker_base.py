import json
from enum import Enum
from typing import Any

import sqlparse
from sqlparse.sql import Statement


class SqlTalkerBase:
    OutputType = Enum('OutputType', 'JSON Markdown')

    def __init__(self, host: str, port: str, username: str, password: str, dbname: str) -> None:
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.dbname = dbname

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()

    def connect(self) -> None:
        if self.is_connected():
            raise Exception("Connection is already established")

        self._connect()

    def close(self) -> None:
        if self.is_connected():
            self._close()

    def is_connected(self) -> bool:
        return self._is_connected()

    def begin_transaction(self) -> None:
        if not self.is_connected():
            raise Exception("Connection is not established")

        self._begin_transaction()

    def commit_transaction(self) -> None:
        if not self.is_connected():
            raise Exception("Connection is not established")

        self._commit_transaction()

    def rollback_transaction(self) -> None:
        if not self.is_connected():
            raise Exception("Connection is not established")

        self._rollback_transaction()

    def exec_single(self, sql: str) -> tuple[list[str], list[dict[str, Any]]]:
        return self._exec_single(sql)

    def validate_sqls(self, sqls: list[str]) -> bool:
        return self._validate_sqls(sqls)

    def exec(self, sql: str, output_format: OutputType = OutputType.JSON) -> str:
        """
        Execute one or more SQL statements

        :param sql: SQL statements
        :param output_format: Output format
        :return: Result of the SQL statements
        """
        if not self.is_connected():
            raise Exception("Connection is not established")

        statements = self.split_sql_statements(sql)

        if not self.validate_sqls(statements):
            raise Exception("Unsupported SQL statements")

        result_str_list = []

        self.begin_transaction()

        try:
            for stmt in statements:
                fields_list, data_list = self.exec_single(stmt)
                result_str = ''
                if fields_list:
                    if data_list:
                        result_str = self.convert_to_markdown_table(fields_list, data_list) \
                            if output_format == self.OutputType.Markdown else json.dumps(data_list)
                    else:
                        result_str = self.convert_to_markdown_table(fields_list, []) \
                            if output_format == self.OutputType.Markdown else '[]'

                if result_str != '':
                    result_str_list.append(result_str)
        except Exception as e:
            self.rollback_transaction()
            raise e
        else:
            self.commit_transaction()

        if output_format == self.OutputType.Markdown:
            return '\n\n'.join(result_str_list)
        else:
            return f'[{",".join(result_str_list)}]'

    def convert_to_markdown_table(self, fields: list, data: list[dict[str, Any]]) -> str:
        """
        Convert a list of dictionaries to a Markdown table

        :param fields: List of field names
        :param data: List of dictionaries
        :return: Markdown table as a string       
        """
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

    def get_sql_type(self, sql) -> str:
        """
        Get the SQL type of a SQL statement

        :param sql: SQL statement
        :return: SQL type (e.g. SELECT, INSERT, UPDATE, DELETE)
        """
        parsed = sqlparse.parse(sql)
        if not parsed:
            return "Empty or invalid SQL statement"

        stmt: Statement = parsed[0]
        first_token = stmt.token_first(skip_cm=True)  # skip comments and whitespaces
        return first_token.value.upper()

    def split_sql_statements(self, sql) -> list[str]:
        statements = sqlparse.split(sql)
        return [stmt.strip() for stmt in statements if stmt.strip()]

    def _connect(self) -> None:
        raise NotImplementedError('SqlTalkerBase._connect() is not implemented')

    def _close(self) -> None:
        raise NotImplementedError('SqlTalkerBase._close() is not implemented')

    def _is_connected(self) -> bool:
        raise NotImplementedError('SqlTalkerBase._is_connected() is not implemented')

    def _begin_transaction(self) -> None:
        raise NotImplementedError('SqlTalkerBase._begin_transaction() is not implemented')

    def _commit_transaction(self) -> None:
        raise NotImplementedError('SqlTalkerBase._commit_transaction() is not implemented')

    def _rollback_transaction(self) -> None:
        raise NotImplementedError('SqlTalkerBase._rollback_transaction() is not implemented')

    def _exec_single(self, sql: str) -> tuple[list[str], list[dict[str, Any]]]:
        """
        Execute a single SQL statement

        :param sql: SQL statement
        :return: Result of the fields and data
        """
        raise NotImplementedError('SqlTalkerBase._exec_single() is not implemented')

    def _validate_sqls(self, sqls: list[str]) -> bool:
        """
        Validate SQL statements

        :param sqls: List of SQL statements
        :return: True if SQL statements is supported, False otherwise
        """
        raise NotImplementedError('SqlTalkerBase._filter_sql() is not implemented')
