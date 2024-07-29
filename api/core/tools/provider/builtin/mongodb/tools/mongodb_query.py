from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage

from typing import Any, Dict, List, Union
import json
import dns.resolver
from pymongo.mongo_client import MongoClient
from pymongo.server_api import ServerApi



class MongoDBQueryTool(BuiltinTool):
    def _invoke(self, 
                user_id: str,
                tool_parameters: Dict[str, Any], 
        ) -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """
            invoke mongodb query
        """
        dns.resolver.default_resolver = dns.resolver.Resolver(configure = False)
        dns.resolver.default_resolver.nameservers = ['8.8.8.8']
        #obtain parameters
        uri = self.runtime.credentials['mongodb_uri']
        database_name = tool_parameters['database_name']
        collection_name = tool_parameters['collection_name']
        query_string = tool_parameters['query_pipeline']
        if query_string:
            query = json.loads(query_string)
        else:
            query = []


        #init mongdo db clinet
        client = MongoClient(uri)
        if not database_name:
            MongoClient(uri).admin.command('ping')
            return 
        collection = client[database_name][collection_name]
        #query
        results_list = list(collection.aggregate(query))
        results = {
            "query_result": results_list,
            "number_of_queried": len(results_list),
            "total_number":collection.count_documents({})
        }
    
        return self.create_json_message(object=results)