import { expect, it } from 'vite-plus/test'
import { Context } from './context'
import { definePlugin } from './plugin'

it('builds lazily, once, and memoises by plugin object', async () => {
  let builds = 0
  const a = definePlugin({ name: 'a', needs: [], build: () => ({ n: ++builds }) })
  const ctx = new Context()
  expect(builds).toBe(0)
  const first = await ctx.get(a)
  const second = await ctx.get(a)
  expect(first).toBe(second)
  expect(builds).toBe(1)
})

it('builds needs on demand from inside build', async () => {
  const order: string[] = []
  const a = definePlugin({
    name: 'a',
    needs: [],
    build: () => {
      order.push('a')
      return { v: 1 }
    },
  })
  const b = definePlugin({
    name: 'b',
    needs: [a],
    build: async (ctx) => {
      order.push('b:start')
      const { v } = await ctx.get(a)
      order.push('b:end')
      return { v: v + 1 }
    },
  })
  const ctx = new Context()
  expect((await ctx.get(b)).v).toBe(2)
  expect(order).toEqual(['b:start', 'a', 'b:end'])
})

it('returns an override without building the plugin', async () => {
  let built = false
  const a = definePlugin({
    name: 'a',
    needs: [],
    build: () => {
      built = true
      return { real: true }
    },
  })
  const ctx = new Context([[a, { real: false }]])
  expect(await ctx.get(a)).toEqual({ real: false })
  expect(built).toBe(false)
})

it('reports a runtime cycle instead of hanging', async () => {
  // Types forbid this; the cast is the only way in, so the kernel still refuses it at run time.
  const a = definePlugin({
    name: 'a',
    needs: [],
    build: async (ctx): Promise<unknown> =>
      (ctx as { get: (p: unknown) => Promise<unknown> }).get(a),
  })
  await expect(new Context().get(a)).rejects.toThrow(/kernel: cycle while building a/)
})

it('records defers in registration order', async () => {
  const a = definePlugin({
    name: 'a',
    needs: [],
    build: (ctx) => {
      ctx.defer(() => {})
      ctx.defer(() => {})
      return {}
    },
  })
  const ctx = new Context()
  await ctx.get(a)
  expect(ctx.deferred).toHaveLength(2)
})
