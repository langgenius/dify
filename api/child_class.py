from tests.integration_tests.utils.parent_class import ParentClass


class ChildClass(ParentClass):
    """Test child class for module import helper tests"""

    def __init__(self, name):
        super().__init__(name)

    def get_name(self):
        return f"Child: {self.name}"
