import pandas as pd


def test_pandas_csv(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    data = {"col1": [1, 2.2, -3.3, 4.0, 5], "col2": ["A", "B", "C", "D", "E"]}
    df1 = pd.DataFrame(data)

    # write to csv file
    csv_file_path = tmp_path.joinpath("example.csv")
    df1.to_csv(csv_file_path, index=False)

    # read from csv file
    df2 = pd.read_csv(csv_file_path, on_bad_lines="skip")
    assert df2[df2.columns[0]].to_list() == data["col1"]
    assert df2[df2.columns[1]].to_list() == data["col2"]


def test_pandas_xlsx(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    data = {"col1": [1, 2.2, -3.3, 4.0, 5], "col2": ["A", "B", "C", "D", "E"]}
    df1 = pd.DataFrame(data)

    # write to xlsx file
    xlsx_file_path = tmp_path.joinpath("example.xlsx")
    df1.to_excel(xlsx_file_path, index=False)

    # read from xlsx file
    df2 = pd.read_excel(xlsx_file_path)
    assert df2[df2.columns[0]].to_list() == data["col1"]
    assert df2[df2.columns[1]].to_list() == data["col2"]


def test_pandas_xlsx_with_sheets(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    data1 = {"col1": [1, 2, 3, 4, 5], "col2": ["A", "B", "C", "D", "E"]}
    df1 = pd.DataFrame(data1)

    data2 = {"col1": [6, 7, 8, 9, 10], "col2": ["F", "G", "H", "I", "J"]}
    df2 = pd.DataFrame(data2)

    # write to xlsx file with sheets
    xlsx_file_path = tmp_path.joinpath("example_with_sheets.xlsx")
    sheet1 = "Sheet1"
    sheet2 = "Sheet2"
    with pd.ExcelWriter(xlsx_file_path) as excel_writer:
        df1.to_excel(excel_writer, sheet_name=sheet1, index=False)
        df2.to_excel(excel_writer, sheet_name=sheet2, index=False)

    # read from xlsx file with sheets
    with pd.ExcelFile(xlsx_file_path) as excel_file:
        df1 = pd.read_excel(excel_file, sheet_name=sheet1)
        assert df1[df1.columns[0]].to_list() == data1["col1"]
        assert df1[df1.columns[1]].to_list() == data1["col2"]

        df2 = pd.read_excel(excel_file, sheet_name=sheet2)
        assert df2[df2.columns[0]].to_list() == data2["col1"]
        assert df2[df2.columns[1]].to_list() == data2["col2"]
