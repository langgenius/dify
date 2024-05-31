SPECIAL_TOKENS = ["<sos>", "<eos>", "<pad>", "<unk>", "<empty>", "<sep>"]
TASK_TOKENS = ["[table]", "[html]", "[cell]", "[bbox]", "[cell+bbox]"]
RESERVED_TOKENS = [
    f"reserved {i+1}" for i in range(20 - len(SPECIAL_TOKENS) - len(TASK_TOKENS))
]
CELL_NUM_TOKENS = [f"{i+1}-cell(s)" for i in range(100)]
BBOX_TOKENS = [f"bbox-{i}" for i in range(880)]

HTML_TOKENS = [
    "<td></td>",
    "<td>[]</td>",
    "<td",
    "></td>",
    ">[]</td>",
    "<tr>",
    "</tr>",
    "<tbody>",
    "</tbody>",
    "<thead>",
    "</thead>",
    ' rowspan="2"',
    ' rowspan="3"',
    ' rowspan="4"',
    ' rowspan="5"',
    ' rowspan="6"',
    ' rowspan="7"',
    ' rowspan="8"',
    ' rowspan="9"',
    ' rowspan="10"',
    ' rowspan="11"',
    ' rowspan="12"',
    ' rowspan="13"',
    ' rowspan="14"',
    ' rowspan="15"',
    ' rowspan="16"',
    ' rowspan="17"',
    ' rowspan="18"',
    ' rowspan="19"',
    ' colspan="2"',
    ' colspan="3"',
    ' colspan="4"',
    ' colspan="5"',
    ' colspan="6"',
    ' colspan="7"',
    ' colspan="8"',
    ' colspan="9"',
    ' colspan="10"',
    ' colspan="11"',
    ' colspan="12"',
    ' colspan="13"',
    ' colspan="14"',
    ' colspan="15"',
    ' colspan="16"',
    ' colspan="17"',
    ' colspan="18"',
    ' colspan="19"',
    ' colspan="25"',
]

CELL_SPECIAL = ["<b>", "</b>", "<i>", "</i>", "<sup>", "</sup>", "<sub>", "</sub>"]


VALID_HTML_TOKEN = ["<eos>"] + HTML_TOKENS
INVALID_CELL_TOKEN = (
    ["<sos>", "<pad>", "<empty>", "<sep>"] + TASK_TOKENS + RESERVED_TOKENS
)
VALID_BBOX_TOKEN = [
    "<eos>"
] + BBOX_TOKENS  # image size will be addressed after instantiation
