import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { consoleQuery } from '@/service/console'
import { commonQueryKeys } from '@/service/use-common'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedAppDslVersion, seedSystemFeatures } from '@/test/console/query-data'
import { renderWorkflowFlowComponent } from '../../../../__tests__/workflow-test-env'
import { BlockEnum } from '../../../../types'
import { CodeLanguage } from '../../../code/types'
import CodeGenerateBtn from '../code-generator-button'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.includes('/default-model?')) return Response.json({ data: null })
    if (
      url.includes('/spec/schema-definitions') ||
      /\/tools\/(?:builtin|api|workflow|mcp)$/.test(url)
    )
      return Response.json([])
    throw new Error(`Unexpected request: ${url}`)
  })
})

afterEach(() => vi.restoreAllMocks())

it('applies a stored code result through the real generator and closes at its owner', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  seedAccountProfileQuery(client)
  seedSystemFeatures(client)
  seedAppDslVersion(client)
  client.setQueryData(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.textGeneration } },
    }).queryKey,
    { data: [] },
  )
  client.setQueryData(commonQueryKeys.defaultModel(ModelTypeEnum.textGeneration), { data: null })
  client.setQueryData(
    consoleQuery.instructionGenerate.template.post.queryOptions({
      input: { body: { type: 'code' } },
    }).queryKey,
    { data: 'Describe a task' },
  )
  sessionStorage.setItem(
    'gen-data-flow-1-node-1-versions',
    JSON.stringify([{ modified: 'Generated code', prompt: 'Generated code' }]),
  )
  const onGenerated = vi.fn()
  const user = userEvent.setup()
  const view = renderWorkflowFlowComponent(
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter>
        <CodeGenerateBtn
          nodeId="node-1"
          codeLanguages={CodeLanguage.python3}
          onGenerated={onGenerated}
        />
      </NuqsTestingAdapter>
    </QueryClientProvider>,
    {
      nodes: [
        {
          id: 'node-1',
          position: { x: 0, y: 0 },
          data: { type: BlockEnum.Code, title: 'Node', desc: '' },
        },
      ],
      edges: [],
      hooksStoreProps: {
        configsMap: { flowId: 'flow-1', flowType: 'appFlow', fileSettings: { enabled: false } },
      },
    },
  )
  try {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'appDebug.operation.automatic' }))
    await user.click(await screen.findByRole('button', { name: 'appGeneration.generate.apply' }))
    const confirmation = screen.getByRole('alertdialog')
    expect(onGenerated).not.toHaveBeenCalled()
    await user.click(within(confirmation).getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onGenerated).toHaveBeenCalledExactlyOnceWith('Generated code')
    await user.click(screen.getByRole('button', { name: 'appDebug.operation.automatic' }))
    expect(
      await screen.findByRole('button', { name: 'appGeneration.generate.apply' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'appGeneration.generate.dismiss' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onGenerated).toHaveBeenCalledTimes(1)
  } finally {
    view.unmount()
    client.clear()
  }
})
