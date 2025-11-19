class MockColumn:
    def __eq__(self, other):
        return True
    def __ne__(self, other):
        return True
    def __lt__(self, other):
        return True
    def __gt__(self, other):
        return True
    def __le__(self, other):
        return True
    def __ge__(self, other):
        return True

def select(*args, **kwargs):
    return "mock_select"

def func(*args, **kwargs):
    return "mock_func"

def and_(*args, **kwargs):
    return "mock_and"

def or_(*args, **kwargs):
    return "mock_or"

def text(*args, **kwargs):
    return "mock_text"

def cast(*args, **kwargs):
    return MockColumn()

class Float:
    pass

class Engine:
    pass
