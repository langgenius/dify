# from pathlib import Path

# import cchardet
# import chardet
# import pytest

# _TEST_DIR = Path(__file__).parent


# @pytest.fixture(scope="session")
# def test_data_small() -> bytes:
#     with open(_TEST_DIR / "test-data.txt", "rb") as fin:
#         b = fin.read()

#     return b


# @pytest.fixture(scope="session")
# def test_data_large() -> bytes:
#     with open(_TEST_DIR / "tiangolo-fastapi-8a5edab282632443.txt", "rb") as fin:
#         b = fin.read()

#     return b


# def test_chardet_detect(test_data_large):
#     encoding = chardet.detect(test_data_large)
#     assert encoding["encoding"] == "utf-8"


# def test_cchardet_detect(test_data_large):
#     encoding = cchardet.detect(test_data_large)
#     assert encoding["encoding"] == "utf-8"


# def test_benchmark_chardetect_small(benchmark, test_data_small):
#     chardet.detect(test_data_small)


# def test_benchmark_chardetect_large(benchmark, test_data_large):
#     chardet.detect(test_data_large)


# def test_benchmark_cchardet_small(benchmark, test_data_small):
#     cchardet.detect(test_data_small)


# def test_benchmark_cchardet_large(benchmark, test_data_large):
#     cchardet.detect(test_data_large)
