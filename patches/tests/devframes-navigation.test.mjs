import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
// oxlint-disable-next-line vitest/no-import-node-test -- Verify the installed patch independently of the Vite test runner.
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const require = createRequire(new URL('../../web/package.json', import.meta.url))
const coreRequire = createRequire(require.resolve('@vitejs/devtools'))
const root = dirname(coreRequire.resolve('@devframes/hub-ui/package.json'))

for (const [file, variable, snapshot] of [
  ['dist/client/embedded.js', 'be', 'v'],
  ['dist/client/standalone/assets/context-DKLWZLho.js', 'Q', 'L'],
]) {
  test(`${file}: restores only a route owned by the selected dock`, () => {
    const code = readFileSync(join(root, file), 'utf8')
    const expression = code.match(new RegExp(`let ${variable}\\s*=([^;]+);`))?.[1]
    assert.ok(expression)
    const restore = (state) => runInNewContext(expression, { [snapshot]: state })
    assert.equal(restore({ selectedDockId: null }), null)
    assert.equal(
      restore({
        selectedDockId: 'rolldown',
        selectedDockRoute: '/__devtools-vite/home',
      }),
      null,
      'legacy unowned routes must not restore into a different frame',
    )
    assert.equal(
      restore({
        selectedDockId: 'rolldown',
        selectedDockLocation: { id: 'vite', url: '/__devtools-vite/home' },
      }),
      null,
      'switching tabs must not carry the previous tab route across reload',
    )
    assert.equal(
      restore({
        selectedDockId: 'vite',
        selectedDockLocation: { id: 'vite', url: '/__devtools-vite/plugins?plugin=3' },
      }),
      '/__devtools-vite/plugins?plugin=3',
      'same-tab deep links survive reload',
    )
  })
}
