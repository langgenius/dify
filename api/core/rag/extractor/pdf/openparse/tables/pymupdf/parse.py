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
    table_header = "| " + " | ".join(headers) + " |\n"
    table_header += "|---" * len(headers) + "|\n"
    markdown_result = []
    row_content = ''
    for row in rows:
        processed_row = [" " if cell in [None, ""] else cell.replace("\n", '') for cell in row]
        row_content += "| " + " | ".join(processed_row) + " | \n"
        if (len(row_content) > 500):
            markdown_result.append(table_header + row_content)
            row_content = ''
    return "\n\n".join(markdown_result)



def combine_header_and_table_bboxes(
        bbox1: tuple[float, float, float, float], bbox2: tuple[float, float, float, float]
) -> tuple[float, float, float, float]:
    x0 = min(bbox1[0], bbox2[0])
    y0 = min(bbox1[1], bbox2[1])
    x1 = max(bbox1[2], bbox2[2])
    y1 = max(bbox1[3], bbox2[3])

    return x0, y0, x1, y1
