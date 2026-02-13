import operator

import charset_normalizer

_KOREAN_ENCODINGS = ("cp949", "ks_c_5601-1987")


def safe_decode(data: bytes | bytearray) -> str:
    """
    Safely decode bytes to string with intelligent encoding detection.

    Handles the common case where charset_normalizer misdetects Chinese (GBK)
    as Korean (cp949) by validating both candidates.
    """
    result = charset_normalizer.from_bytes(data)
    best = result.best()

    if not best:
        return data.decode("utf-8", errors="replace")

    if best.encoding.lower() in _KOREAN_ENCODINGS:
        # Evaluate ALL candidates orthogonally, then pick the best one
        # This avoids ordering issues where Chinese encodings "steal" Korean content
        candidates = [
            ("gb18030", _count_chinese_chars),
            ("gbk", _count_chinese_chars),
            ("gb2312", _count_chinese_chars),
            ("cp949", _count_korean_chars),
        ]

        results = []
        text_length = len(data)

        for encoding, counter in candidates:
            try:
                decoded = data.decode(encoding)
                score = counter(decoded)

                try:
                    reencoded = decoded.encode(encoding)
                    if reencoded != data:
                        score = 0
                except (UnicodeEncodeError, LookupError):
                    score = 0

                if encoding == "cp949" and score > 0:
                    score += 3

                results.append((score, encoding, decoded))
            except (UnicodeDecodeError, LookupError):
                continue

        if results:
            results.sort(key=operator.itemgetter(0), reverse=True)
            best_score, _, best_decoded = results[0]

            threshold = max(2, min(8, text_length // 10))
            if best_score >= threshold:
                return best_decoded

    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return str(best)


def _count_chinese_chars(text: str) -> int:
    """Count Chinese characters (CJK Unified Ideographs)."""
    return sum(1 for c in text if "\u4e00" <= c <= "\u9fff")


def _count_korean_chars(text: str) -> int:
    """Count Korean Hangul characters."""
    return sum(1 for c in text if "\uac00" <= c <= "\ud7af")
