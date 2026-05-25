from flask_restx import Namespace

app_ns = Namespace("app", description="App management API operations", path="/")
