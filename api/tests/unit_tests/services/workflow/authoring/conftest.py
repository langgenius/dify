from collections.abc import Mapping

from services.workflow.authoring.canvas_defaults import CanvasEdition

V2_ONLY_KEYS = {"recipients_spec", "message_template", "debug_mode"}


def written_canvas(edition: CanvasEdition, written: Mapping[str, object]) -> dict[str, object]:
    """The canvas data fill writes on a node as written: the edition's data without what it withholds from it."""
    withheld = edition.withheld(written)
    return {key: value for key, value in edition.data.items() if key not in withheld}
