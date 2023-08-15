import stripe


def init_app(app):
    if app.config.get('STRIPE_API_KEY'):
        stripe.api_key = app.config.get('STRIPE_API_KEY')
