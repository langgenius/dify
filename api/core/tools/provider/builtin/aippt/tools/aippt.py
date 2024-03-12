from base64 import b64encode
from hashlib import sha1
from hmac import new as hmac_new
from json import loads as json_loads
from threading import Lock
from time import sleep, time
from typing import Any

from httpx import get, post
from requests import get as requests_get
from yarl import URL

from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolParameter, ToolParameterOption
from core.tools.tool.builtin_tool import BuiltinTool


class AIPPTGenerateTool(BuiltinTool):
    """
    A tool for generating a ppt
    """

    _api_base_url = URL('https://co.aippt.cn/api')
    _api_token_cache = {}
    _api_token_cache_lock = Lock()
    _style_cache = {}
    _style_cache_lock = Lock()

    _task = {}
    _task_type_map = {
        'auto': 1,
        'markdown': 7,
    }

    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage | list[ToolInvokeMessage]:
        """
        Invokes the AIPPT generate tool with the given user ID and tool parameters.

        Args:
            user_id (str): The ID of the user invoking the tool.
            tool_parameters (dict[str, Any]): The parameters for the tool

        Returns:
            ToolInvokeMessage | list[ToolInvokeMessage]: The result of the tool invocation, which can be a single message or a list of messages.
        """
        title = tool_parameters.get('title', '')
        if not title:
            return self.create_text_message('Please provide a title for the ppt')
        
        model = tool_parameters.get('model', 'aippt')
        if not model:
            return self.create_text_message('Please provide a model for the ppt')
        
        outline = tool_parameters.get('outline', '')

        # create task
        task_id = self._create_task(
            type=self._task_type_map['auto' if not outline else 'markdown'],
            title=title,
            content=outline,
            user_id=user_id
        )

        # get suit
        color = tool_parameters.get('color')
        style = tool_parameters.get('style')

        if color == '__default__':
            color_id = ''
        else:
            color_id = int(color.split('-')[1])

        if style == '__default__':
            style_id = ''
        else:
            style_id = int(style.split('-')[1])

        suit_id = self._get_suit(style_id=style_id, colour_id=color_id)

        # generate outline
        if not outline:
            self._generate_outline(
                task_id=task_id,
                model=model,
                user_id=user_id
            )

            # generate content
            self._generate_content(
                task_id=task_id,
                model=model,
                user_id=user_id
            )

        # generate ppt
        _, ppt_url = self._generate_ppt(
            task_id=task_id,
            suit_id=suit_id,
            user_id=user_id
        )

        return self.create_text_message('''the ppt has been created successfully,'''
                                 f'''the ppt url is {ppt_url}'''
                                 '''please give the ppt url to user and direct user to download it.''')

    def _create_task(self, type: int, title: str, content: str, user_id: str) -> str:
        """
        Create a task

        :param type: the task type
        :param title: the task title
        :param content: the task content

        :return: the task ID
        """
        headers = {
            'x-channel': '',
            'x-api-key': self.runtime.credentials['aippt_access_key'],
            'x-token': self._get_api_token(credentials=self.runtime.credentials, user_id=user_id),
        }
        response = post(
            str(self._api_base_url / 'ai' / 'chat' / 'v2' / 'task'),
            headers=headers,
            files={
                'type': ('', str(type)),
                'title': ('', title),
                'content': ('', content)
            }
        )

        if response.status_code != 200:
            raise Exception(f'Failed to connect to aippt: {response.text}')
        
        response = response.json()
        if response.get('code') != 0:
            raise Exception(f'Failed to create task: {response.get("msg")}')

        return response.get('data', {}).get('id')
    
    def _generate_outline(self, task_id: str, model: str, user_id: str) -> str:
        api_url = self._api_base_url / 'ai' / 'chat' / 'outline' if model == 'aippt' else \
            self._api_base_url / 'ai' / 'chat' / 'wx' / 'outline'
        api_url %= {'task_id': task_id}

        headers = {
            'x-channel': '',
            'x-api-key': self.runtime.credentials['aippt_access_key'],
            'x-token': self._get_api_token(credentials=self.runtime.credentials, user_id=user_id),
        }

        response = requests_get(
            url=api_url,
            headers=headers,
            stream=True,
            timeout=(10, 60)
        )

        if response.status_code != 200:
            raise Exception(f'Failed to connect to aippt: {response.text}')
        
        outline = ''
        for chunk in response.iter_lines(delimiter=b'\n\n'):
            if not chunk:
                continue
            
            event = ''
            lines = chunk.decode('utf-8').split('\n')
            for line in lines:
                if line.startswith('event:'):
                    event = line[6:]
                elif line.startswith('data:'):
                    data = line[5:]
                    if event == 'message':
                        try:
                            data = json_loads(data)
                            outline += data.get('content', '')
                        except Exception as e:
                            pass
                    elif event == 'close':
                        break
                    elif event == 'error' or event == 'filter':
                        raise Exception(f'Failed to generate outline: {data}')
                    
        return outline
    
    def _generate_content(self, task_id: str, model: str, user_id: str) -> str:
        api_url = self._api_base_url / 'ai' / 'chat' / 'content' if model == 'aippt' else \
            self._api_base_url / 'ai' / 'chat' / 'wx' / 'content'
        api_url %= {'task_id': task_id}

        headers = {
            'x-channel': '',
            'x-api-key': self.runtime.credentials['aippt_access_key'],
            'x-token': self._get_api_token(credentials=self.runtime.credentials, user_id=user_id),
        }

        response = requests_get(
            url=api_url,
            headers=headers,
            stream=True,
            timeout=(10, 60)
        )

        if response.status_code != 200:
            raise Exception(f'Failed to connect to aippt: {response.text}')
        
        if model == 'aippt':
            content = ''
            for chunk in response.iter_lines(delimiter=b'\n\n'):
                if not chunk:
                    continue
                
                event = ''
                lines = chunk.decode('utf-8').split('\n')
                for line in lines:
                    if line.startswith('event:'):
                        event = line[6:]
                    elif line.startswith('data:'):
                        data = line[5:]
                        if event == 'message':
                            try:
                                data = json_loads(data)
                                content += data.get('content', '')
                            except Exception as e:
                                pass
                        elif event == 'close':
                            break
                        elif event == 'error' or event == 'filter':
                            raise Exception(f'Failed to generate content: {data}')
                        
            return content
        elif model == 'wenxin':
            response = response.json()
            if response.get('code') != 0:
                raise Exception(f'Failed to generate content: {response.get("msg")}')
            
            return response.get('data', '')
        
        return ''

    def _generate_ppt(self, task_id: str, suit_id: int, user_id) -> tuple[str, str]:
        """
        Generate a ppt

        :param task_id: the task ID
        :param suit_id: the suit ID
        :return: the cover url of the ppt and the ppt url
        """
        headers = {
            'x-channel': '',
            'x-api-key': self.runtime.credentials['aippt_access_key'],
            'x-token': self._get_api_token(credentials=self.runtime.credentials, user_id=user_id),
        }

        response = post(
            str(self._api_base_url / 'design' / 'v2' / 'save'),
            headers=headers,
            data={
                'task_id': task_id,
                'template_id': suit_id
            }
        )

        if response.status_code != 200:
            raise Exception(f'Failed to connect to aippt: {response.text}')
        
        response = response.json()
        if response.get('code') != 0:
            raise Exception(f'Failed to generate ppt: {response.get("msg")}')
        
        id = response.get('data', {}).get('id')
        cover_url = response.get('data', {}).get('cover_url')

        response = post(
            str(self._api_base_url / 'download' / 'export' / 'file'),
            headers=headers,
            data={
                'id': id,
                'format': 'ppt',
                'files_to_zip': False,
                'edit': True
            }
        )

        if response.status_code != 200:
            raise Exception(f'Failed to connect to aippt: {response.text}')
        
        response = response.json()
        if response.get('code') != 0:
            raise Exception(f'Failed to generate ppt: {response.get("msg")}')
        
        export_code = response.get('data')
        if not export_code:
            raise Exception('Failed to generate ppt, the export code is empty')
        
        current_iteration = 0
        while current_iteration < 50:
            # get ppt url
            response = post(
                str(self._api_base_url / 'download' / 'export' / 'file' / 'result'),
                headers=headers,
                data={
                    'task_key': export_code
                }
            )

            if response.status_code != 200:
                raise Exception(f'Failed to connect to aippt: {response.text}')
            
            response = response.json()
            if response.get('code') != 0:
                raise Exception(f'Failed to generate ppt: {response.get("msg")}')
            
            if response.get('msg') == '导出中':
                current_iteration += 1
                sleep(2)
                continue
            
            ppt_url = response.get('data', [])
            if len(ppt_url) == 0:
                raise Exception('Failed to generate ppt, the ppt url is empty')
            
            return cover_url, ppt_url[0]
        
        raise Exception('Failed to generate ppt, the export is timeout')
        
    @classmethod
    def _get_api_token(cls, credentials: dict[str, str], user_id: str) -> str:
        """
        Get API token

        :param credentials: the credentials
        :return: the API token
        """
        access_key = credentials['aippt_access_key']
        secret_key = credentials['aippt_secret_key']

        cache_key = f'{access_key}#@#{user_id}'

        with cls._api_token_cache_lock:
            # clear expired tokens
            now = time()
            for key in list(cls._api_token_cache.keys()):
                if cls._api_token_cache[key]['expire'] < now:
                    del cls._api_token_cache[key]

            if cache_key in cls._api_token_cache:
                return cls._api_token_cache[cache_key]['token']
            
        # get token
        headers = {
            'x-api-key': access_key,
            'x-timestamp': str(int(now)),
            'x-signature': cls._calculate_sign(access_key, secret_key, int(now))
        }

        param = {
            'uid': user_id,
            'channel': ''
        }

        response = get(
            str(cls._api_base_url / 'grant' / 'token'),
            params=param,
            headers=headers
        )

        if response.status_code != 200:
            raise Exception(f'Failed to connect to aippt: {response.text}')
        response = response.json()
        if response.get('code') != 0:
            raise Exception(f'Failed to connect to aippt: {response.get("msg")}')
        
        token = response.get('data', {}).get('token')
        expire = response.get('data', {}).get('time_expire')

        with cls._api_token_cache_lock:
            cls._api_token_cache[cache_key] = {
                'token': token,
                'expire': now + expire
            }

        return token

    @classmethod
    def _calculate_sign(cls, access_key: str, secret_key: str, timestamp: int) -> str:
        return b64encode(
            hmac_new(
                key=secret_key.encode('utf-8'), 
                msg=f'GET@/api/grant/token/@{timestamp}'.encode(),
                digestmod=sha1
            ).digest()
        ).decode('utf-8')

    @classmethod
    def _get_styles(cls, credentials: dict[str, str], user_id: str) -> tuple[list[dict], list[dict]]:
        """
        Get styles
        """

        # check cache
        with cls._style_cache_lock:
            # clear expired styles
            now = time()
            for key in list(cls._style_cache.keys()):
                if cls._style_cache[key]['expire'] < now:
                    del cls._style_cache[key]

            key = f'{credentials["aippt_access_key"]}#@#{user_id}'
            if key in cls._style_cache:
                return cls._style_cache[key]['colors'], cls._style_cache[key]['styles']

        headers = {
            'x-channel': '',
            'x-api-key': credentials['aippt_access_key'],
            'x-token': cls._get_api_token(credentials=credentials, user_id=user_id)
        }
        response = get(
            str(cls._api_base_url / 'template_component' / 'suit' / 'select'),
            headers=headers
        )

        if response.status_code != 200:
            raise Exception(f'Failed to connect to aippt: {response.text}')
        
        response = response.json()

        if response.get('code') != 0:
            raise Exception(f'Failed to connect to aippt: {response.get("msg")}')
        
        colors = [{
            'id': f'id-{item.get("id")}',
            'name': item.get('name'),
            'en_name': item.get('en_name', item.get('name')),
        } for item in response.get('data', {}).get('colour') or []]
        styles = [{
            'id': f'id-{item.get("id")}',
            'name': item.get('title'),
        } for item in response.get('data', {}).get('suit_style') or []]

        with cls._style_cache_lock:
            cls._style_cache[key] = {
                'colors': colors,
                'styles': styles,
                'expire': now + 60 * 60
            }

        return colors, styles

    def get_styles(self, user_id: str) -> tuple[list[dict], list[dict]]:
        """
        Get styles

        :param credentials: the credentials
        :return: Tuple[list[dict[id, color]], list[dict[id, style]]
        """
        if not self.runtime.credentials.get('aippt_access_key') or not self.runtime.credentials.get('aippt_secret_key'):
            raise Exception('Please provide aippt credentials')

        return self._get_styles(credentials=self.runtime.credentials, user_id=user_id)
    
    def _get_suit(self, style_id: int, colour_id: int) -> int:
        """
        Get suit
        """
        headers = {
            'x-channel': '',
            'x-api-key': self.runtime.credentials['aippt_access_key'],
            'x-token': self._get_api_token(credentials=self.runtime.credentials, user_id='__dify_system__')
        }
        response = get(
            str(self._api_base_url / 'template_component' / 'suit' / 'search'),
            headers=headers,
            params={
                'style_id': style_id,
                'colour_id': colour_id,
                'page': 1,
                'page_size': 1
            }
        )

        if response.status_code != 200:
            raise Exception(f'Failed to connect to aippt: {response.text}')
        
        response = response.json()

        if response.get('code') != 0:
            raise Exception(f'Failed to connect to aippt: {response.get("msg")}')
        
        if len(response.get('data', {}).get('list') or []) > 0:
            return response.get('data', {}).get('list')[0].get('id')
        
        raise Exception('Failed to get suit, the suit does not exist, please check the style and color')
    
    def get_runtime_parameters(self) -> list[ToolParameter]:
        """
        Get runtime parameters

        Override this method to add runtime parameters to the tool.
        """
        try:
            colors, styles = self.get_styles(user_id='__dify_system__')
        except Exception as e:
            colors, styles = [
                {'id': -1, 'name': '__default__', 'en_name': '__default__'}
            ], [
                {'id': -1, 'name': '__default__', 'en_name': '__default__'}
            ]

        return [
            ToolParameter(
                name='color',
                label=I18nObject(zh_Hans='颜色', en_US='Color'),
                human_description=I18nObject(zh_Hans='颜色', en_US='Color'),
                type=ToolParameter.ToolParameterType.SELECT,
                form=ToolParameter.ToolParameterForm.FORM,
                required=False,
                default=colors[0]['id'],
                options=[
                    ToolParameterOption(
                        value=color['id'],
                        label=I18nObject(zh_Hans=color['name'], en_US=color['en_name'])
                    ) for color in colors
                ]
            ),
            ToolParameter(
                name='style',
                label=I18nObject(zh_Hans='风格', en_US='Style'),
                human_description=I18nObject(zh_Hans='风格', en_US='Style'),
                type=ToolParameter.ToolParameterType.SELECT,
                form=ToolParameter.ToolParameterForm.FORM,
                required=False,
                default=styles[0]['id'],
                options=[
                    ToolParameterOption(
                        value=style['id'],
                        label=I18nObject(zh_Hans=style['name'], en_US=style['name'])
                    ) for style in styles
                ]
            ),
        ]