import { CONTEXT_PLACEHOLDER_TEXT, getInputVars, QUERY_PLACEHOLDER_TEXT } from '../constants'

describe('prompt-editor input variables', () => {
  describe('getInputVars', () => {
    it('returns no variables for empty or plain text', () => {
      expect(getInputVars('')).toEqual([])
      expect(getInputVars('plain text without vars')).toEqual([])
    })

    it('should ignore placeholders that are not input vars', () => {
      const text = `a ${CONTEXT_PLACEHOLDER_TEXT} b ${QUERY_PLACEHOLDER_TEXT} c`

      expect(getInputVars(text)).toEqual([])
    })

    it('should parse regular input vars with dotted selectors', () => {
      const text = 'value {{#node123.result.answer#}} and {{#abc.def#}}'

      expect(getInputVars(text)).toEqual([
        ['node123', 'result', 'answer'],
        ['abc', 'def'],
      ])
    })

    it('should strip numeric node id for sys selector vars', () => {
      const text = 'value {{#1711617514996.sys.query#}}'

      expect(getInputVars(text)).toEqual([['sys', 'query']])
    })

    it('should keep selector unchanged when sys prefix is not numeric id', () => {
      const text = 'value {{#abc.sys.query#}}'

      expect(getInputVars(text)).toEqual([['abc', 'sys', 'query']])
    })
  })
})
