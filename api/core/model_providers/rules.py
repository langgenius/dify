import json
import os


def init_provider_rules():
    # Get the absolute path of the subdirectory
    subdirectory_path = os.path.join(os.path.dirname(os.path.realpath(__file__)), 'rules')

    # Path to the providers.json file
    providers_json_file_path = os.path.join(subdirectory_path, '_providers.json')

    try:
        # Open the JSON file and read its content
        with open(providers_json_file_path, 'r') as json_file:
            data = json.load(json_file)
            # Store the content in a dictionary with the key as the file name (without extension)
            provider_names = data
    except FileNotFoundError:
        return "JSON file not found or path error"
    except json.JSONDecodeError:
        return "JSON file decoding error"

    # Dictionary to store the content of all JSON files
    json_data = {}

    try:
        # Loop through all files in the directory
        for provider_name in provider_names:
            filename = provider_name + '.json'

            # Path to each JSON file
            json_file_path = os.path.join(subdirectory_path, filename)

            # Open each JSON file and read its content
            with open(json_file_path, 'r') as json_file:
                data = json.load(json_file)
                # Store the content in the dictionary with the key as the file name (without extension)
                json_data[os.path.splitext(filename)[0]] = data

        return json_data
    except FileNotFoundError:
        return "JSON file not found or path error"
    except json.JSONDecodeError:
        return "JSON file decoding error"


provider_rules = init_provider_rules()
