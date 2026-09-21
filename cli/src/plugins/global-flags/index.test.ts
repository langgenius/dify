import { expect, it } from 'vite-plus/test'
import { Context } from '@/kernel/context'
import { argv } from '@/plugins/argv'
import { globalFlags } from './index'

async function parse(tokens: readonly string[]) {
  return new Context([[argv, tokens]]).get(globalFlags)
}

it('takes --verbose anywhere, hands the command the rest, and leaves -- alone', async () => {
  expect(await parse(['--verbose', 'call', 'a.b', '--input', '{}'])).toEqual({
    flags: { verbose: true },
    rest: ['call', 'a.b', '--input', '{}'],
  })
  expect(await parse(['call', 'a.b', '--', '--verbose'])).toEqual({
    flags: { verbose: false },
    rest: ['call', 'a.b', '--', '--verbose'],
  })
  await expect(parse(['--verbose=maybe'])).rejects.toMatchObject({ code: 'usage_invalid_flag' })
})
