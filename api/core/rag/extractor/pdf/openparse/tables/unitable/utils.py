from typing import Optional

import tokenizers as tk  # type: ignore
import torch
import torch.nn.functional as F
from torch import Tensor

from .tokens import TASK_TOKENS

html_table_template = (
    lambda table: f"""<html>
        <head> <meta charset="UTF-8">
        <style>
        table, th, td {{
            border: 1px solid black;
            font-size: 10px;
        }}
        </style> </head>
        <body>
        <table frame="hsides" rules="groups" width="100%%">
            {table}
        </table> </body> </html>"""
)


def subsequent_mask(size: int, pad: int = 0):
    attn_shape = (size, size)
    output = torch.triu(torch.ones(attn_shape), diagonal=1).to(torch.bool)
    if pad and pad > 0:
        output[:pad] = False
    return output


def pred_token_within_range(
        pred: Tensor,
        white_list: Optional[list[int]] = None,
        black_list: Optional[list[int]] = None,
) -> Tensor:
    assert white_list is None or black_list is None
    if white_list:
        total = set([i for i in range(pred.shape[-1])])
        black_list = list(total.difference(set(white_list)))

    pred[..., black_list] = -float("inf")

    return pred


def greedy_sampling(logits: Tensor):
    """logits should have shape [B, |V|]."""
    probs = F.softmax(logits, dim=-1)
    next_probs, next_tokens = probs.topk(1)

    return next_probs, next_tokens


def filter_tokens(seq: list[tuple[str, tuple[int, int]]]) -> list[str]:
    """
    Filters out tokens based on specific criteria:
    1. Removes tokens that are only whitespace.
    2. Excludes tokens that are a single character in the original string.

    Args:
        seq: A list of tuples, where each tuple contains a token and its span (start, end) in the original string.

    Returns:
        A list of filtered tokens.
    """
    filtered_seq = [
        token
        for token, span in seq
        if len(token.strip()) > 0 and (span[1] - span[0] != 1)
    ]
    return filtered_seq


def html_str_to_token_list(
        seq: str, splitter: Optional[tk.pre_tokenizers.PreTokenizer] = None
) -> list[str]:
    """Convert decode output (str) to a list of tokens for constructing html table code"""

    # Work for no <eos>
    seq = seq.split("<eos>")[0]
    token_black_list = ["<eos>", "<pad>"]  # Assuming TASK_TOKENS is defined elsewhere
    for token in token_black_list:
        seq = seq.replace(token, "")

    if splitter is None:
        splitter = tk.pre_tokenizers.Split(pattern=" ", behavior="contiguous")

    pre_tokenized_seq = splitter.pre_tokenize_str(seq)

    filtered_tokens = filter_tokens(pre_tokenized_seq)

    return filtered_tokens


def cell_str_to_token_list(seq: str) -> list[str]:
    """
    Used for cell content detection
    """
    seq = seq.split("<eos>")[0]

    token_black_list = ["<eos>", "<pad>", *TASK_TOKENS]
    for i in token_black_list:
        seq = seq.replace(i, "")

    seq = seq.strip()

    return seq


def build_table_from_html_and_cell(
        structure: list[str], content: Optional[list[str]] = None
) -> list[str]:
    assert structure is not None
    html_code = list()

    if content is None:
        content_copy = ["placeholder"] * len(structure)
    else:
        content_copy = content.copy()

    for tag in structure:
        if tag in ("<td>[]</td>", ">[]</td>"):
            if len(content_copy) == 0:
                continue
            cell = content_copy.pop(0)
            html_code.append(tag.replace("[]", cell))
        else:
            html_code.append(tag)

    return html_code


def bbox_str_to_token_list(
        seq: str, splitter: tk.pre_tokenizers.PreTokenizer = None
) -> list[tuple[int, int, int, int]]:
    """
    Note the out could be an empty list
    """

    seq = seq.split("<eos>")[0]

    token_black_list = ["<eos>", "<pad>", *TASK_TOKENS]
    for i in token_black_list:
        seq = seq.replace(i, "")

    if not splitter:
        splitter = tk.pre_tokenizers.Split(pattern=" ", behavior="removed")

    seq = splitter.pre_tokenize_str(seq)
    int_seq = [int(i[0].split("-")[1]) for i in seq]

    rounded_seq_len = len(int_seq) // 4 * 4
    out = [tuple(int_seq[i: i + 4]) for i in range(0, rounded_seq_len, 4)]
    return out
