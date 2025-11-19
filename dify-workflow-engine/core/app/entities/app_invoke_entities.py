from enum import Enum

class InvokeFrom(Enum):
    DEBUGGER = "debugger"
    SERVICE_API = "service_api"
    WEB_APP = "web_app"
