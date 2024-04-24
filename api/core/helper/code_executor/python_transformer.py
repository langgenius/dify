import json
import re
from base64 import b64encode

from core.helper.code_executor.template_transformer import TemplateTransformer

PYTHON_RUNNER = """# declare main function here
{{code}}

from json import loads, dumps
from base64 import b64decode

# execute main function, and return the result
# inputs is a dict, and it
inputs = b64decode('{{inputs}}').decode('utf-8')
output = main(**json.loads(inputs))

# convert output to json and print
output = dumps(output, indent=4)

result = f'''<<RESULT>>
{output}
<<RESULT>>'''

print(result)
"""

PYTHON_PRELOAD = """
# prepare general imports
import json
import datetime
import math
import random
import re
import string
import sys
import time
import traceback
import uuid
import os
import base64
import hashlib
import hmac
import binascii
import collections
import functools
import operator
import itertools
"""

class PythonTemplateTransformer(TemplateTransformer):
    @classmethod
    def transform_caller(cls, code: str, inputs: dict) -> tuple[str, str]:
        """
        Transform code to python runner
        :param code: code
        :param inputs: inputs
        :return:
        """
        
        # transform inputs to json string
        inputs_str = b64encode(json.dumps(inputs, ensure_ascii=False).encode()).decode('utf-8')

        # replace code and inputs
        runner = PYTHON_RUNNER.replace('{{code}}', code)
        runner = runner.replace('{{inputs}}', inputs_str)

        return runner, PYTHON_PRELOAD
    
    @classmethod
    def transform_response(cls, response: str) -> dict:
        """
        Transform response to dict
        :param response: response
        :return:
        """
        # extract result
        result = re.search(r'<<RESULT>>(.*?)<<RESULT>>', response, re.DOTALL)
        if not result:
            raise ValueError('Failed to parse result')
        result = result.group(1)
        return json.loads(result)
