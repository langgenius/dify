import logging
from typing import Literal

from PIL import Image  # type: ignore

Size = tuple[int, int]
BBox = tuple[float, float, float, float]


###################
### IMAGE UTILS ###
###################


def crop_img_with_padding(
        image: Image.Image, bbox: BBox, padding_pct: float = 0
) -> Image.Image:
    """
    Adds whitespace outside the image. Sometimes help algorithms.
    """
    if padding_pct < 0:
        raise ValueError("Padding percentage must be non-negative")
    if padding_pct >= 1:
        raise ValueError("Padding percentage must be less than 1")

    left, top, right, bottom = map(int, bbox)

    if not (0 <= left < right <= image.width) or not (
            0 <= top < bottom <= image.height
    ):
        raise ValueError("Bounding box is out of the image boundaries")

    try:
        cropped_image = image.crop((left, top, right, bottom))

        width = right - left
        height = bottom - top
        padding_x = int(width * padding_pct)
        padding_y = int(height * padding_pct)

        new_width = width + 2 * padding_x
        new_height = height + 2 * padding_y

        padded_image = Image.new("RGB", (new_width, new_height), color="white")
        padded_image.paste(cropped_image, (padding_x, padding_y))

        return padded_image

    except Exception as e:
        raise ValueError(f"Failed to crop the image: {e}")


def doc_to_imgs(doc) -> list[Image.Image]:
    images = []
    try:
        if not doc.is_pdf:
            raise ValueError("The document is not in PDF format.")
        if doc.needs_pass:
            raise ValueError("The PDF document is password protected.")
        page_numbers = list(range(doc.page_count))

        for n in page_numbers:
            page = doc[n]
            pix = page.get_pixmap()
            image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            images.append(image)

    except ValueError as e:
        logging.error(f"ValueError: {e}")
    except IndexError as e:
        logging.error(f"Page index out of range: {e}")
    except Exception as e:
        logging.error(f"An error occurred while reading the PDF: {e}")

    return images


def display_cells_on_img(
        image: Image.Image,
        cells,
        show_cell_types: Literal["all", "headers", "rows", "columns"] = "all",
        use_blank_image: bool = False,
        min_cell_confidence: float = 0.95,
) -> None:
    """
    Used for debugging to visualize the detected cells on the cropped table image.
    """
    try:
        from IPython.display import display  # type: ignore
        from PIL import ImageDraw  # type: ignore
    except ImportError:
        logging.error(
            "IPython or PIL is not installed to display cells on the image. Skipping"
        )
        return

    cropped_table_visualized = image.copy()
    if use_blank_image:
        cropped_table_visualized = Image.new("RGB", image.size, color="white")
    draw = ImageDraw.Draw(cropped_table_visualized)

    for cell in cells:
        if cell.confidence < min_cell_confidence:
            continue

        if show_cell_types == "headers" and not cell.is_header:
            continue
        elif show_cell_types == "rows" and not cell.is_row:
            continue
        elif show_cell_types == "columns" and not cell.is_column:
            continue

        draw.rectangle(cell.bbox, outline="red")

    display(cropped_table_visualized)


def convert_img_cords_to_pdf_cords(
        bbox: BBox,
        page_size: Size,
        image_size: Size,
) -> BBox:
    scale_x = page_size[0] / image_size[0]
    scale_y = page_size[1] / image_size[1]
    return (
        bbox[0] * scale_x,
        bbox[1] * scale_y,
        bbox[2] * scale_x,
        bbox[3] * scale_y,
    )


def convert_croppped_cords_to_full_img_cords(
        padding_pct: float,
        cropped_image_size: Size,
        table_bbox: BBox,
        bbox: BBox,
) -> BBox:
    # Calculate the padding added around the cropped image
    cropped_width, cropped_height = cropped_image_size
    width_without_padding = cropped_width / (1 + 2 * padding_pct)
    height_without_padding = cropped_height / (1 + 2 * padding_pct)

    padding_x = (cropped_width - width_without_padding) / 2
    padding_y = (cropped_height - height_without_padding) / 2

    left, top, right, bottom = table_bbox

    # Remove padding from the detection bbox
    left_adj = left - padding_x
    top_adj = top - padding_y
    right_adj = right - padding_x
    bottom_adj = bottom - padding_y

    # Add the original bbox's top-left corner to map back to original image coordinates
    orig_left, orig_top, _, _ = bbox
    left_adj += orig_left
    top_adj += orig_top
    right_adj += orig_left
    bottom_adj += orig_top

    return (left_adj, top_adj, right_adj, bottom_adj)


def adjust_bbox_with_padding(
        bbox: tuple[float, float, float, float],
        page_width: float,
        page_height: float,
        padding_pct: float,
) -> tuple[float, float, float, float]:
    """
    Adjusts the bounding box to include padding based on a percentage of its size.

    :param bbox: The original bounding box (x0, y0, x1, y1).
    :param page_width: The width of the page to ensure the padded bbox does not exceed its bounds.
    :param page_height: The height of the page to ensure the padded bbox does not exceed its bounds.
    :param padding_pct: The percentage of padding to add to each side of the bounding box.
    :return: A new bounding box adjusted for padding.
    """
    x0, y0, x1, y1 = bbox
    # Calculate the width and height of the original bounding box
    bbox_width = x1 - x0
    bbox_height = y1 - y0

    # Calculate padding in pixels for each dimension
    padding_x = bbox_width * padding_pct
    padding_y = bbox_height * padding_pct

    # Adjust the bounding box coordinates with padding
    padded_x0 = max(x0 - padding_x, 0)  # Ensure x0 is not less than 0
    padded_y0 = max(y0 - padding_y, 0)  # Ensure y0 is not less than 0
    padded_x1 = min(x1 + padding_x, page_width)  # Ensure x1 does not exceed page width
    padded_y1 = min(
        y1 + padding_y, page_height
    )  # Ensure y1 does not exceed page height

    return padded_x0, padded_y0, padded_x1, padded_y1
