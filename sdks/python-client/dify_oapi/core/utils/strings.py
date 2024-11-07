class Strings:
    @staticmethod
    def is_not_empty(s: str | None) -> bool:
        return not Strings.is_empty(s)

    @staticmethod
    def is_empty(s: str | None) -> bool:
        return s is None or len(s) == 0
