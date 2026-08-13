from tests.unit_tests.utils.module_import_fixtures.parent_class import ParentClass


class ChildClass(ParentClass):
    def __init__(self, name: str):
        super().__init__(name)
        self.name = name
