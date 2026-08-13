from tests.unit_tests.utils.module_import_fixtures.parent_class import ParentClass


class LazyLoadChildClass(ParentClass):
    def __init__(self, name: str):
        super().__init__(name)
        self.name = name
