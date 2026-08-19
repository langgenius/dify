import pytest

from agenton.layers import LayerDeps
from agenton_collections.layers.plain import ObjectLayer, PromptLayer


class ObjectLayerDeps(LayerDeps):
    """Deps container used to exercise runtime dependency validation."""

    object_layer: ObjectLayer[str]  # pyright: ignore[reportUninitializedInstanceVariable]


def test_layer_deps_rejects_mismatched_runtime_layer_class() -> None:
    with pytest.raises(TypeError, match="should be of type 'ObjectLayer'"):
        ObjectLayerDeps(object_layer=PromptLayer())
