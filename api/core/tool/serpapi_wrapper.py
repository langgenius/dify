from langchain import SerpAPIWrapper


class OptimizedSerpAPIWrapper(SerpAPIWrapper):

    @staticmethod
    def _process_response(res: dict, num_results: int = 5) -> str:
        """Process response from SerpAPI."""
        if "error" in res.keys():
            raise ValueError(f"Got error from SerpAPI: {res['error']}")
        if "answer_box" in res.keys() and type(res["answer_box"]) == list:
            res["answer_box"] = res["answer_box"][0]
        if "answer_box" in res.keys() and "answer" in res["answer_box"].keys():
            toret = res["answer_box"]["answer"]
        elif "answer_box" in res.keys() and "snippet" in res["answer_box"].keys():
            toret = res["answer_box"]["snippet"]
        elif (
            "answer_box" in res.keys()
            and "snippet_highlighted_words" in res["answer_box"].keys()
        ):
            toret = res["answer_box"]["snippet_highlighted_words"][0]
        elif (
            "sports_results" in res.keys()
            and "game_spotlight" in res["sports_results"].keys()
        ):
            toret = res["sports_results"]["game_spotlight"]
        elif (
            "shopping_results" in res.keys()
            and "title" in res["shopping_results"][0].keys()
        ):
            toret = res["shopping_results"][:3]
        elif (
            "knowledge_graph" in res.keys()
            and "description" in res["knowledge_graph"].keys()
        ):
            toret = res["knowledge_graph"]["description"]
        elif 'organic_results' in res.keys() and len(res['organic_results']) > 0:
            toret = ""
            for result in res["organic_results"][:num_results]:
                if "link" in result:
                    toret += "----------------\nlink: " + result["link"] + "\n"
                if "snippet" in result:
                    toret += "snippet: " + result["snippet"] + "\n"
        else:
            toret = "No good search result found"
        return "search result:\n" + toret
