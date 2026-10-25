import type { QuestionClassifierNodeType } from '../types'
import type { Topic } from '@/app/components/workflow/nodes/_base/components/branch-list/types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper, seedAppDslVersion } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import Node from '../node'

const render = createNuqsTestRenderer((ui) => {
  const { queryClient } = createConsoleQueryWrapper()
  seedAppDslVersion(queryClient)
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      models: [createCatalogModelFixture({ model: 'gpt-4o', label: { en_US: 'GPT-4o' } })],
    }),
  ])
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  return renderWorkflowFlowComponent(ui, { queryClient })
})

const createTopic = (overrides: Partial<Topic> = {}): Topic => ({
  id: 'topic-1',
  name: 'Billing questions',
  ...overrides,
})

const createData = (
  overrides: Partial<QuestionClassifierNodeType> = {},
): QuestionClassifierNodeType => ({
  title: 'Question Classifier',
  desc: '',
  type: BlockEnum.QuestionClassifier,
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: 'chat',
    completion_params: {},
  },
  classes: [createTopic()],
  query_variable_selector: ['node-1', 'query'],
  instruction: 'Route by topic',
  vision: {
    enabled: false,
  },
  ...overrides,
})

const baseNodeProps = {
  id: 'node-1',
  type: 'custom',
  selected: false,
  zIndex: 1,
  xPos: 0,
  yPos: 0,
  dragging: false,
  isConnectable: true,
}

describe('question-classifier/node', () => {
  it('shows the configured model and class labels', () => {
    render(
      <Node
        {...baseNodeProps}
        data={createData({
          classes: [
            createTopic({ label: 'Billing' }),
            createTopic({ id: 'topic-2', name: 'Refunds', label: 'Refund desk' }),
          ],
        })}
      />,
    )

    expect(screen.getByText('GPT-4o')).toBeInTheDocument()
    expect(screen.getByText('Billing')).toBeInTheDocument()
    expect(screen.getByText('Refund desk')).toBeInTheDocument()
  })

  it('returns nothing when neither model nor classes are configured and truncates long class names', async () => {
    const user = userEvent.setup()
    const longName = 'L'.repeat(60)
    const { rerender } = render(
      <Node
        {...baseNodeProps}
        data={createData({
          model: {
            provider: '',
            name: '',
            mode: 'chat',
            completion_params: {},
          },
          classes: [createTopic({ id: 'topic-2', name: longName })],
        })}
      />,
    )

    expect(screen.getByText(`${longName.slice(0, 50)}...`)).toBeInTheDocument()
    await user.hover(screen.getByRole('button', { name: longName }))
    expect(await screen.findByText(longName)).toBeInTheDocument()

    rerender(
      <Node
        {...baseNodeProps}
        data={createData({
          model: {
            provider: '',
            name: '',
            mode: 'chat',
            completion_params: {},
          },
          classes: [],
        })}
      />,
    )

    expect(screen.queryByText(`${longName.slice(0, 50)}...`)).not.toBeInTheDocument()
    expect(screen.queryByText('GPT-4o')).not.toBeInTheDocument()
  })
})
