import type { Topic } from '../types'
import { useState } from 'react'
import ReactFlow from 'reactflow'
import { onTestFinished } from 'vite-plus/test'
import { page, userEvent } from 'vite-plus/test/browser'
import {
  createEdge,
  createNode,
  createStartNode,
} from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowBrowserComponent } from '@/app/components/workflow/__tests__/workflow-browser-test-env'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import ClassList from '../class-list'

async function renderBrowserClassList(ui: React.ReactElement) {
  onTestFinished(guardUnexpectedFetch())
  await page.viewport(800, 600)

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

  return renderWorkflowBrowserComponent(
    <EventEmitterContextProvider>
      <ReactFlow
        style={{ width: 400, height: 120 }}
        defaultNodes={[start, classifier]}
        defaultEdges={[
          createEdge({
            source: start.id,
            target: classifier.id,
            data: { sourceType: BlockEnum.Start, targetType: BlockEnum.QuestionClassifier },
          }),
        ]}
      />
      <div style={{ width: 400, padding: 24 }}>{ui}</div>
    </EventEmitterContextProvider>,
  )
}

describe('branch-list ClassList browser interactions', () => {
  it('reorders items when dragging the header label button onto an earlier item', async () => {
    function SortHarness() {
      const [list, setList] = useState<Topic[]>([
        { id: 'accepted', name: 'Accept', label: 'Accepted' },
        { id: 'rejected', name: 'Reject', label: 'Rejected' },
      ])

      return (
        <ClassList
          nodeId="node-1"
          list={list}
          onChange={setList}
          handleSortTopic={setList}
          filterVar={() => true}
        />
      )
    }

    const screen = await renderBrowserClassList(<SortHarness />)
    const accepted = screen.getByRole('button', { name: 'Accepted', exact: true })
    const rejected = screen.getByRole('button', { name: 'Rejected', exact: true })

    await expect.element(accepted).toBeVisible()
    await expect.element(rejected).toBeVisible()

    // Matches the E2E pointer drag target (`rejected.dragTo(accepted)` on the header label button).
    await userEvent.dragAndDrop(rejected, accepted)

    await expect
      .poll(() =>
        screen
          .getByRole('button', { name: /^(?:Rejected|Accepted)$/ })
          .elements()
          .map((element) => element.textContent?.trim()),
      )
      .toEqual(['Rejected', 'Accepted'])
  })

  it('switches focus and edits across class editors and saves when sorting is enabled', async () => {
    function SaveHarness() {
      const [list, setList] = useState<Topic[]>([
        { id: '1', name: '', label: 'CLASS 1' },
        { id: '2', name: '', label: 'CLASS 2' },
      ])
      const [savedList, setSavedList] = useState<Topic[] | null>(null)

      return (
        <div>
          <button type="button" onClick={() => setSavedList(list.map((item) => ({ ...item })))}>
            Save
          </button>
          <ClassList
            nodeId="node-1"
            list={savedList ?? list}
            onChange={(next) => {
              setList(next)
              setSavedList(null)
            }}
            handleSortTopic={setList}
            filterVar={() => true}
          />
        </div>
      )
    }

    const screen = await renderBrowserClassList(<SaveHarness />)
    const textboxes = screen.getByRole('textbox')
    const firstEditor = textboxes.nth(0)
    const secondEditor = textboxes.nth(1)

    await firstEditor.click()
    await expect.element(firstEditor).toHaveFocus()
    await userEvent.keyboard('First topic')
    await expect.element(firstEditor).toHaveTextContent('First topic')

    await screen.getByRole('button', { name: 'Save', exact: true }).click()

    // Click the container's left padding (`px-3`) around the second prompt editor rather than `[contenteditable]`.
    const secondEditable = secondEditor.element()
    const secondContainer = secondEditable.parentElement?.parentElement
    if (!secondContainer || secondContainer === secondEditable)
      throw new Error('Expected prompt editor wrapper container around contenteditable')
    const rect = secondContainer.getBoundingClientRect()
    await userEvent.click(secondContainer, {
      position: { x: 4, y: Math.max(rect.height / 2, 4) },
    })

    await expect.element(secondEditor).toHaveFocus()
    await userEvent.keyboard('Second topic')
    await expect.element(secondEditor).toHaveTextContent('Second topic')
    await expect.element(firstEditor).toHaveTextContent('First topic')
  })

  it('allows renaming a class label inside the draggable header without capturing input interaction', async () => {
    function RenameHarness() {
      const [list, setList] = useState<Topic[]>([
        { id: '1', name: '', label: 'CLASS 1' },
        { id: '2', name: '', label: 'CLASS 2' },
      ])

      return (
        <ClassList
          nodeId="node-1"
          list={list}
          onChange={setList}
          handleSortTopic={setList}
          filterVar={() => true}
        />
      )
    }

    const screen = await renderBrowserClassList(<RenameHarness />)
    const firstLabel = screen.getByRole('button', { name: 'CLASS 1', exact: true })
    await userEvent.dblClick(firstLabel)

    const renameInput = screen.getByRole('textbox', {
      name: 'workflowModels.nodes.questionClassifiers.labelEditorAriaLabel',
    })
    await expect.element(renameInput).toHaveFocus()
    await renameInput.fill('Billing')
    await userEvent.keyboard('{Enter}')

    await expect.element(screen.getByRole('button', { name: 'Billing', exact: true })).toBeVisible()
  })
})
