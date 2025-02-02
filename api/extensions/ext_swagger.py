from dify_app import DifyApp


def init_app(app: DifyApp):

    from flasgger import Swagger

    app.config['SWAGGER'] = {
        'title': 'API Docs',
        'uiversion': 3,
        'securityDefinitions': {
            'JWT': {
                'type': 'apiKey',
                'name': 'access-token',  # name of the cookie
                'in': 'header',  # specify that auth is in cookie
                'description': 'JWT Authorization cookie'
            }
        }
    }

    Swagger(app)
