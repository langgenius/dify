from pathlib import Path

STOPWORDS_FILE = Path(__file__).with_name("stopwords.txt")


def load_stopwords() -> set[str]:
    if not STOPWORDS_FILE.exists():
        raise FileNotFoundError(f"Stopwords file not found: {STOPWORDS_FILE}")
    stopwords = set(STOPWORDS_FILE.read_text(encoding="utf-8").splitlines())
    stopwords.add("\n")
    return stopwords


STOPWORDS: set[str] = load_stopwords()
