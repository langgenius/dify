import json
from collections import Counter


def output_to_html(headers: list[str], rows: list[list[str]]) -> str:
    html_output = '<table border="1">\n'

    html_output += "<tr>"

    for header in headers:
        html_output += f"<th>{header}</th>"
    html_output += "</tr>\n"

    for row in rows:
        html_output += "<tr>"
        for cell in row:
            html_output += f'<td>{cell or " "}</td>'
        html_output += "</tr>\n"

    html_output += "</table>"

    return html_output


def output_to_markdown(headers: list[str], rows: list[list[str]]) -> str:
    table_header = "\n| " + " | ".join(headers) + " |\n"
    table_header += "|---" * len(headers) + "|"
    markdown_result = [table_header]
    for row in rows:
        processed_row = [" " if cell in [None, ""] else cell.replace("\n", "") for cell in row]
        row_content = "| " + " | ".join(processed_row) + " |"
        markdown_result.append(row_content)
        # if (len(row_content) > 100):
        #     markdown_result.append(table_header + row_content)
        #     row_content = ''
    return "\n".join(markdown_result)+"\n"


def output_to_csv(headers: list[str], rows: list[list[str]]) -> str:
    headers = [" " if head in [None, ""] else head.replace("\n", "") for head in headers]
    csv_str = ",".join(headers) + "\n"
    for row in rows:
        cells = [" " if cell in [None, ""] else cell.replace("\n", "").replace("<br><br>", "\n") for cell in row]
        if Counter(headers) == Counter(cells):
            continue
        csv_str += ",".join(cells) + "\n"
    return csv_str


def output_to_json(headers: list[str], rows: list[list[str]]) -> str:
    out = []
    for row in rows:
        if Counter(headers) == Counter(row):
            continue
        ce = {}
        for index, cell in enumerate(row):
            head = headers[index].replace("\n", "")
            if head is None:
                continue
            if cell is None:
                ce[head] = cell
            else:
                value = cell.replace("\n", "")
                ce[head] = value
        out.append(ce)
    return json.dumps(out, ensure_ascii=False)


def combine_header_and_table_bboxes(
        bbox1: tuple[float, float, float, float], bbox2: tuple[float, float, float, float]
) -> tuple[float, float, float, float]:
    x0 = min(bbox1[0], bbox2[0])
    y0 = min(bbox1[1], bbox2[1])
    x1 = max(bbox1[2], bbox2[2])
    y1 = max(bbox1[3], bbox2[3])

    return x0, y0, x1, y1
