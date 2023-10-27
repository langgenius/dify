# Desc: Metaclass for auto-registering subclasses of a class.

class AutoRegisterMeta(type):
    def __init__(cls, name, bases, attrs):
        super(AutoRegisterMeta, cls).__init__(name, bases, attrs)
        if not hasattr(cls, 'subclasses'):
            cls.subclasses = {}
        else:
            register_name = getattr(cls, 'register_name', name)
            cls.subclasses[register_name] = cls

class AutoRegisterBase(metaclass=AutoRegisterMeta):
    @classmethod
    def create_instance(cls, subclass_name, *args, **kwargs):
        if subclass_name not in cls.subclasses:
            raise ValueError(f"No register_name with name '{subclass_name}' found")
        return cls.subclasses[subclass_name](*args, **kwargs)
