import json
import logging
import time

import requests
from flask_restful import Resource

from controllers.console import api
from extensions.ext_redis import redis_client


class GithubStarApi(Resource):
    def get(self):
        cache_key = "github_stars_langgenius_dify"
        cache_ttl = 1800
        fallback_count = 98570
        
        try:
            cached_data = redis_client.get(cache_key)
            if cached_data:
                try:
                    data = json.loads(cached_data)
                    return {"stargazers_count": data["stargazers_count"]}
                except (json.JSONDecodeError, KeyError):
                    pass
            
            response = requests.get(
                "https://api.github.com/repos/langgenius/dify",
                timeout=10,
                headers={"User-Agent": "Dify-App"}
            )
            
            if response.status_code == 200:
                data = response.json()
                star_count = data.get("stargazers_count", fallback_count)
                
                cache_data = {
                    "stargazers_count": star_count,
                    "updated_at": int(time.time())
                }
                
                try:
                    redis_client.setex(cache_key, cache_ttl, json.dumps(cache_data))
                except Exception:
                    pass
                    
                return {"stargazers_count": star_count}
                
        except Exception as e:
            logging.warning("Failed to fetch GitHub stars: %s", str(e))
        
        return {"stargazers_count": fallback_count}


api.add_resource(GithubStarApi, "/github-stars")