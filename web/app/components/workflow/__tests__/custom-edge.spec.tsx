import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Position } from 'reactflow'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import CustomEdge from '../custom-edge'
import llmDefault from '../nodes/llm/default'
import { BlockEnum } from '../types'
import { renderWorkflowFlowComponent } from './workflow-test-env'

const mockUseAvailableBlocks = vi.hoisted(() => vi.fn())
const mockUseNodesInteractions = vi.hoisted(() => vi.fn())

vi.mock('../hooks/use-available-blocks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/use-available-blocks')>()

  return {
    ...actual,
    useAvailableBlocks: (...args: unknown[]) => mockUseAvailableBlocks(...args),
  }
})

vi.mock('../hooks/use-nodes-interactions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/use-nodes-interactions')>()

  return {
    ...actual,
    useNodesInteractions: () => mockUseNodesInteractions(),
  }
})

describe('CustomEdge insertion', () => {
  it('offers compatible blocks without a start tab and inserts between the connected handles', async () => {
    const user = userEvent.setup()
    const handleNodeAdd = vi.fn()
    mockUseNodesInteractions.mockReturnValue({ handleNodeAdd })
    mockUseAvailableBlocks.mockImplementation((type: BlockEnum) =>
      type === BlockEnum.Code
        ? { availablePrevBlocks: [BlockEnum.LLM, BlockEnum.Code] }
        : { availableNextBlocks: [BlockEnum.LLM, BlockEnum.Tool] },
    )
    const { queryClient } = createConsoleQueryWrapper()
    seedToolProviders(queryClient, {
      builtInTools: [],
      customTools: [],
      workflowTools: [],
      mcpTools: [],
    })
    renderWorkflowFlowComponent(
      <svg>
        <CustomEdge
          id="edge"
          source="source-node"
          sourceHandleId="branch"
          target="target-node"
          targetHandleId="input"
          sourceX={100}
          sourceY={120}
          sourcePosition={Position.Right}
          targetX={300}
          targetY={220}
          targetPosition={Position.Left}
          selected={false}
          data={{ sourceType: BlockEnum.Start, targetType: BlockEnum.Code, _hovering: true }}
        />
      </svg>,
      {
        queryClient,
        hooksStoreProps: {
          availableNodesMetaData: {
            nodes: [
              {
                defaultValue: {},
                metaData: { ...llmDefault.metaData, title: 'LLM' },
                checkValid: () => ({ isValid: true }),
              },
            ],
          },
        },
      },
    )
    await user.click(screen.getByRole('button', { name: 'workflow.common.addBlock' }))
    expect(screen.queryByRole('tab', { name: 'workflow.tabs.start' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'LLM' }))
    expect(handleNodeAdd).toHaveBeenCalledWith(
      expect.objectContaining({ nodeType: BlockEnum.LLM }),
      {
        prevNodeId: 'source-node',
        prevNodeSourceHandle: 'branch',
        nextNodeId: 'target-node',
        nextNodeTargetHandle: 'input',
      },
    )
  })
})
