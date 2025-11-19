from pydantic import BaseModel

class Variable(BaseModel):
    pass

class IntegerVariable(Variable):
    pass

class ArrayAnyVariable(Variable):
    pass

class RAGPipelineVariableInput(BaseModel):
    pass

class VariableUnion(BaseModel):
    pass
