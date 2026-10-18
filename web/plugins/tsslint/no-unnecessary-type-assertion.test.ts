// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import rule from './no-unnecessary-type-assertion'
import { lintWithRule } from './test-utils'

const lint = (code: string) => lintWithRule(rule, code)
const fixedLines = (code: string) =>
  lint(code).map((result) => result.fixed.trimEnd().split('\n').at(-1))

describe('no-unnecessary-type-assertion', () => {
  it('removes an assertion to the type the value already has', () => {
    expect(fixedLines('declare const a: string[]\nconst b = a as string[]\n')).toEqual([
      'const b = a',
    ])
  })

  it('removes an upcast when the receiver type is fixed', () => {
    const prelude = 'declare const s: string\ndeclare function take(value: string | number): void\n'
    expect(fixedLines(`${prelude}take(s as string | number)\n`)).toEqual(['take(s)'])
    expect(
      lint(`${prelude}function f(): string | number {\n  return s as string | number\n}\n`).map(
        (result) => result.fixed,
      ),
    ).toEqual([`${prelude}function f(): string | number {\n  return s\n}\n`])
    const assign = 'declare const d: { a: string; b: number }\ndeclare let t: { a: string }\n'
    expect(fixedLines(`${assign}t = d as { a: string }\n`)).toEqual(['t = d'])
  })

  it('keeps upcasts whose receiver type is not fixed', () => {
    const prelude = 'declare const s: string\n'
    expect(lint(`${prelude}const v = s as string | number\n`)).toEqual([])
    expect(
      lint(`${prelude}declare function id<T>(value: T): T\nid(s as string | number)\n`),
    ).toEqual([])
    const overloads =
      'declare function take(value: string): void\ndeclare function take(value: string | number): void\n'
    expect(lint(`${prelude}${overloads}take(s as string | number)\n`)).toEqual([])
    expect(lint(`${prelude}declare let u: string | number\nu = s as string | number\n`)).toEqual([])
  })

  it('keeps assertions on values typed by their context', () => {
    expect(lint("const mode = 'a' as 'a' | 'b'\n")).toEqual([])
    const generic = [
      'declare function get<T>(url: string): Promise<T>',
      "export const load = () => get('/site') as Promise<{ name: string }>",
    ].join('\n')
    expect(lint(generic)).toEqual([])
  })

  it('keeps an assertion that stops a literal type from widening', () => {
    expect(lint("const a = 'a'\nlet b = a as 'a'\n")).toEqual([])
  })

  it('keeps an assertion that stops a reference from being narrowed', () => {
    const prelude = 'declare let value: string | number\n'
    expect(lint(`${prelude}if (typeof (value as string | number) === 'string') {}\n`)).toEqual([])
    expect(lint(`${prelude}switch (value as string | number) {}\n`)).toEqual([])
    const state = "type State = { kind: 'idle' } | { kind: 'busy' }\ndeclare let state: State\n"
    expect(lint(`${state}if ((state as State).kind === 'idle') {}\n`)).toEqual([])
    expect(lint(`${state}const { kind } = state as State\n`)).toEqual([])
  })

  describe('double assertions', () => {
    it('drops the unknown step when the types are assignable in one direction', () => {
      const code = [
        'type A = { a: string }',
        'type B = A & { b: number }',
        'declare const a: A',
        'declare const b: B',
        'const up = b as unknown as A',
        'const down = a as unknown as B',
      ].join('\n')
      expect(lint(code).map((r) => r.fixed)).toEqual([
        expect.stringContaining('const up = b as A\n'),
        expect.stringContaining('const down = a as B'),
      ])
    })

    it('keeps both steps between unrelated types or for values typed by their context', () => {
      expect(lint('declare const a: string\nconst b = a as unknown as number\n')).toEqual([])
      const code = "type A = { scope: 'a' | 'b' }\nconst b = { scope: 'other' } as unknown as A\n"
      expect(lint(code)).toEqual([])
    })
  })
})
