import logging
import time
from typing import Any

import torch  # type: ignore
from PIL import Image  # type: ignore
from torchvision import transforms  # type: ignore
from transformers import (
    AutoModelForObjectDetection,  # type: ignore
    TableTransformerForObjectDetection,  # type: ignore
)

# type: ignore
from core.rag.extractor.pdf.openparse.config import config

from ..schemas import (
    BBox,
    Size,
)
from ..utils import (
    convert_croppped_cords_to_full_img_cords,
    convert_img_cords_to_pdf_cords,
    crop_img_with_padding,
    display_cells_on_img,
)
from .geometry import (
    calc_bbox_intersection,
)
from .schemas import (
    _Table,
    _TableCellModelOutput,
    _TableDataCell,
    _TableHeader,
    _TableHeaderCell,
    _TableModelOutput,
    _TableRow,
)

t0 = time.time()
device = config.get_device()


class MaxResize:
    def __init__(self, max_size=800):
        self.max_size = max_size

    def __call__(self, image):
        width, height = image.size
        current_max_size = max(width, height)
        scale = self.max_size / current_max_size
        resized_image = image.resize(
            (int(round(scale * width)), int(round(scale * height)))
        )

        return resized_image


detection_model = AutoModelForObjectDetection.from_pretrained(
    "microsoft/table-transformer-detection",
    revision="no_timm",
).to(device)

structure_model = TableTransformerForObjectDetection.from_pretrained(
    "microsoft/table-transformer-structure-recognition",
    revision="no_timm",
).to(device)

detection_transform = transforms.Compose(
    [
        MaxResize(800),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ]
)

structure_transform = transforms.Compose(
    [
        MaxResize(1000),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ]
)

logging.info(f"Models loaded successfully 🚀: {time.time() - t0:.2f}s")


##################################
### === ML TABLE DETECTION === ###
##################################

# Adapted from:
# https://github.com/NielsRogge/Transformers-Tutorials/blob/master/Table%20Transformer/Inference_with_Table_Transformer_(TATR)_for_parsing_tables.ipynb


def _box_cxcywh_to_xyxy(x: torch.Tensor) -> torch.Tensor:
    """
    Converts a bounding box format from center coordinates (cx, cy, width, height) to
    boundary coordinates (x_min, y_min, x_max, y_max).

    Parameters:
    - x: A tensor of shape (N, 4) representing N bounding boxes in cx, cy, w, h format.

    Returns:
    - A tensor of shape (N, 4) representing N bounding boxes in x_min, y_min, x_max, y_max format.
    """
    x_c, y_c, w, h = x.unbind(-1)
    b = [(x_c - 0.5 * w), (y_c - 0.5 * h), (x_c + 0.5 * w), (y_c + 0.5 * h)]
    return torch.stack(b, dim=1)


def _rescale_bboxes(out_bbox: torch.Tensor, size: Size) -> torch.Tensor:
    """
    Rescales bounding boxes to the original image size.

    Parameters:
    - out_bbox: A tensor of bounding boxes in normalized format (relative to current size).
    - size: The target size (width, height) as a tuple of integers.

    Returns:
    - A tensor of rescaled bounding boxes in the target size.
    """
    width, height = size
    boxes = _box_cxcywh_to_xyxy(out_bbox)
    boxes = boxes * torch.tensor([width, height, width, height], dtype=torch.float32)
    return boxes


def _outputs_to_objects(outputs: Any, img_size: Size, id2label: dict):
    m = outputs.logits.softmax(-1).max(-1)
    pred_labels = list(m.indices.detach().cpu().numpy())[0]
    pred_scores = list(m.values.detach().cpu().numpy())[0]
    pred_bboxes = outputs["pred_boxes"].detach().cpu()[0]
    pred_bboxes = [elem.tolist() for elem in _rescale_bboxes(pred_bboxes, img_size)]

    objects = []
    for label, score, bbox in zip(pred_labels, pred_scores, pred_bboxes):
        class_label = id2label[int(label)]
        if not class_label == "no object":
            objects.append(
                {
                    "label": class_label,
                    "score": float(score),
                    "bbox": [float(elem) for elem in bbox],
                }
            )

    return objects


def _cell_outputs_to_objs(
        outputs: Any, img_size: Size, id2label: dict
) -> list[_TableCellModelOutput]:
    clean_outputs = _outputs_to_objects(outputs, img_size, id2label)
    cells = []
    for cell in clean_outputs:
        cells.append(
            _TableCellModelOutput(
                label=cell["label"],
                confidence=cell["score"],
                bbox=cell["bbox"],
            )
        )
    return cells


def _table_outputs_to_objs(
        outputs: Any, img_size: Size, id2label: dict
) -> list[_TableModelOutput]:
    clean_outputs = _outputs_to_objects(outputs, img_size, id2label)
    tables = []
    for table in clean_outputs:
        tables.append(
            _TableModelOutput(
                label=table["label"],
                confidence=table["score"],
                bbox=table["bbox"],
            )
        )
    return tables


def find_table_bboxes(
        image: Image.Image, min_table_confidence: float
) -> list[_TableModelOutput]:
    pixel_values = detection_transform(image).unsqueeze(0).to(device)
    with torch.no_grad():
        outputs = detection_model(pixel_values)

    detection_id2label = {
        **detection_model.config.id2label,
        len(detection_model.config.id2label): "no object",
    }

    detected_tables = _table_outputs_to_objs(outputs, image.size, detection_id2label)

    tables = [t for t in detected_tables if t.confidence > min_table_confidence]

    return tables


####################################
### === MANIPULATING RESULTS === ###
####################################


def table_from_model_outputs(
        image: Image.Image,
        page_size: Size,
        table_bbox: BBox,
        table_cells: list[_TableCellModelOutput],
        min_cell_confidence: float,
) -> "_Table":
    headers = [
        cell
        for cell in table_cells
        if cell.is_header and cell.confidence > min_cell_confidence
    ]
    rows = [
        cell
        for cell in table_cells
        if cell.is_row and cell.confidence > min_cell_confidence
    ]
    cols = [
        cell
        for cell in table_cells
        if cell.is_column and cell.confidence > min_cell_confidence
    ]

    header_objs = _preprocess_header_cells(headers, cols, image.size, page_size)
    row_objs = _process_row_cells(rows, cols, header_objs, image.size, page_size)

    return _Table(bbox=table_bbox, headers=header_objs, rows=row_objs)


def _preprocess_header_cells(
        header_rows: list[_TableCellModelOutput],
        cols: list[_TableCellModelOutput],
        image_size: Size,
        page_size: Size,
) -> list[_TableHeader]:
    header_cells = []
    for header in header_rows:
        header_row_cells = []
        for col in cols:
            cell_bbox = calc_bbox_intersection(header.bbox, col.bbox, safety_margin=5)
            if cell_bbox:
                cell_bbox = convert_img_cords_to_pdf_cords(
                    cell_bbox, page_size, image_size
                )
                header_row_cells.append(
                    _TableHeaderCell(
                        bbox=cell_bbox,
                    )
                )
        header_cells.append(_TableHeader(cells=header_row_cells))
    return header_cells


def _process_row_cells(
        rows: list[_TableCellModelOutput],
        cols: list[_TableCellModelOutput],
        headers: list[_TableHeader],
        image_size: Size,
        page_size: Size,
) -> list[_TableRow]:
    """
    Process row cells by checking against header cells for overlaps and converting coordinates.
    """
    data_cells = []
    for row in rows:
        row_cells = []
        for col in cols:
            cell_bbox = calc_bbox_intersection(row.bbox, col.bbox, safety_margin=5)

            if cell_bbox:
                cell_bbox_pdf = convert_img_cords_to_pdf_cords(
                    cell_bbox, page_size, image_size
                )

                if not _is_overlapping_with_headers(cell_bbox_pdf, headers):
                    row_cells.append(
                        _TableDataCell(
                            bbox=cell_bbox_pdf,
                        )
                    )
        if row_cells:
            data_cells.append(_TableRow(cells=row_cells))
    return data_cells


def calculate_area(bbox: BBox) -> float:
    if bbox is None:
        return 0
    width = bbox[2] - bbox[0]
    height = bbox[3] - bbox[1]
    return width * height


def _is_overlapping_with_headers(
        cell_bbox: BBox, headers: list[_TableHeader], overlap_threshold: float = 0.9
) -> bool:
    """
    Check if a given cell's bounding box overlaps with any of the header cells' bounding boxes.
    If the overlap area is above the threshold percentage of the cell's area, return True.
    """
    cell_area = calculate_area(cell_bbox)

    for header in headers:
        for hcell in header.cells:
            intersection = calc_bbox_intersection(cell_bbox, hcell.bbox)
            if intersection:
                intersection_area = calculate_area(intersection)
                overlap_percentage = intersection_area / cell_area
                if overlap_percentage > overlap_threshold:
                    return True
    return False


def get_table_content(
        page_dims: Size,
        page_img: Image.Image,
        table_bbox: BBox,
        min_cell_confidence: float,
        verbose: bool = False,
) -> _Table:
    OFFSET = 0.05
    table_img = crop_img_with_padding(page_img, table_bbox, padding_pct=OFFSET)
    structure_id2label = {
        **structure_model.config.id2label,
        len(structure_model.config.id2label): "no object",
    }

    pixel_values_st = structure_transform(table_img).unsqueeze(0).to(device)
    with torch.no_grad():
        outputs_st = structure_model(pixel_values_st)

    cells = _cell_outputs_to_objs(outputs_st, table_img.size, structure_id2label)

    for cell in cells:
        cell.bbox = convert_croppped_cords_to_full_img_cords(
            padding_pct=OFFSET,
            cropped_image_size=table_img.size,
            table_bbox=cell.bbox,
            bbox=table_bbox,
        )

    if verbose:
        display_cells_on_img(
            page_img, cells, "all", min_cell_confidence=min_cell_confidence
        )

    return table_from_model_outputs(
        page_img, page_dims, table_bbox, cells, min_cell_confidence
    )
