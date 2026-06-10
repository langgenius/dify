from models.base import DefaultFieldsMixin


class FooModel(DefaultFieldsMixin):
    def __init__(self, id: str):
        self.id = id


def test_repr():
    foo_model = FooModel(id="test-id")
    assert repr(foo_model) == "<FooModel(id=test-id)>"
