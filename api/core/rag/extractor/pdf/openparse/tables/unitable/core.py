import re
from collections.abc import Sequence
from typing import Optional

import torch  # type: ignore
from PIL import Image  # type: ignore
from torch import Tensor  # type: ignore
from torchvision import transforms  # type: ignore

from core.rag.extractor.pdf.openparse.config import config

from .tokens import INVALID_CELL_TOKEN, VALID_BBOX_TOKEN, VALID_HTML_TOKEN
from .unitable_model import (
    EncoderDecoder,
    bbox_model,
    bbox_vocab,
    cell_model,
    cell_vocab,
    structure_model,
    structure_vocab,
)
from .utils import (
    bbox_str_to_token_list,
    build_table_from_html_and_cell,  # cell-content-detection
    cell_str_to_token_list,  # cell-content-detection
    greedy_sampling,
    html_str_to_token_list,
    html_table_template,  # cell-content-detection
    pred_token_within_range,
    subsequent_mask,
)

Size = tuple[int, int]
BBox = tuple[int, int, int, int]

device = config.get_device()


def _image_to_tensor(image: Image, size: Size) -> Tensor:
    T = transforms.Compose(
        [
            transforms.Resize(size),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.86597056, 0.88463002, 0.87491087],
                std=[0.20686628, 0.18201602, 0.18485524],
            ),
        ]
    )
    image_tensor = T(image)
    image_tensor = image_tensor.to(device).unsqueeze(0)

    return image_tensor


def _rescale_bbox(
        bbox: list[BBox], src: Size, tgt: Size
) -> list[tuple[int, int, int, int]]:
    # Calculate scale ratios for width and height
    width_ratio, height_ratio = tgt[0] / src[0], tgt[1] / src[1]

    # Apply the scaling to each bounding box coordinate
    scaled_bbox = []
    for box in bbox:
        x_min, y_min, x_max, y_max = box
        scaled_box = (
            round(x_min * width_ratio),
            round(y_min * height_ratio),
            round(x_max * width_ratio),
            round(y_max * height_ratio),
        )
        scaled_bbox.append(scaled_box)

    return scaled_bbox


def _autoregressive_decode(
        model: EncoderDecoder,
        image: Tensor,
        prefix: Sequence[int],
        max_decode_len: int,
        eos_id: int,
        token_whitelist: Optional[list[int]] = None,
        token_blacklist: Optional[list[int]] = None,
) -> Tensor:
    model.eval()
    with torch.no_grad():
        memory = model.encode(image)
        context = (
            torch.tensor(prefix, dtype=torch.int32).repeat(image.shape[0], 1).to(device)
        )

    for _ in range(max_decode_len):
        eos_flag = [eos_id in k for k in context]
        if all(eos_flag):
            break

        with torch.no_grad():
            causal_mask = subsequent_mask(context.shape[1]).to(device)
            logits = model.decode(
                memory, context, tgt_mask=causal_mask, tgt_padding_mask=None  # type: ignore
            )
            logits = model.generator(logits)[:, -1, :]

        logits = pred_token_within_range(
            logits.detach(),
            white_list=token_whitelist,
            black_list=token_blacklist,
        )

        _, next_tokens = greedy_sampling(logits)
        context = torch.cat([context, next_tokens], dim=1)
    return context


def predict_html(image_tensor: Tensor) -> list[str]:
    """
    Predict HTML structure from the input image

    Note uses the global structure_model and structure_vocab
    """
    pred_tensor = _autoregressive_decode(
        model=structure_model,
        image=image_tensor,
        prefix=[structure_vocab.token_to_id("[html]")],
        max_decode_len=512,
        eos_id=structure_vocab.token_to_id("<eos>"),
        token_whitelist=[structure_vocab.token_to_id(i) for i in VALID_HTML_TOKEN],
        token_blacklist=None,
    )

    # Convert token id to token text
    pred_tensor = pred_tensor.detach().cpu().numpy()[0]
    token_str = structure_vocab.decode(pred_tensor, skip_special_tokens=False)
    token_list = html_str_to_token_list(token_str)
    return token_list


def predict_bboxes(image_tensor: Tensor, image_size: Size) -> list[BBox]:
    pred_tensor = _autoregressive_decode(
        model=bbox_model,
        image=image_tensor,
        prefix=[bbox_vocab.token_to_id("[bbox]")],
        max_decode_len=1024,
        eos_id=bbox_vocab.token_to_id("<eos>"),
        token_whitelist=[bbox_vocab.token_to_id(i) for i in VALID_BBOX_TOKEN[:449]],
        token_blacklist=None,
    )

    # Convert token id to token text
    pred_tensor = pred_tensor.detach().cpu().numpy()[0]
    token_str = bbox_vocab.decode(pred_tensor, skip_special_tokens=False)

    bbox_list = bbox_str_to_token_list(token_str)
    pred_bbox = _rescale_bbox(bbox_list, src=(448, 448), tgt=image_size)
    return pred_bbox


def predict_cells(
        image_tensor: Tensor, pred_bboxes: list[tuple[int, int, int, int]], image: Image
):
    # Cell image cropping and transformation
    image_tensor_lst = [
        _image_to_tensor(image.crop(bbox), size=(112, 448)) for bbox in pred_bboxes
    ]
    image_tensor_batch = torch.cat(image_tensor_lst, dim=0)

    # Inference
    pred_cell = _autoregressive_decode(
        model=cell_model,
        image=image_tensor_batch,
        prefix=[cell_vocab.token_to_id("[cell]")],
        max_decode_len=200,
        eos_id=cell_vocab.token_to_id("<eos>"),
        token_whitelist=None,
        token_blacklist=[cell_vocab.token_to_id(i) for i in INVALID_CELL_TOKEN],
    )

    # Convert token id to token text
    pred_cell = pred_cell.detach().cpu().numpy()
    pred_cell = cell_vocab.decode_batch(pred_cell, skip_special_tokens=False)
    token_list = [cell_str_to_token_list(i) for i in pred_cell]
    clean_token_list = [re.sub(r"(\d).\s+(\d)", r"\1.\2", i) for i in token_list]
    return clean_token_list


def table_img_to_html(table_image: Image) -> str:
    """
    Note this expects the image to already be cropped to the table
    """
    table_image = table_image.convert("RGB")
    image_tensor = _image_to_tensor(table_image, size=(448, 448))

    pred_html = predict_html(image_tensor)
    pred_bbox = predict_bboxes(image_tensor, image_size=table_image.size)
    pred_cell_lst = predict_cells(image_tensor, pred_bbox, table_image)

    table_str_lst = build_table_from_html_and_cell(pred_html, pred_cell_lst)
    table_str = "".join(table_str_lst)
    table_str = html_table_template(table_str)

    return table_str
