from app import create_app

app = create_app()
print(app.url_map)
