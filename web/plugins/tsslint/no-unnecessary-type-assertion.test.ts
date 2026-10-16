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
    expect(fixedLines(`${prelude}const v: string | number = s as string | number\n`)).toEqual([
      'const v: string | number = s',
    ])
    expect(
      fixedLines(`${prelude}function f(): string | number {\n  return s as string | number\n}\n`),
    ).toEqual(['}'])
  })

  it('keeps an upcast that declares the type of an unannotated binding', () => {
    expect(lint('declare const s: string\nconst v = s as string | number\n')).toEqual([])
  })

  it('keeps an upcast passed to a generic or overloaded function', () => {
    expect(
      lint(
        'declare const s: string\ndeclare function id<T>(value: T): T\nid(s as string | number)\n',
      ),
    ).toEqual([])
    const overloads =
      'declare function take(value: string): void\ndeclare function take(value: string | number): void\n'
    expect(lint(`declare const s: string\n${overloads}take(s as string | number)\n`)).toEqual([])
  })

  it('keeps an assertion that infers the type argument of a generic call', () => {
    const code = [
      'declare function get<T>(url: string): Promise<T>',
      'export function load() {',
      "  return get('/site') as Promise<{ name: string }>",
      '}',
    ].join('\n')
    expect(lint(code)).toEqual([])
  })

  it('keeps an assertion that widens a value inside generic inference', () => {
    const code =
      'declare function hoisted<T>(factory: () => T): T\nconst state = hoisted(() => ({ data: undefined as unknown }))\n'
    expect(lint(code)).toEqual([])
  })

  it('keeps assertions on values typed by their context', () => {
    expect(lint("const mode = 'a' as 'a' | 'b'\n")).toEqual([])
    const code = [
      'declare function query<T extends Element = HTMLElement>(): T | null',
      'const input = (query() || query()) as HTMLInputElement | null',
    ].join('\n')
    expect(lint(code)).toEqual([])
  })

  describe('double assertions', () => {
    it('removes the assertions when the value already has the target type', () => {
      const [result] = lint('declare const a: string[]\nconst b = a as unknown as string[]\n')
      expect(result?.fixed).toBe('declare const a: string[]\nconst b = a\n')
    })

    it('collapses to a single assertion for upcasts and downcasts', () => {
      const code = [
        'type A = { a: string }',
        'type B = A & { b: number }',
        'declare const a: A',
        'declare const b: B',
        'const up = b as unknown as A',
        'const down = (a as unknown) as B',
      ].join('\n')
      const results = lint(code)
      expect(results.map((r) => r.fixed.split('\n').at(-1))).toEqual([
        'const down = (a as unknown) as B',
        'const down = a as B',
      ])
      expect(results[0]?.fixed).toContain('const up = b as A\n')
    })

    it('collapses an unknown value to a single assertion', () => {
      const [result] = lint('declare const a: unknown\nconst b = a as unknown as string\n')
      expect(result?.fixed).toBe('declare const a: unknown\nconst b = a as string\n')
    })

    it('keeps assertions between unrelated types', () => {
      expect(lint('declare const a: string\nconst b = a as unknown as number\n')).toEqual([])
      expect(
        lint(
          'type A = { a: string }\ntype B = { b: string }\ndeclare const a: A\nconst b = a as unknown as B\n',
        ),
      ).toEqual([])
    })

    it('keeps assertions when a contextual type would narrow a literal value', () => {
      const code = "type A = { scope: 'a' | 'b' }\nconst b = { scope: 'other' } as unknown as A\n"
      expect(lint(code)).toEqual([])
    })

    it('ignores values typed as any', () => {
      expect(lint('declare const a: any\nconst b = a as unknown as string\n')).toEqual([])
    })
  })
})
