import re


def get_image_upload_file_ids(content):
    pattern = r"!\[image\]\((http?://.*?(file-preview|image-preview))\)"
    matches = re.findall(pattern, content)
    image_upload_file_ids = []
    for match in matches:
        if match[1] == "file-preview":
            content_pattern = r"files/([^/]+)/file-preview"
        else:
            content_pattern = r"files/([^/]+)/image-preview"
        content_match = re.search(content_pattern, match[0])
        if content_match:
            image_upload_file_id = content_match.group(1)
            image_upload_file_ids.append(image_upload_file_id)
    return image_upload_file_ids
