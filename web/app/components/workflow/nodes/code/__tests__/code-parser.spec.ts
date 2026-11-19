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
      'generic annotations',
      'def main(config: dict[str, str], label: str):\n    return {"config": config}',
      ['config', 'label'],
    ],
    [
      'string defaults',
      'def main(label: str = "one,two", count: int = 1):\n    return {"label": label}',
      ['label', 'count'],
    ],
    [
      'nested default calls',
      'def main(value: str = make_default("x,y"), other: str = ""):\n    return {"value": value}',
      ['value', 'other'],
    ],
    [
      'escaped quotes in string defaults',
      String.raw`def main(label: str = "one,\"two", count: int = 1):
    return {"label": label}`,
      ['label', 'count'],
    ],
    [
      'triple-quoted string defaults',
      'def main(label: str = """one,two""", count: int = 1):\n    return {"label": label}',
      ['label', 'count'],
    ],
    [
      'signatures inside Python docstrings',
      '"""Example:\ndef main(old_arg: str, wrong_arg: str):\n    pass\n"""\ndef main(config: dict[str, str]):\n    return {"config": config}',
      ['config'],
    ],
    [
      'closing parentheses inside strings',
      'def main(label: str = "close ) here", count: int = 1):\n    return {"label": label}',
      ['label', 'count'],
    ],
  ])(
    'splits parameters outside brackets and strings in Python %s',
    (_description, code, expected) => {
      expect(extractFunctionParams(code, CodeLanguage.python3)).toEqual(expected)
    },
  )

  it('splits JavaScript parameters outside template strings', () => {
    const code = 'function main({ label: label = `one,two`, count }) { return { label } }'
    expect(extractFunctionParams(code, CodeLanguage.javascript)).toEqual(['label', 'count'])
  })

  it.each([
    ['missing main signature', 'print("no main")'],
    ['unterminated main signature', 'def main(config: dict[str, str]'],
  ])('returns no parameters for a %s', (_description, code) => {
    expect(extractFunctionParams(code, CodeLanguage.python3)).toEqual([])
  })

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
      `const OPEN = \`/*
// text
\`;
function main({ arg1, arg2 }) {
  return {result: \`\${OPEN}\${arg1}\${arg2}*/\`}
}`,
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

  it.each([
    [CodeLanguage.python3, SAMPLE_CODES.python3.noParams, []],
    [CodeLanguage.python3, SAMPLE_CODES.python3.singleParam, ['param1']],
    [CodeLanguage.python3, SAMPLE_CODES.python3.multipleParams, ['param1', 'param2', 'param3']],
    [CodeLanguage.python3, SAMPLE_CODES.python3.withTypes, ['param1', 'param2', 'param3']],
    [CodeLanguage.python3, SAMPLE_CODES.python3.withDefaults, ['param1', 'param2']],
    [CodeLanguage.python3, SAMPLE_CODES.python3.multiLineParams, ['param1', 'param2']],
    [CodeLanguage.python3, SAMPLE_CODES.python3.commentedOutSignature, ['arg1', 'arg2']],
    [CodeLanguage.javascript, SAMPLE_CODES.javascript.noParams, []],
    [CodeLanguage.javascript, SAMPLE_CODES.javascript.singleParam, ['param1']],
    [
      CodeLanguage.javascript,
      SAMPLE_CODES.javascript.multipleParams,
      ['param1', 'param2', 'param3'],
    ],
    [CodeLanguage.javascript, SAMPLE_CODES.javascript.withComments, ['param1', 'param2']],
    [CodeLanguage.javascript, SAMPLE_CODES.javascript.withSpaces, ['param1', 'param2']],
    [CodeLanguage.javascript, SAMPLE_CODES.javascript.destructuredParams, ['param1', 'param2']],
    [CodeLanguage.javascript, SAMPLE_CODES.javascript.multiLineParams, ['param1', 'param2']],
    [CodeLanguage.javascript, SAMPLE_CODES.javascript.commentedOutSignature, ['arg1', 'arg2']],
    [CodeLanguage.javascript, SAMPLE_CODES.javascript.blockCommentedSignature, ['arg1', 'arg2']],
  ] as const)('extracts %s arguments from %s', (language, code, expected) => {
    expect(extractFunctionParams(code, language)).toEqual(expected)
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
  it.each([
    [CodeLanguage.python3, RETURN_TYPE_SAMPLES.python3.singleReturn, ['result']],
    [CodeLanguage.python3, RETURN_TYPE_SAMPLES.python3.multipleReturns, ['result', 'status']],
    [CodeLanguage.python3, RETURN_TYPE_SAMPLES.python3.noReturn, []],
    [
      CodeLanguage.python3,
      RETURN_TYPE_SAMPLES.python3.complexReturn,
      ['result', 'count', 'messages'],
    ],
    [
      CodeLanguage.python3,
      RETURN_TYPE_SAMPLES.python3.nestedObject,
      ['personal_info', 'timestamp', 'status'],
    ],
    [CodeLanguage.javascript, RETURN_TYPE_SAMPLES.javascript.singleReturn, ['result']],
    [CodeLanguage.javascript, RETURN_TYPE_SAMPLES.javascript.multipleReturns, ['result', 'status']],
    [CodeLanguage.javascript, RETURN_TYPE_SAMPLES.javascript.withParentheses, ['result', 'status']],
    [CodeLanguage.javascript, RETURN_TYPE_SAMPLES.javascript.noReturn, []],
    [CodeLanguage.javascript, RETURN_TYPE_SAMPLES.javascript.withQuotes, ['result', 'status']],
    [
      CodeLanguage.javascript,
      RETURN_TYPE_SAMPLES.javascript.nestedObject,
      ['personal_info', 'timestamp', 'status'],
    ],
  ] as const)('extracts %s return fields from %s', (language, code, keys) => {
    expect(extractReturnType(code, language)).toEqual(
      Object.fromEntries(keys.map((key) => [key, { type: VarType.string, children: null }])),
    )
  })
})
