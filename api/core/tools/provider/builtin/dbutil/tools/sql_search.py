import json
from typing import Any, Union
import datetime

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.provider.builtin.dbutil.tools.use_db_util import useDbUtil
from pandas import Timestamp

class SqlSearchTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        db_type = tool_parameters.get("db_type", "")
        if not db_type:
            return self.create_text_message("Please select the database type")
        db_connection = tool_parameters.get("db_connection", "")
        if not db_connection:
            return self.create_text_message("Please fill in the database link information, such as：mysql+pymysql://admin:admin@localhost:13306/test")
        query_sql = tool_parameters.get("query_sql", "")
        if not query_sql:
            return self.create_text_message("Please fill in the query SQL, for example：select * from tbl_name")

        use_comment_colname = tool_parameters.get("use_comment_colname", "")
        table_name = tool_parameters.get("table_name", "")
        try:
            db = useDbUtil(db_connection)

        except Exception as e:
            return self.create_text_message(
                "Database link creation exception. {}".format(e)
            )

        try:
            records = db.run_query(query_sql)

            if records == None:
                records = []

            # Replace column name with comment
            if table_name and 'True'==use_comment_colname:
                col_name: dict = db.get_columns_dict(table_name)
                if col_name:
                    n = len(records)
                    i = 0
                    for i in range(n):
                        for key in col_name:
                            if records[i].get(key, '') != '':
                                records[i][col_name[key]] = records[i].pop(key)

            for record in records:
                for key in record:
                    if type(record[key]) is Timestamp:
                        record[key] = record[key].strftime('%Y-%m-%d %H:%M:%S')
                    if type(record[key]) is datetime.date:
                        record[key] = record[key].strftime('%Y-%m-%d')
                    if record[key] is None:
                        record[key] = 'None'

            return self.create_text_message(
                json.dumps(records, ensure_ascii=False)
            )
        except Exception as e:
            return self.create_text_message(
                "SQL execution exception. {}".format(e)
            )
