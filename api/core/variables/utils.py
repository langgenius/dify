from collections.abc import Iterable, Sequence


def to_selector(node_id: str, name: str, paths: Iterable[str] = ()) -> Sequence[str]:
    selectors = [node_id, name]
    if paths:
        selectors.extend(paths)
    return selectors
