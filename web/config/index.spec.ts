import { resetReg, validPassword, VAR_REGEX } from './index'

it.each([
  ['abc12345', true],
  ['ABC12345', true],
  ['p@$$w0rd', true],
  ['abc1234', false],
  ['12345678', false],
  ['abcdefgh', false],
  ['pass word1', false],
  ['password1 ', false],
  ['pass\tword1', false],
])('checks the password policy for %s', (password, valid) => {
  expect(validPassword.test(password)).toBe(valid)
})

describe('workflow variable references', () => {
  beforeEach(() => resetReg())
  afterEach(() => resetReg())

  it.each([
    '{{#1749783300519.text#}}',
    '{{#1749783300519.llm.a.b.c#}}',
    '{{#sys.query#}}',
    '{{#conversation.aaa#}}',
    '{{#env.a#}}',
    '{{#rag.1748945155129.a#}}',
    '{{#rag.shared.bbb#}}',
  ])('matches the complete %s reference', (variable) => {
    expect(variable.match(VAR_REGEX)).toEqual([variable])
  })
})
