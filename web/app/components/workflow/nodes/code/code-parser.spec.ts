import { VarType } from '../../types'
import { extractFunctionParams, extractReturnType } from './code-parser'
import { CodeLanguage } from './types'

const SAMPLE_CODES = {
  python3: {
    noParams: 'def main():',
    singleParam: 'def main(param1):',
    multipleParams: `def main(param1, param2, param3):
      return {"result": param1}`,
    withTypes: `def main(param1: str, param2: int, param3: List[str]):
      result = process_data(param1, param2)
      return {"output": result}`,
    withDefaults: `def main(param1: str = "default", param2: int = 0):
      return {"data": param1}`,
  },
  javascript: {
    noParams: 'function main() {',
    singleParam: 'function main(param1) {',
    multipleParams: `function main(param1, param2, param3) {
      return { result: param1 }
    }`,
    withComments: `// Main function
    function main(param1, param2) {
      // Process data
      return { output: process(param1, param2) }
    }`,
    withSpaces: 'function main(  param1  ,   param2  ) {',
  },
}

describe('extractFunctionParams', () => {
  describe('Python3', () => {
    test('handles no parameters', () => {
      const result = extractFunctionParams(SAMPLE_CODES.python3.noParams, CodeLanguage.python3)
      expect(result).toEqual([])
    })

    test('extracts single parameter', () => {
      const result = extractFunctionParams(SAMPLE_CODES.python3.singleParam, CodeLanguage.python3)
      expect(result).toEqual(['param1'])
    })

    test('extracts multiple parameters', () => {
      const result = extractFunctionParams(SAMPLE_CODES.python3.multipleParams, CodeLanguage.python3)
      expect(result).toEqual(['param1', 'param2', 'param3'])
    })

    test('handles type hints', () => {
      const result = extractFunctionParams(SAMPLE_CODES.python3.withTypes, CodeLanguage.python3)
      expect(result).toEqual(['param1', 'param2', 'param3'])
    })

    test('handles default values', () => {
      const result = extractFunctionParams(SAMPLE_CODES.python3.withDefaults, CodeLanguage.python3)
      expect(result).toEqual(['param1', 'param2'])
    })
  })

  // JavaScriptのテストケース
  describe('JavaScript', () => {
    test('handles no parameters', () => {
      const result = extractFunctionParams(SAMPLE_CODES.javascript.noParams, CodeLanguage.javascript)
      expect(result).toEqual([])
    })

    test('extracts single parameter', () => {
      const result = extractFunctionParams(SAMPLE_CODES.javascript.singleParam, CodeLanguage.javascript)
      expect(result).toEqual(['param1'])
    })

    test('extracts multiple parameters', () => {
      const result = extractFunctionParams(SAMPLE_CODES.javascript.multipleParams, CodeLanguage.javascript)
      expect(result).toEqual(['param1', 'param2', 'param3'])
    })

    test('handles comments in code', () => {
      const result = extractFunctionParams(SAMPLE_CODES.javascript.withComments, CodeLanguage.javascript)
      expect(result).toEqual(['param1', 'param2'])
    })

    test('handles whitespace', () => {
      const result = extractFunctionParams(SAMPLE_CODES.javascript.withSpaces, CodeLanguage.javascript)
      expect(result).toEqual(['param1', 'param2'])
    })
  })
})

const RETURN_TYPE_SAMPLES = {
  python3: {
    singleReturn: `
def main(param1):
    return {"result": "value"}`,

    multipleReturns: `
def main(param1, param2):
    return {"result": "value", "status": "success"}`,

    noReturn: `
def main():
    print("Hello")`,

    complexReturn: `
def main():
    data = process()
    return {"result": data, "count": 42, "messages": ["hello"]}`,
    nestedObject: `
    def main(name, age, city):
        return {
            'personal_info': {
                'name': name,
                'age': age,
                'city': city
            },
            'timestamp': int(time.time()),
            'status': 'active'
        }`,
  },

  javascript: {
    singleReturn: `
function main(param1) {
    return { result: "value" }
}`,

    multipleReturns: `
function main(param1) {
    return { result: "value", status: "success" }
}`,

    withParentheses: `
function main() {
    return ({ result: "value", status: "success" })
}`,

    noReturn: `
function main() {
    console.log("Hello")
}`,

    withQuotes: `
function main() {
    return { "result": 'value', 'status': "success" }
}`,
    nestedObject: `
function main(name, age, city) {
    return {
        personal_info: {
            name: name,
            age: age,
            city: city
        },
        timestamp: Date.now(),
        status: 'active'
    }
}`,
    withJSDoc: `
/**
 * Creates a user profile with personal information and metadata
 * @param {string} name - The user's name
 * @param {number} age - The user's age
 * @param {string} city - The user's city of residence
 * @returns {Object} An object containing the user profile
 */
function main(name, age, city) {
    return {
        result: {
            personal_info: {
                name: name,
                age: age,
                city: city
            },
            timestamp: Date.now(),
            status: 'active'
        }
    };
}`,

  },
}

describe('extractReturnType', () => {
  // Python3のテスト
  describe('Python3', () => {
    test('extracts single return value', () => {
      const result = extractReturnType(RETURN_TYPE_SAMPLES.python3.singleReturn, CodeLanguage.python3)
      expect(result).toEqual({
        result: {
          type: VarType.string,
          children: null,
        },
      })
    })

    test('extracts multiple return values', () => {
      const result = extractReturnType(RETURN_TYPE_SAMPLES.python3.multipleReturns, CodeLanguage.python3)
      expect(result).toEqual({
        result: {
          type: VarType.string,
          children: null,
        },
        status: {
          type: VarType.string,
          children: null,
        },
      })
    })

    test('returns empty object when no return statement', () => {
      const result = extractReturnType(RETURN_TYPE_SAMPLES.python3.noReturn, CodeLanguage.python3)
      expect(result).toEqual({})
    })

    test('handles complex return statement', () => {
      const result = extractReturnType(RETURN_TYPE_SAMPLES.python3.complexReturn, CodeLanguage.python3)
      expect(result).toEqual({
        result: {
          type: VarType.string,
          children: null,
        },
        count: {
          type: VarType.string,
          children: null,
        },
        messages: {
          type: VarType.string,
          children: null,
        },
      })
    })
    test('handles nested object structure', () => {
      const result = extractReturnType(RETURN_TYPE_SAMPLES.python3.nestedObject, CodeLanguage.python3)
      expect(result).toEqual({
        personal_info: {
          type: VarType.string,
          children: null,
        },
        timestamp: {
          type: VarType.string,
          children: null,
        },
        status: {
          type: VarType.string,
          children: null,
        },
      })
    })
  })

  // JavaScriptのテスト
  describe('JavaScript', () => {
    test('extracts single return value', () => {
      const result = extractReturnType(RETURN_TYPE_SAMPLES.javascript.singleReturn, CodeLanguage.javascript)
      expect(result).toEqual({
        result: {
          type: VarType.string,
          children: null,
        },
      })
    })

    test('extracts multiple return values', () => {
      const result = extractReturnType(RETURN_TYPE_SAMPLES.javascript.multipleReturns, CodeLanguage.javascript)
      expect(result).toEqual({
        result: {
          type: VarType.string,
          children: null,
        },
        status: {
          type: VarType.string,
          children: null,
        },
      })
    })

    test('handles return with parentheses', () => {
      const result = extractReturnType(RETURN_TYPE_SAMPLES.javascript.withParentheses, CodeLanguage.javascript)
      expect(result).toEqual({
        result: {
          type: VarType.string,
          children: null,
        },
        status: {
          type: VarType.string,
          children: null,
        },
      })
    })

    test('returns empty object when no return statement', () => {
      const result = extractReturnType(RETURN_TYPE_SAMPLES.javascript.noReturn, CodeLanguage.javascript)
      expect(result).toEqual({})
    })

    test('handles quoted keys', () => {
      const result = extractReturnType(RETURN_TYPE_SAMPLES.javascript.withQuotes, CodeLanguage.javascript)
      expect(result).toEqual({
        result: {
          type: VarType.string,
          children: null,
        },
        status: {
          type: VarType.string,
          children: null,
        },
      })
    })
    test('handles nested object structure', () => {
      const result = extractReturnType(RETURN_TYPE_SAMPLES.javascript.nestedObject, CodeLanguage.javascript)
      expect(result).toEqual({
        personal_info: {
          type: VarType.string,
          children: null,
        },
        timestamp: {
          type: VarType.string,
          children: null,
        },
        status: {
          type: VarType.string,
          children: null,
        },
      })
    })
  })
})
