import argparse
import os
from pathlib import Path
from urllib.request import urlretrieve


def download_weights(weight_url, destination):
    os.makedirs(destination, exist_ok=True)

    weight_name = os.path.basename(weight_url)
    weight_path = os.path.join(destination, weight_name)

    if not os.path.exists(weight_path):
        print("Downloading weights... This may take a while.")
        print(f"Downloading weights to {weight_path}...")
        urlretrieve(weight_url, weight_path)
        print("Download complete.")
    else:
        print(f"Weights already present at {weight_path}.")

    return weight_path


def download_unitable_weights():
    base_dir = Path(__file__).resolve().parent
    weights_dir = base_dir / "weights/unitable"

    urls = [
        "https://huggingface.co/poloclub/UniTable/resolve/main/unitable_large_structure.pt",
        "https://huggingface.co/poloclub/UniTable/resolve/main/unitable_large_bbox.pt",
        "https://huggingface.co/poloclub/UniTable/resolve/main/unitable_large_content.pt",
        "https://sergey-filimonov.nyc3.digitaloceanspaces.com/open-parse/weights/vocab_bbox.json",
        # need to move somewhere else
        "https://sergey-filimonov.nyc3.digitaloceanspaces.com/open-parse/weights/vocab_cell_6k.json",
        # need to move somewhere else
        "https://sergey-filimonov.nyc3.digitaloceanspaces.com/open-parse/weights/vocab_html.json",
        # need to move somewhere else
    ]

    for url in urls:
        download_weights(url, str(weights_dir))

    print("\033[92mAll weights have been successfully downloaded! 🎉✨\033[0m")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Download UniTable weights.")
    # You can add more arguments here if needed
    args = parser.parse_args()

    download_unitable_weights()
