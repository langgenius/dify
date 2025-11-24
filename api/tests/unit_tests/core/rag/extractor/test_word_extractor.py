"""Primarily used for testing merged cell scenarios"""

from docx import Document

from core.rag.extractor.word_extractor import WordExtractor


def _generate_table_with_merged_cells():
    doc = Document()

    """
    The table looks like this:
    +-----+-----+-----+
    | 1-1 & 1-2 | 1-3 |
    +-----+-----+-----+
    | 2-1 | 2-2 | 2-3 |
    |  &  |-----+-----+
    | 3-1 | 3-2 | 3-3 |
    +-----+-----+-----+
    """
    table = doc.add_table(rows=3, cols=3)
    table.style = "Table Grid"

    for i in range(3):
        for j in range(3):
            cell = table.cell(i, j)
            cell.text = f"{i + 1}-{j + 1}"

    # Merge cells
    cell_0_0 = table.cell(0, 0)
    cell_0_1 = table.cell(0, 1)
    merged_cell_1 = cell_0_0.merge(cell_0_1)
    merged_cell_1.text = "1-1 & 1-2"

    cell_1_0 = table.cell(1, 0)
    cell_2_0 = table.cell(2, 0)
    merged_cell_2 = cell_1_0.merge(cell_2_0)
    merged_cell_2.text = "2-1 & 3-1"

    ground_truth = [["1-1 & 1-2", "", "1-3"], ["2-1 & 3-1", "2-2", "2-3"], ["2-1 & 3-1", "3-2", "3-3"]]

    return doc.tables[0], ground_truth


def test_parse_row():
    table, gt = _generate_table_with_merged_cells()
    extractor = object.__new__(WordExtractor)
    for idx, row in enumerate(table.rows):
        assert extractor._parse_row(row, {}, 3) == gt[idx]
