import type { TestWorld } from '@test/fixtures/kernel'
import { testContext } from '@test/fixtures/kernel'
import { afterEach, expect, it } from 'vite-plus/test'
import { Context } from '@/kernel/context'
import { commands } from '@/plugins/commands'
import { main } from './main'

let w: TestWorld
afterEach(async () => {
  await w.stop()
})

it('prints the envelope on stderr and returns the exit code', async () => {
  w = await testContext({ login: false })
  const code = await main(['nope'], w.overrides)
  expect(code).toBe(2)
  expect(JSON.parse(w.io.errBuf()).error.code).toBe('usage_invalid_flag')
  expect(w.io.outBuf()).toBe('')
})

it('a thrown non-BaseError becomes the unknown envelope, exit 1', async () => {
  w = await testContext({ login: false })
  const code = await main(
    [],
    [
      ...w.overrides,
      [
        commands,
        {
          run: async () => {
            throw new Error('boom')
          },
        },
      ],
    ],
  )
  expect(code).toBe(1)
  expect(JSON.parse(w.io.errBuf()).error).toEqual({ code: 'unknown', message: 'boom' })
})

it('runs deferred cleanups in reverse, after failure too', async () => {
  w = await testContext({ login: false })
  const order: string[] = []
  const ctx: Context = new Context([
    ...w.overrides,
    [
      commands,
      {
        run: async () => {
          ctx.defer(() => {
            order.push('first')
          })
          ctx.defer(() => {
            order.push('second')
          })
          throw new Error('boom')
        },
      },
    ],
  ])
  expect(await main([], [], ctx)).toBe(1)
  expect(order).toEqual(['second', 'first'])
})
