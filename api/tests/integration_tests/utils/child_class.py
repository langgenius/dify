from tests.integration_tests.utils.parent_class import ParentClass


class ChildClass(ParentClass):
    def __init__(self, name: str):
        super().__init__(name)
        self.name = name
