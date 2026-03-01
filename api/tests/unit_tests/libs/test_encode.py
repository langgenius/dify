from libs.encode import safe_decode


class TestSafeDecode:
    """Test cases for safe_decode function covering multiple languages and encodings."""

    def test_decode_chinese_gbk(self):
        """Test decoding Chinese text encoded in GBK."""
        chinese_text = "这是测试中文内容，包含 GBK 编码。测试编码检测功能。"
        gbk_bytes = chinese_text.encode("gbk")
        decoded = safe_decode(gbk_bytes)
        assert decoded == chinese_text
        # Verify it contains Chinese characters
        assert any("\u4e00" <= c <= "\u9fff" for c in decoded)

    def test_decode_chinese_gb18030(self):
        """Test decoding Chinese text encoded in GB18030."""
        chinese_text = "测试GB18030编码，支持更多汉字"
        gb18030_bytes = chinese_text.encode("gb18030")
        decoded = safe_decode(gb18030_bytes)
        assert decoded == chinese_text
        # Verify it contains Chinese characters
        assert any("\u4e00" <= c <= "\u9fff" for c in decoded)

    def test_decode_chinese_utf8(self):
        """Test decoding Chinese text encoded in UTF-8."""
        chinese_text = "这是UTF-8编码的中文内容"
        utf8_bytes = chinese_text.encode("utf-8")
        decoded = safe_decode(utf8_bytes)
        assert decoded == chinese_text
        # Verify it contains Chinese characters
        assert any("\u4e00" <= c <= "\u9fff" for c in decoded)

    def test_decode_korean_cp949(self):
        """Test decoding Korean text encoded in CP949."""
        korean_text = "안녕하세요, 이것은 한국어 테스트입니다. CP949 인코딩을 테스트합니다."
        try:
            cp949_bytes = korean_text.encode("cp949")
        except LookupError:
            # Fallback to euc_kr if cp949 is not available
            cp949_bytes = korean_text.encode("euc_kr")
        decoded = safe_decode(cp949_bytes)
        assert decoded == korean_text
        # Verify it contains Korean Hangul characters
        assert any("\uac00" <= c <= "\ud7af" for c in decoded)

    def test_decode_japanese_shift_jis(self):
        """Test decoding Japanese text encoded in Shift_JIS."""
        japanese_text = "こんにちは、これは日本語のテストです。Shift_JISエンコーディングをテストします。"
        shift_jis_bytes = japanese_text.encode("shift_jis")
        decoded = safe_decode(shift_jis_bytes)
        assert decoded == japanese_text
        # Verify it contains Japanese characters
        assert any("\u3040" <= c <= "\u30ff" for c in decoded)  # Hiragana/Katakana

    def test_decode_japanese_utf8(self):
        """Test decoding Japanese text encoded in UTF-8."""
        japanese_text = "こんにちは世界"
        utf8_bytes = japanese_text.encode("utf-8")
        decoded = safe_decode(utf8_bytes)
        assert decoded == japanese_text
        # Verify it contains Japanese characters
        assert any("\u3040" <= c <= "\u30ff" for c in decoded)

    def test_decode_english_utf8(self):
        """Test decoding English text encoded in UTF-8."""
        english_text = "Hello, this is a test of English text encoding."
        utf8_bytes = english_text.encode("utf-8")
        decoded = safe_decode(utf8_bytes)
        assert decoded == english_text

    def test_decode_english_latin1(self):
        """Test decoding English text encoded in Latin-1."""
        english_text = "Hello, this is a test."
        latin1_bytes = english_text.encode("latin-1")
        decoded = safe_decode(latin1_bytes)
        assert decoded == english_text

    def test_decode_latin_extended(self):
        """Test decoding Latin extended characters (Spanish, French, etc.)."""
        # Spanish with accents
        spanish_text = "Hola, esta es una prueba en español. ¿Cómo estás?"
        utf8_bytes = spanish_text.encode("utf-8")
        decoded = safe_decode(utf8_bytes)
        assert decoded == spanish_text

        # French with accents
        french_text = "Bonjour, c'est un test en français. Ça va?"
        utf8_bytes = french_text.encode("utf-8")
        decoded = safe_decode(utf8_bytes)
        assert decoded == french_text

    def test_decode_russian_utf8(self):
        """Test decoding Russian text (Cyrillic) encoded in UTF-8."""
        russian_text = "Привет, это тест на русском языке."
        utf8_bytes = russian_text.encode("utf-8")
        decoded = safe_decode(utf8_bytes)
        assert decoded == russian_text
        # Verify it contains Cyrillic characters
        assert any("\u0400" <= c <= "\u04ff" for c in decoded)

    def test_decode_arabic_utf8(self):
        """Test decoding Arabic text encoded in UTF-8."""
        arabic_text = "مرحبا، هذا اختبار باللغة العربية."
        utf8_bytes = arabic_text.encode("utf-8")
        decoded = safe_decode(utf8_bytes)
        assert decoded == arabic_text
        # Verify it contains Arabic characters
        assert any("\u0600" <= c <= "\u06ff" for c in decoded)

    def test_decode_thai_utf8(self):
        """Test decoding Thai text encoded in UTF-8."""
        thai_text = "สวัสดี นี่คือการทดสอบภาษาไทย"
        utf8_bytes = thai_text.encode("utf-8")
        decoded = safe_decode(utf8_bytes)
        assert decoded == thai_text
        # Verify it contains Thai characters
        assert any("\u0e00" <= c <= "\u0e7f" for c in decoded)

    def test_decode_mixed_content(self):
        """Test decoding mixed language content (English + Chinese)."""
        mixed_text = "Hello 你好 Welcome 欢迎"
        utf8_bytes = mixed_text.encode("utf-8")
        decoded = safe_decode(utf8_bytes)
        assert decoded == mixed_text

    def test_decode_empty_bytes(self):
        """Test decoding empty bytes."""
        decoded = safe_decode(b"")
        assert decoded == ""

    def test_decode_ascii_only(self):
        """Test decoding ASCII-only text."""
        ascii_text = "Hello World! 12345"
        utf8_bytes = ascii_text.encode("utf-8")
        decoded = safe_decode(utf8_bytes)
        assert decoded == ascii_text

    def test_decode_big5_traditional_chinese(self):
        """Test decoding Traditional Chinese encoded in Big5."""
        traditional_text = "這是繁體中文測試，使用Big5編碼"
        big5_bytes = traditional_text.encode("big5")
        decoded = safe_decode(big5_bytes)
        assert decoded == traditional_text
        # Verify it contains Chinese characters
        assert any("\u4e00" <= c <= "\u9fff" for c in decoded)

    def test_decode_with_special_characters(self):
        """Test decoding text with special characters and punctuation."""
        text_with_special = "测试特殊字符：!@#$%^&*()_+-=[]{}|;':\",./<>?"
        utf8_bytes = text_with_special.encode("utf-8")
        decoded = safe_decode(utf8_bytes)
        assert decoded == text_with_special
