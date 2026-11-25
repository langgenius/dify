import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vite-plus/test'

function lintFixture(source: string) {
  const require = createRequire(import.meta.url)
  const viteRequire = createRequire(require.resolve('vite-plus/package.json'))
  const oxlintBin = join(dirname(dirname(viteRequire.resolve('oxlint'))), 'bin', 'oxlint')
  const directory = mkdtempSync(join(tmpdir(), 'dify-raw-reactflow-graph-write-'))
  try {
    writeFileSync(
      join(directory, 'plugin.mjs'),
      `export { default } from ${JSON.stringify(require.resolve('../index.ts'))};`,
    )
    writeFileSync(
      join(directory, '.oxlintrc.json'),
      JSON.stringify({
        categories: { correctness: 'off' },
        jsPlugins: ['./plugin.mjs'],
        rules: { 'dify/no-raw-reactflow-graph-write': 'error' },
      }),
    )
    writeFileSync(join(directory, 'fixture.jsx'), source)
    const result = spawnSync(
      process.execPath,
      [oxlintBin, '--config', join(directory, '.oxlintrc.json'), '--format', 'json', 'fixture.jsx'],
      { cwd: directory, encoding: 'utf8' },
    )
    expect(result.error).toBeUndefined()
    expect([0, 1], result.stderr + result.stdout).toContain(result.status)
    return (
      JSON.parse(result.stdout).diagnostics as Array<{ labels: { span: { line: number } }[] }>
    ).map((diagnostic) => diagnostic.labels[0]!.span.line)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

it('reports graph setters taken from the raw React Flow store', () => {
  expect(
    lintFixture(
      [
        'function useHook() {',
        '  const store = useStoreApi()',
        '  return () => {',
        '    const { getNodes, setNodes, edges, setEdges } = store.getState()',
        '    store.getState().setNodes([])',
        '    const state = store.getState()',
        '    state.setEdges([])',
        '  }',
        '}',
      ].join('\n'),
    ),
  ).toEqual([4, 4, 5, 7])
})

it('allows collaborative setters and reads from the raw store', () => {
  expect(
    lintFixture(
      [
        'function useHook() {',
        '  const store = useStoreApi()',
        '  const collaborativeWorkflow = useCollaborativeWorkflow()',
        '  return () => {',
        '    const { getNodes, edges, transform } = store.getState()',
        '    const { nodes, setNodes } = collaborativeWorkflow.getState()',
        '    setNodes(nodes)',
        '    collaborativeWorkflow.setEdges(edges, false)',
        '    const [localNodes, setLocalNodes] = useNodesState(getNodes())',
        '    setLocalNodes(localNodes)',
        '  }',
        '}',
      ].join('\n'),
    ),
  ).toEqual([])
})
