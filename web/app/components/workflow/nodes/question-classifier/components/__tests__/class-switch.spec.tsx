import type { Topic } from '@/app/components/workflow/nodes/_base/components/branch-list/types'
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
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import ClassList from '../../../_base/components/branch-list/class-list'

const renderClassList = (ui: React.ReactElement) => {
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
  const classifier = createNode({
    id: 'node-1',
    data: { title: 'Classifier', type: BlockEnum.QuestionClassifier },
  })

  return renderWorkflowFlowComponent(
    <EventEmitterContextProvider>{ui}</EventEmitterContextProvider>,
    {
      queryClient,
      nodes: [start, classifier],
      edges: [
        createEdge({
          source: start.id,
          target: classifier.id,
          data: { sourceType: BlockEnum.Start, targetType: BlockEnum.QuestionClassifier },
        }),
      ],
    },
  )
}

describe('question-classifier class switching', () => {
  it('allows clicking and typing in class 2 after editing class 1', async () => {
    const user = userEvent.setup()

    function Harness() {
      const [list, setList] = useState<Topic[]>([
        { id: '1', name: '', label: 'CLASS 1' },
        { id: '2', name: '', label: 'CLASS 2' },
      ])

      return <ClassList nodeId="node-1" list={list} onChange={setList} filterVar={() => true} />
    }

    renderClassList(<Harness />)

    const textboxes = screen.getAllByRole('textbox')
    expect(textboxes).toHaveLength(2)

    const [firstEditor, secondEditor] = textboxes

    // Step 1: Edit first editor
    await replacePromptEditorText(firstEditor!, '23')
    await waitFor(() => expect(firstEditor).toHaveTextContent('23'))

    // Step 2: Try to click second editor
    await user.click(secondEditor!)
    expect(secondEditor).toHaveFocus()

    // Step 3: Edit second editor
    await replacePromptEditorText(secondEditor!, '45')
    await waitFor(() => expect(secondEditor).toHaveTextContent('45'))
    expect(firstEditor).toHaveTextContent('23')
  })

  it('allows clicking and typing in class 2 after saving class 1 (Save -> click another class -> type)', async () => {
    const user = userEvent.setup()

    function SaveHarness() {
      const [list, setList] = useState<Topic[]>([
        { id: '1', name: '', label: 'CLASS 1' },
        { id: '2', name: '', label: 'CLASS 2' },
      ])
      const [savedList, setSavedList] = useState<Topic[] | null>(null)

      // Simulates persisting the updated category configuration and pushing down the synchronized post-save state
      const handleSave = () => {
        setSavedList([...list])
      }

      return (
        <div>
          <button type="button" onClick={handleSave}>
            Save
          </button>
          <ClassList
            nodeId="node-1"
            list={savedList ?? list}
            onChange={setList}
            filterVar={() => true}
          />
        </div>
      )
    }

    renderClassList(<SaveHarness />)

    const textboxes = screen.getAllByRole('textbox')
    expect(textboxes).toHaveLength(2)

    const [firstEditor, secondEditor] = textboxes

    // 1. Enter text into class 1
    await replacePromptEditorText(firstEditor!, '23')
    await waitFor(() => expect(firstEditor).toHaveTextContent('23'))

    // 2. Click Save to persist categories
    const saveButton = screen.getByRole('button', { name: 'Save' })
    await user.click(saveButton)

    // 3. Switch to class 2 after save
    await user.click(secondEditor!)
    expect(secondEditor).toHaveFocus()

    // 4. Edit class 2 smoothly
    await replacePromptEditorText(secondEditor!, '45')
    await waitFor(() => expect(secondEditor).toHaveTextContent('45'))
    expect(firstEditor).toHaveTextContent('23')
  })

  it('focuses the editor when clicking the container around it', async () => {
    const user = userEvent.setup()

    function Harness() {
      const [list, setList] = useState<Topic[]>([
        { id: '1', name: '', label: 'CLASS 1' },
        { id: '2', name: '', label: 'CLASS 2' },
      ])

      return <ClassList nodeId="node-1" list={list} onChange={setList} filterVar={() => true} />
    }

    renderClassList(<Harness />)

    const textboxes = screen.getAllByRole('textbox')
    const [firstEditor, secondEditor] = textboxes

    await replacePromptEditorText(firstEditor!, 'first class text')
    await waitFor(() => expect(firstEditor).toHaveTextContent('first class text'))

    // Click the parent container of the second editor
    const secondContainer = secondEditor!.closest('.relative.min-h-14')!
    await user.click(secondContainer)
    expect(secondEditor).toHaveFocus()
  })
})
