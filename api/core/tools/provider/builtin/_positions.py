import os.path

from yaml import FullLoader, load

from core.tools.entities.user_entities import UserToolProvider

position = {}

class BuiltinToolProviderSort:
    @staticmethod
    def sort(providers: list[UserToolProvider]) -> list[UserToolProvider]:
        global position
        if not position:
            tmp_position = {}
            file_path = os.path.join(os.path.dirname(__file__), '..', '_position.yaml')
            with open(file_path) as f:
                for pos, val in enumerate(load(f, Loader=FullLoader)):
                    tmp_position[val] = pos
            position = tmp_position

        def sort_compare(provider: UserToolProvider) -> int:
            # if provider.type == UserToolProvider.ProviderType.MODEL:
            #     return position.get(f'model_provider.{provider.name}', 10000)
            return position.get(provider.name, 10000)
        
        sorted_providers = sorted(providers, key=sort_compare)

        return sorted_providers