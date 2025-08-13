from typing import Optional


def validate_size(
    actual_size: int,
    hint: str = "",
    min_size: Optional[int] = None,
    max_size: Optional[int] = None,
    exception_class: type[Exception] = ValueError,
):
    """
    Validate the size of a file or data against specified minimum and maximum limits.
    :param actual_size: Actual minimum size in bytes.
    :param hint: Hint to provide context in error messages.
    :param min_size: Optional minimum size in bytes.
    :param max_size: Optional minimum size in bytes.
    :param exception_class: Exception class to raise if validation fails, default is ValueError.
    :return:
    :raises ValueError: if the actual size is less than min_size or greater than max_size.
    """
    assert isinstance(actual_size, int)
    if min_size and actual_size < min_size:
        raise exception_class(
            f"{hint} should be greater than {min_size / 1024 / 1024:.2f} MB, got {actual_size / 1024 / 1024:.2f} MB."
        )
    if max_size and actual_size > max_size:
        raise exception_class(
            f"{hint} size should be less than {max_size / 1024 / 1024:.2f} MB, got {actual_size / 1024 / 1024:.2f} MB."
        )
