"""CSV sanitization utilities to prevent formula injection attacks."""

from typing import Any


class CSVSanitizer:
    """
    Sanitizer for CSV export to prevent formula injection attacks.

    This class provides methods to sanitize data before CSV export by escaping
    characters that could be interpreted as formulas by spreadsheet applications
    (Excel, LibreOffice, Google Sheets).

    Formula injection occurs when user-controlled data starting with special
    characters (=, +, -, @, tab, carriage return) is exported to CSV and opened
    in a spreadsheet application, potentially executing malicious commands.
    """

    # Characters that can start a formula in Excel/LibreOffice/Google Sheets
    FORMULA_CHARS = frozenset(("=", "+", "-", "@", "\t", "\r", "\n"))

    @classmethod
    def sanitize_value(cls, value: Any) -> str:
        """
        Sanitize a value for safe CSV export.

        Prefixes formula-initiating characters with a single quote to prevent
        Excel/LibreOffice/Google Sheets from treating them as formulas.

        Args:
            value: The value to sanitize (will be converted to string)

        Returns:
            Sanitized string safe for CSV export

        Examples:
            >>> CSVSanitizer.sanitize_value("=1+1")
            "'=1+1"
            >>> CSVSanitizer.sanitize_value("Hello World")
            "Hello World"
            >>> CSVSanitizer.sanitize_value(None)
            ""
        """
        if value is None:
            return ""

        # Convert to string
        str_value = str(value)

        # If empty, return as is
        if not str_value:
            return ""

        # Preserve the previous behaviour for values whose first character is
        # itself a formula initiator (e.g. tab/CR-prefixed whitespace-only
        # cells, which the existing tests treat as formula triggers).
        if str_value[0] in (cls.FORMULA_CHARS - {"\n"}):
            return f"'{str_value}"

        # Otherwise strip leading spaces/newlines and check the first
        # non-whitespace character. Spreadsheet applications ignore leading
        # whitespace, so a formula initiator hidden behind it still triggers
        # evaluation. Pure-whitespace values stay unchanged (no formula to run).
        stripped = str_value.lstrip(" \n")
        if not stripped:
            return str_value

        if stripped[0] in cls.FORMULA_CHARS:
            return f"'{str_value}"

        return str_value

    @classmethod
    def sanitize_dict(cls, data: dict[str, Any], fields_to_sanitize: list[str] | None = None) -> dict[str, Any]:
        """
        Sanitize specified fields in a dictionary.

        Args:
            data: Dictionary containing data to sanitize
            fields_to_sanitize: List of field names to sanitize.
                               If None, sanitizes all string fields.

        Returns:
            Dictionary with sanitized values (creates a shallow copy)

        Examples:
            >>> data = {"question": "=1+1", "answer": "+calc", "id": "123"}
            >>> CSVSanitizer.sanitize_dict(data, ["question", "answer"])
            {"question": "'=1+1", "answer": "'+calc", "id": "123"}
        """
        sanitized = data.copy()

        if fields_to_sanitize is None:
            # Sanitize all string fields
            fields_to_sanitize = [k for k, v in data.items() if isinstance(v, str)]

        for field in fields_to_sanitize:
            if field in sanitized:
                sanitized[field] = cls.sanitize_value(sanitized[field])

        return sanitized
