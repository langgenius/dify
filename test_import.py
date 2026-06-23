try:
    import api.services.model_provider_service

    print("Import successful")
except Exception as e:
    print(f"Error: {e}")
    import traceback

    traceback.print_exc()
