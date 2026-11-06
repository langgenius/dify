import type { Topic } from '@/app/components/workflow/nodes/_base/components/branch-list/types'
import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { replacePromptEditorText } from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import {
  createEdge,
  createNode,
  createStartNode,
} from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import ClassItem from '../../../_base/components/branch-list/class-item'

const createTopic = (overrides: Partial<Topic> = {}): Topic => ({
  id: 'topic-1',
  name: 'Billing questions',
  ...overrides,
})

const createCodeNode = () => {
  const data = {
    title: 'Answer producer',
    desc: '',
    type: BlockEnum.Code,
    code_language: CodeLanguage.python3,
    code: 'def main():\n    return {"answer": "Billing question"}',
    variables: [],
    outputs: { answer: { type: VarType.string, children: null } },
  } satisfies CodeNodeType
  return createNode({ id: 'code', data })
}

const renderClass = (ui: React.ReactElement) => {
  const { queryClient } = createConsoleQueryWrapper({ appDslVersion: '0.6.0' })
  seedModelProviderQueries(queryClient, [])
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  const start = createStartNode({
    id: 'start',
    data: {
      title: 'Inputs',
      variables: [
        {
          variable: 'query',
          label: 'Query',
          type: InputVarType.textInput,
          required: true,
        },
      ],
    },
  })
  const code = createCodeNode()
  const classifier = createNode({
    id: 'node-1',
    data: { title: 'Classifier', type: BlockEnum.QuestionClassifier },
  })

  return renderWorkflowFlowComponent(
    <EventEmitterContextProvider>{ui}</EventEmitterContextProvider>,
    {
      queryClient,
      nodes: [start, code, classifier],
      edges: [
        createEdge({
          source: start.id,
          target: code.id,
          data: { sourceType: BlockEnum.Start, targetType: BlockEnum.Code },
        }),
        createEdge({
          source: code.id,
          target: classifier.id,
          data: { sourceType: BlockEnum.Code, targetType: BlockEnum.QuestionClassifier },
        }),
      ],
    },
  )
}

describe('question-classifier/class-item', () => {
  it('forwards editor updates and remove actions', async () => {
    const user = userEvent.setup()

    function EditableClass() {
      const [topic, setTopic] = useState(createTopic)
      const [removed, setRemoved] = useState(false)
      return (
        <>
          {!removed && (
            <ClassItem
              nodeId="node-1"
              payload={topic}
              onChange={setTopic}
              onRemove={() => setRemoved(true)}
              index={1}
              filterVar={() => true}
            />
          )}
          <output aria-label="Saved class">{JSON.stringify(topic)}</output>
          <output aria-label="Removal state">{removed ? 'removed' : 'present'}</output>
        </>
      )
    }

    renderClass(<EditableClass />)

    expect(screen.getByRole('button', { name: 'CLASS 1' })).toBeInTheDocument()
    await replacePromptEditorText(screen.getByRole('textbox'), 'Billing questions updated')
    await waitFor(() =>
      expect(JSON.parse(screen.getByRole('status', { name: 'Saved class' }).textContent!)).toEqual({
        id: 'topic-1',
        name: 'Billing questions updated',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))

    expect(screen.getByRole('status', { name: 'Removal state' })).toHaveTextContent('removed')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('preserves a custom label when editing the classifier name', async () => {
    function LabeledClass() {
      const [topic, setTopic] = useState(() => createTopic({ label: 'Billing' }))
      return (
        <>
          <ClassItem
            nodeId="node-1"
            payload={topic}
            onChange={setTopic}
            onRemove={() => {}}
            index={1}
            filterVar={() => true}
          />
          <output aria-label="Saved class">{JSON.stringify(topic)}</output>
        </>
      )
    }

    renderClass(<LabeledClass />)

    await replacePromptEditorText(screen.getByRole('textbox'), 'Billing questions updated')

    await waitFor(() =>
      expect(JSON.parse(screen.getByRole('status', { name: 'Saved class' }).textContent!)).toEqual({
        id: 'topic-1',
        name: 'Billing questions updated',
        label: 'Billing',
      }),
    )
    expect(screen.getByRole('button', { name: 'Billing' })).toBeInTheDocument()
  })
})

it('preserves the group name during label editing and updates it on save', async () => {
  const user = userEvent.setup()
  function NamedClass() {
    const [topic, setTopic] = useState(() => createTopic({ label: 'Billing' }))
    const [readonly, setReadonly] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setReadonly(true)}>
          Make readonly
        </button>
        <div role="group" aria-labelledby="class-title">
          <ClassItem
            labelId="class-title"
            nodeId="node-1"
            payload={topic}
            onChange={setTopic}
            onRemove={() => {}}
            index={1}
            filterVar={() => true}
            readonly={readonly}
          />
        </div>
      </>
    )
  }
  renderClass(<NamedClass />)
  expect(screen.getByRole('group', { name: 'Billing' })).toBeInTheDocument()
  await user.dblClick(screen.getByRole('button', { name: 'Billing' }))
  const labelInput = screen.getByRole('textbox', {
    name: 'workflowModels.nodes.questionClassifiers.labelEditorAriaLabel',
  })
  await user.clear(labelInput)
  await user.type(labelInput, 'Refunds')
  expect(screen.getByRole('group', { name: 'Billing' })).toBeInTheDocument()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('group', { name: 'Refunds' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Make readonly' }))
  expect(screen.getByRole('group', { name: 'Refunds' })).toBeInTheDocument()
})
