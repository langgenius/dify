from dify_app import DifyApp


def init_app(app: DifyApp):

    from flasgger import Swagger

    app.config['SWAGGER'] = {
        'title': 'API Docs',
        'uiversion': 3,
        'url_prefix': '/openapi',
        'specs_route': '/',
        'static_url_path': '/flasgger_static',
        'securityDefinitions': {
            'ApiKeyAuth': {
                'type': 'apiKey',
                'name': 'Authorization',
                'in': 'header',
                'description': 'API Key Authorization header using Bearer scheme. Example: "Bearer {token}"'
            }
        }
    }

    Swagger(app)
