import { it } from 'vite-plus/test'
import { definePlugin } from './plugin'

const env = definePlugin({ name: 'env', needs: [], build: () => ({ home: '/tmp' }) })
const session = definePlugin({
  name: 'session',
  needs: [env],
  build: async (ctx) => ({ dir: (await ctx.get(env)).home }),
})
definePlugin({
  name: 'token',
  needs: [session],
  build: async (ctx) => {
    const s = await ctx.get(session)
    // @ts-expect-error env is not in needs
    await ctx.get(env)
    return { where: s.dir }
  },
})

it('compiles', () => {})
