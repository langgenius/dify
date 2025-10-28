from models.base import ModelMixin


class FooModel(ModelMixin):
    def __init__(self, id: str):
        self.id = id


def test_repr():
    foo_model = FooModel(id="test-id")
    assert repr(foo_model) == "<FooModel(id=test-id)>"
