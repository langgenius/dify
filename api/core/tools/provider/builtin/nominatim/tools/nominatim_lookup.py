import json
from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class NominatimLookupTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        osm_ids = tool_parameters.get('osm_ids', '')
        
        if not osm_ids:
            return self.create_text_message('Please provide OSM IDs')

        params = {
            'osm_ids': osm_ids,
            'format': 'json',
            'addressdetails': 1
        }
        
        return self._make_request(user_id, 'lookup', params)

    def _make_request(self, user_id: str, endpoint: str, params: dict) -> ToolInvokeMessage:
        base_url = self.runtime.credentials.get('base_url', 'https://nominatim.openstreetmap.org')
        
        try:
            headers = {
                "User-Agent": "DifyNominatimTool/1.0"
            }
            s = requests.session()
            response = s.request(
                method='GET',
                headers=headers,
                url=f"{base_url}/{endpoint}",
                params=params
            )
            response_data = response.json()
            
            if response.status_code == 200:
                s.close()
                return self.create_text_message(self.summary(user_id=user_id, content=json.dumps(response_data, ensure_ascii=False)))
            else:
                return self.create_text_message(f"Error: {response.status_code} - {response.text}")
        except Exception as e:
            return self.create_text_message(f"An error occurred: {str(e)}")