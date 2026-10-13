from types import FunctionType

from controllers.web.flask_admission import web_anonymous_admission
from enums import DeploymentEdition


def _wrapper_chain(view: object) -> list[str]:
    """The defining function of each layer; ``functools.wraps`` copies ``__qualname__`` but not the code."""
    chain: list[str] = []
    current: object = view
    while isinstance(current, FunctionType):
        chain.append(current.__code__.co_qualname)
        current = current.__dict__.get("__wrapped__")
    return chain


def test_edition_gate_wraps_the_admitted_view_so_guard_metadata_survives() -> None:
    def view(_self: object, _context: object) -> str:
        return "ok"

    admitted = web_anonymous_admission(editions=frozenset({DeploymentEdition.CLOUD}))(view)

    # The edition gate must wrap the setup-guarded view, not the bare one, or the
    # guard layers (and the Swagger docs they carry) drop out of the chain.
    assert any(name.startswith("setup_required") for name in _wrapper_chain(admitted))
