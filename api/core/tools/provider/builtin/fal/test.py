import requests

def test_authorization():
    """
    Test authorization by making a sample request using the provided API key.
    """
    url = "https://fal.run/fal-ai/flux/dev"
    api_key = "94667e0f-999a-4648-8b2a-64c42a62859f:816d58e70aea2a8283c1a299152ad56c"  # Replace with your actual FAL API key

    headers = {
        "Authorization": f"Key {api_key}",  # Using 'Key' as the scheme
        "Content-Type": "application/json",
    }
    data = {
        "prompt": "Cat"
    }

    response = requests.post(url, json=data, headers=headers)
    print(response.json())

    if response.status_code == 200:
        print("Authorization successful.")
        print("Response:", response.json())
    elif response.status_code == 401:
        print("Authorization failed: Invalid API key.")
    else:
        print(f"Authorization failed: {response.status_code} {response.reason}")
        print("Response:", response.text)

if __name__ == "__main__":
    test_authorization()
