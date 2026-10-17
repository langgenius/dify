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
  it.each([
    [CodeLanguage.python3, SAMPLE_CODES.python3.noParams, []],
    [CodeLanguage.python3, SAMPLE_CODES.python3.singleParam, ['param1']],
    [CodeLanguage.python3, SAMPLE_CODES.python3.multipleParams, ['param1', 'param2', 'param3']],
    [CodeLanguage.python3, SAMPLE_CODES.python3.withTypes, ['param1', 'param2', 'param3']],
    [CodeLanguage.python3, SAMPLE_CODES.python3.withDefaults, ['param1', 'param2']],
    [CodeLanguage.javascript, SAMPLE_CODES.javascript.noParams, []],
    [CodeLanguage.javascript, SAMPLE_CODES.javascript.singleParam, ['param1']],
    [
      CodeLanguage.javascript,
      SAMPLE_CODES.javascript.multipleParams,
      ['param1', 'param2', 'param3'],
    ],
    [CodeLanguage.javascript, SAMPLE_CODES.javascript.withComments, ['param1', 'param2']],
    [CodeLanguage.javascript, SAMPLE_CODES.javascript.withSpaces, ['param1', 'param2']],
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
  it('preserves JavaScript regex literals containing comment markers', () => {
    const code = String.raw`function main(url) {
      return {
        result: /https?:\/\//.test(url), // URL scheme
        status: /[/*]/.test(url) /* slash or star */
      }
    }`
    expect(extractReturnType(code, CodeLanguage.javascript)).toEqual({
      result: { type: VarType.string, children: null },
      status: { type: VarType.string, children: null },
    })
  })

  it.each([
    [
      CodeLanguage.python3,
      `
# return {"ignored": "comment"}
def main():
    return {
        # The result's nested data: { ignored: 1 },
        "result": {"url": "https://example.com/#fragment"}, # keep the next field
        # Status metadata
        "status": "ok"
    }`,
    ],
    [
      CodeLanguage.javascript,
      `
// return { ignored: "comment" }
function main() {
    return {
        /* The result's nested data: { ignored: 1 }, */
        result: { url: "https://example.com/*literal*/" }, // keep the next field
        // Status metadata
        status: "ok"
    }
}`,
    ],
  ] as const)(
    'ignores %s comments without dropping outputs or parsing nested keys',
    (language, code) => {
      expect(extractReturnType(code, language)).toEqual({
        result: { type: VarType.string, children: null },
        status: { type: VarType.string, children: null },
      })
    },
  )

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
    [CodeLanguage.javascript, RETURN_TYPE_SAMPLES.javascript.withJSDoc, ['result']],
  ] as const)('extracts top-level %s return fields from %s', (language, code, keys) => {
    expect(extractReturnType(code, language)).toEqual(
      Object.fromEntries(keys.map((key) => [key, { type: VarType.string, children: null }])),
    )
  })
})
