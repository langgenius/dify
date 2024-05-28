from tests.integration_tests.utils.parent_class import ParentClass


class LazyLoadChildClass(ParentClass):
    def __init__(self, name: str):
        super().__init__(name)
        self.name = name
