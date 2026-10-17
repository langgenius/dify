import type { DocExtractorNodeType } from '../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { BlockEnum } from '../../../types'
import Panel from '../panel'

// Variable selection has its own integration coverage; this panel owns output type disclosure.
vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: () => null,
}))

it.each([
  { isArray: false, outputType: 'string' },
  { isArray: true, outputType: 'array[string]' },
])(
  'discloses $outputType output for the configured file input',
  async ({ isArray, outputType }) => {
    const data: DocExtractorNodeType = {
      title: 'Document Extractor',
      desc: '',
      type: BlockEnum.DocExtractor,
      variable_selector: [],
      is_array_file: isArray,
    }
    const queryClient = createConsoleQueryClient()
    queryClient.setQueryData(consoleQuery.files.supportType.get.queryKey(), {
      allowed_extensions: ['pdf'],
    })
    queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
    seedToolProviders(queryClient, {
      builtInTools: [],
      customTools: [],
      workflowTools: [],
      mcpTools: [],
    })
    renderWorkflowFlowComponent(
      <Panel
        panelProps={{
          getInputVars: () => [],
          toVarInputs: () => [],
          runInputData: {},
          runInputDataRef: { current: {} },
          setRunInputData: () => {},
          runResult: null,
        }}
        id="doc-node"
        data={data}
      />,
      {
        queryClient,
        nodes: [createNode({ id: 'doc-node', data })],
      },
    )

    await userEvent.setup().click(screen.getByRole('button', { name: /outputVars/ }))
    expect(screen.getByText('text')).toBeInTheDocument()
    expect(screen.getByText(outputType)).toBeInTheDocument()
  },
)
