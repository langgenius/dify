from typing import Any, Union

import requests
import time

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class CrawlTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        url = "https://api.firecrawl.dev/v0/crawl"
        headers = {
            "Authorization": f"Bearer {self.runtime.credentials['firecrawl_api_key']}",
            "Content-Type": "application/json"
        }
        response = requests.post(url, json=tool_parameters, headers=headers)
        job_id = response.json().get("jobId")
        
        # Wait for a short period of time before requesting the status
        time.sleep(5)  # Adjust this value as needed

        # Request crawl status using the job_id
        status_url = f"https://api.firecrawl.dev/v0/crawl/status/{job_id}"
        
        # Poll the status endpoint until the job is done or a timeout is reached
        timeout = time.time() + 60*10  # 10 minutes from now
        while True:
            status_response = requests.get(status_url, headers=headers)
            status = status_response.json().get('status')
            
            if status == 'done' or time.time() > timeout:
                break
            
            # Wait for a short period of time before the next status check
            time.sleep(5)  # Adjust this value as needed
        
        return self.create_text_message(status_response.text)