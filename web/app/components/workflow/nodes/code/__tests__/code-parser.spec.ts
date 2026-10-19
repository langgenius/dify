import { VarType } from '../../../types'
import { extractFunctionParams, extractReturnType } from '../code-parser'
import { CodeLanguage } from '../types'

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
    multiLineParams: `def main(
      param1: str,
      param2: int,
    ) -> dict:
      return {"result": param1}`,
    commentedOutSignature: `# Previous interface:
# def main(
#     old_arg: str,
# ):
def main(arg1: str, arg2: str) -> dict:
    return {"result": arg1 + arg2}`,
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
    destructuredParams: `function main({ param1, param2 }) {
      return { result: param1 }
    }`,
    multiLineParams: `function main(
      param1,
      param2,
    ) {
      return { result: param1 }
    }`,
    commentedOutSignature: `// Previous interface:
// function main(
//   oldArg,
// ) {
function main(arg1, arg2) {
  return { result: arg1 }
}`,
    blockCommentedSignature: `/*
function main(
  oldArg,
) {
*/
function main(arg1, arg2) {
  return { result: arg1 }
}`,
  },
}

describe('extractFunctionParams', () => {
  it.each([
    [
      'Python typed defaults',
      CodeLanguage.python3,
      'def main(arg1: str = "/*", arg2: str = "*/") -> dict:\n    return {"result": arg1 + arg2}',
    ],
    [
      'Python strings spanning the signature',
      CodeLanguage.python3,
      'OPEN = "/*"\ndef main(arg1: str, arg2: str):\n    return {"result": OPEN + arg1 + arg2 + "*/"}',
    ],
    [
      'Python triple-quoted strings',
      CodeLanguage.python3,
      'OPEN = """/*\n# text\n"""\ndef main(arg1: str, arg2: str):\n    return {"result": OPEN + arg1 + arg2 + "*/"}',
    ],
    [
      'JavaScript double-quoted strings',
      CodeLanguage.javascript,
      'const OPEN = "/*";\nfunction main({ arg1, arg2 }) {\n  return {result: OPEN + arg1 + arg2 + "*/"}\n}',
    ],
    [
      'JavaScript single-quoted strings',
      CodeLanguage.javascript,
      "const OPEN = '/*';\nfunction main({ arg1, arg2 }) {\n  return {result: OPEN + arg1 + arg2 + '*/'}\n}",
    ],
    [
      'JavaScript templates',
      CodeLanguage.javascript,
      'const OPEN = `/*\n// text\n`;\nfunction main({ arg1, arg2 }) {\n  return {result: `${OPEN}${arg1}${arg2}*/`}\n}',
    ],
    [
      'escaped JavaScript quotes before a real comment',
      CodeLanguage.javascript,
      String.raw`const TEXT = "escaped \" /*";
/* function main(oldArg) {} */
function main({ arg1, arg2 }) {
  return {result: TEXT + arg1 + arg2 + "*/"}
}`,
    ],
    [
      'escaped Python quotes before a real comment',
      CodeLanguage.python3,
      String.raw`TEXT = 'escaped \' /*'
# def main(oldArg):
def main(arg1: str, arg2: str):
    return {"result": TEXT + arg1 + arg2 + "*/"}`,
    ],
    [
      'JavaScript comments between tokens',
      CodeLanguage.javascript,
      'function/* interface */main({ arg1,/* input */arg2 }) {\n  return {result: arg1 + arg2}\n}',
    ],
    [
      'Python CRLF comments between parameters',
      CodeLanguage.python3,
      'def main(\r\n    arg1: str, # first input\r\n    arg2: str,\r\n):\r\n    return {"result": arg1 + arg2}',
    ],
  ] as const)('preserves input names with %s', (_description, language, code) => {
    expect(extractFunctionParams(code, language)).toEqual(['arg1', 'arg2'])
  })

  describe('Python3', () => {
    it('handles no parameters', () => {
      const result = extractFunctionParams(SAMPLE_CODES.python3.noParams, CodeLanguage.python3)
      expect(result).toEqual([])
    })

    it('extracts single parameter', () => {
      const result = extractFunctionParams(SAMPLE_CODES.python3.singleParam, CodeLanguage.python3)
      expect(result).toEqual(['param1'])
    })

    it('extracts multiple parameters', () => {
      const result = extractFunctionParams(
        SAMPLE_CODES.python3.multipleParams,
        CodeLanguage.python3,
      )
      expect(result).toEqual(['param1', 'param2', 'param3'])
    })

    it('handles type hints', () => {
      const result = extractFunctionParams(SAMPLE_CODES.python3.withTypes, CodeLanguage.python3)
      expect(result).toEqual(['param1', 'param2', 'param3'])
    })

    it('handles default values', () => {
      const result = extractFunctionParams(SAMPLE_CODES.python3.withDefaults, CodeLanguage.python3)
      expect(result).toEqual(['param1', 'param2'])
    })

    it('handles a multi-line parameter list', () => {
      const result = extractFunctionParams(
        SAMPLE_CODES.python3.multiLineParams,
        CodeLanguage.python3,
      )
      expect(result).toEqual(['param1', 'param2'])
    })

    it('ignores a commented-out signature', () => {
      const result = extractFunctionParams(
        SAMPLE_CODES.python3.commentedOutSignature,
        CodeLanguage.python3,
      )
      expect(result).toEqual(['arg1', 'arg2'])
    })
  })

  // JavaScript のテストケース
  describe('JavaScript', () => {
    it('handles no parameters', () => {
      const result = extractFunctionParams(
        SAMPLE_CODES.javascript.noParams,
        CodeLanguage.javascript,
      )
      expect(result).toEqual([])
    })

    it('extracts single parameter', () => {
      const result = extractFunctionParams(
        SAMPLE_CODES.javascript.singleParam,
        CodeLanguage.javascript,
      )
      expect(result).toEqual(['param1'])
    })

    it('extracts multiple parameters', () => {
      const result = extractFunctionParams(
        SAMPLE_CODES.javascript.multipleParams,
        CodeLanguage.javascript,
      )
      expect(result).toEqual(['param1', 'param2', 'param3'])
    })

    it('handles comments in code', () => {
      const result = extractFunctionParams(
        SAMPLE_CODES.javascript.withComments,
        CodeLanguage.javascript,
      )
      expect(result).toEqual(['param1', 'param2'])
    })

    it('handles whitespace', () => {
      const result = extractFunctionParams(
        SAMPLE_CODES.javascript.withSpaces,
        CodeLanguage.javascript,
      )
      expect(result).toEqual(['param1', 'param2'])
    })

    it('handles destructured parameters', () => {
      const result = extractFunctionParams(
        SAMPLE_CODES.javascript.destructuredParams,
        CodeLanguage.javascript,
      )
      expect(result).toEqual(['param1', 'param2'])
    })

    it('handles a multi-line parameter list', () => {
      const result = extractFunctionParams(
        SAMPLE_CODES.javascript.multiLineParams,
        CodeLanguage.javascript,
      )
      expect(result).toEqual(['param1', 'param2'])
    })

    it('ignores a commented-out signature', () => {
      const result = extractFunctionParams(
        SAMPLE_CODES.javascript.commentedOutSignature,
        CodeLanguage.javascript,
      )
      expect(result).toEqual(['arg1', 'arg2'])
    })

    it('ignores a block-commented signature', () => {
      const result = extractFunctionParams(
        SAMPLE_CODES.javascript.blockCommentedSignature,
        CodeLanguage.javascript,
      )
      expect(result).toEqual(['arg1', 'arg2'])
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
  // Python3 のテスト
  describe('Python3', () => {
    it('extracts single return value', () => {
      const result = extractReturnType(
        RETURN_TYPE_SAMPLES.python3.singleReturn,
        CodeLanguage.python3,
      )
      expect(result).toEqual({
        result: {
          type: VarType.string,
          children: null,
        },
      })
    })

    it('extracts multiple return values', () => {
      const result = extractReturnType(
        RETURN_TYPE_SAMPLES.python3.multipleReturns,
        CodeLanguage.python3,
      )
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

    it('returns empty object when no return statement', () => {
      const result = extractReturnType(RETURN_TYPE_SAMPLES.python3.noReturn, CodeLanguage.python3)
      expect(result).toEqual({})
    })

    it('handles complex return statement', () => {
      const result = extractReturnType(
        RETURN_TYPE_SAMPLES.python3.complexReturn,
        CodeLanguage.python3,
      )
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
    it('handles nested object structure', () => {
      const result = extractReturnType(
        RETURN_TYPE_SAMPLES.python3.nestedObject,
        CodeLanguage.python3,
      )
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

  // JavaScript のテスト
  describe('JavaScript', () => {
    it('extracts single return value', () => {
      const result = extractReturnType(
        RETURN_TYPE_SAMPLES.javascript.singleReturn,
        CodeLanguage.javascript,
      )
      expect(result).toEqual({
        result: {
          type: VarType.string,
          children: null,
        },
      })
    })

    it('extracts multiple return values', () => {
      const result = extractReturnType(
        RETURN_TYPE_SAMPLES.javascript.multipleReturns,
        CodeLanguage.javascript,
      )
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

    it('handles return with parentheses', () => {
      const result = extractReturnType(
        RETURN_TYPE_SAMPLES.javascript.withParentheses,
        CodeLanguage.javascript,
      )
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

    it('returns empty object when no return statement', () => {
      const result = extractReturnType(
        RETURN_TYPE_SAMPLES.javascript.noReturn,
        CodeLanguage.javascript,
      )
      expect(result).toEqual({})
    })

    it('handles quoted keys', () => {
      const result = extractReturnType(
        RETURN_TYPE_SAMPLES.javascript.withQuotes,
        CodeLanguage.javascript,
      )
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
    it('handles nested object structure', () => {
      const result = extractReturnType(
        RETURN_TYPE_SAMPLES.javascript.nestedObject,
        CodeLanguage.javascript,
      )
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
