import json
from typing import Any, Union
import logging
import datetime
import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.provider.builtin.dbutil.tools.use_db import use_db
from pandas import Timestamp

class SqlutilTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        db_type = tool_parameters.get("db_type", "")
        if not db_type:
            return self.create_text_message("请选择数据库类型")
        db_connection = tool_parameters.get("db_connection", "")
        if not db_connection:
            return self.create_text_message("请填写数据库链接信息，例如：mysql+pymysql://admin:admin@localhost:13306/qabi")
        query_sql = tool_parameters.get("query_sql", "")
        if not query_sql:
            return self.create_text_message("请填写查询sql，例如：select * from tbl_name")

        use_chiness_colname = tool_parameters.get("use_chiness_colname", "")
        table_name = tool_parameters.get("table_name", "")
        try:
            db = use_db(db_connection, logging)

        except Exception as e:
            return self.create_text_message(
                "创建数据库链接异常. {}".format(e)
            )

        try:
            records = db.run_query(query_sql)
            logging.info("db result(%s): %s", type(records), records)

            if records == None:
                records = []

            if table_name and 'True'==use_chiness_colname:
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
                        #logging.info(record[key])
                        record[key] = record[key].strftime('%Y-%m-%d %H:%M:%S')
                    if type(record[key]) is datetime.date:
                        #logging.info(record[key])
                        record[key] = record[key].strftime('%Y-%m-%d')
                    if record[key] is None:
                        record[key] = 'None'

            return self.create_text_message(
                json.dumps(records, ensure_ascii=False)
            )
            #return json.dumps(error_message)
        except Exception as e:
            return self.create_text_message(
                "执行sql异常. {}".format(e)
            )
