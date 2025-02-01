from dify_app import DifyApp


def init_app(app: DifyApp):

    from flasgger import Swagger

    app.config['SWAGGER'] = {
        'title': 'API Docs',
        'uiversion': 3
    }

    Swagger(app)
