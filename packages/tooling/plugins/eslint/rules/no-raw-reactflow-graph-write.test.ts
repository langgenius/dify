import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vite-plus/test'

function lintFixture(source: string, fileName = 'fixture.tsx') {
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
    writeFileSync(join(directory, fileName), source)
    const result = spawnSync(
      process.execPath,
      [oxlintBin, '--config', join(directory, '.oxlintrc.json'), '--format', 'json', fileName],
      { cwd: directory, encoding: 'utf8' },
    )
    expect(result.error).toBeUndefined()
    expect([0, 1], result.stderr + result.stdout).toContain(result.status)
    return (
      JSON.parse(result.stdout).diagnostics as Array<{ labels: { span: { line: number } }[] }>
    )
      .map((diagnostic) => diagnostic.labels[0]!.span.line)
      .sort((a, b) => a - b)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

it('reports graph setters taken from the raw React Flow store', () => {
  expect(
    lintFixture(
      [
        'function useHook(): void {',
        '  const store = useStoreApi()',
        '  return () => {',
        '    const { getNodes, setNodes, edges, setEdges } = store.getState()',
        '    store.getState().setNodes([] as Node[])',
        '    const state = store.getState()',
        '    state.setEdges([])',
        '    const { setNodes: write } = state',
        '    store.setState({ nodes: [], userSelectionActive: false })',
        '  }',
        '}',
      ].join('\n'),
    ),
  ).toEqual([4, 4, 5, 7, 8, 9])
})

it('reports graph writes through useReactFlow', () => {
  expect(
    lintFixture(
      [
        'function useHook() {',
        '  const reactflow = useReactFlow()',
        '  const { addNodes, getViewport } = useReactFlow()',
        '  return (node: Node) => {',
        '    reactflow.setNodes([node])',
        '    reactflow.deleteElements({ nodes: [node] })',
        '    reactflow.setCenter(0, 0)',
        '  }',
        '}',
      ].join('\n'),
    ),
  ).toEqual([3, 5, 6])
})

it('allows collaborative setters, reads, and non-graph store updates', () => {
  expect(
    lintFixture(
      [
        'function useHook() {',
        '  const store = useStoreApi()',
        '  const collaborativeWorkflow = useCollaborativeWorkflow()',
        '  const reactflow = useReactFlow()',
        '  return () => {',
        '    const { getNodes, edges, transform } = store.getState()',
        '    const { nodes, setNodes } = collaborativeWorkflow.getState()',
        '    setNodes(nodes)',
        '    collaborativeWorkflow.setEdges(edges, false)',
        '    const [localNodes, setLocalNodes] = useNodesState(getNodes())',
        '    setLocalNodes(localNodes)',
        '    store.setState({ userSelectionRect: null })',
        '    reactflow.setViewport({ x: 0, y: 0, zoom: 1 })',
        '  }',
        '}',
      ].join('\n'),
    ),
  ).toEqual([])
})
