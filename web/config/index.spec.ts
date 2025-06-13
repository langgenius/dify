// 写测试用例, VAR_REGEX 能匹配的情况和不能匹配的情况
import { VAR_REGEX, resetReg } from './index'
describe('VAR_REGEX', () => {
  it('matched variable names', () => {
    const vars = [
      // node output variables
      '{{#1749783300519.text#}}',
      '{{#1749783300519.llm.a#}}',
      '{{#1749783300519.llm.a.b.c#}}',
      '{{#1749783300519.llm.a#}}',
      // system variables
      '{{#sys.query#}}',
      // conversation variables
      '{{#conversation.aaa#}}',
      // env variables
      '{{#env.a#}}',
      // rag variables
      '{{#rag.1748945155129.a#}}',
      '{{#rag.shared.bbb#}}',
    ]
    vars.forEach((variable) => {
      expect(VAR_REGEX.test(variable)).toBe(true)
      resetReg()
    })
  })
})
