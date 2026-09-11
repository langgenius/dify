import type { DocumentProcessingTask } from '../../models'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { useAtomValueRawSync, useSetAtom } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { taskRuntimeStateAtom } from '../../state/scoped'
import { applyTaskRuntimeEventAtom, effectiveTasksAtom } from '../state'

const task: DocumentProcessingTask = {
  createdAt: '2026-07-20T10:00:00Z',
  documentId: 'document-1',
  documentRevision: 2,
  id: 'task-1',
  knowledgeSpaceId: 'space-1',
  operation: 'document_processing',
  progressPercent: 45,
  stage: 'parsed',
  state: 'running',
  taskKind: 'document',
  updatedAt: '2026-07-20T10:01:00Z',
}

vi.mock('../../state/queries', async () => {
  const { atom } = await import('jotai')
  return {
    baseTasksAtom: atom(() => [task]),
    backgroundTasksAtom: atom(() => [task]),
  }
})

function TaskProgress({ name }: { name: string }) {
  const tasks = useAtomValueRawSync(effectiveTasksAtom)
  const state = useAtomValueRawSync(taskRuntimeStateAtom)
  const apply = useSetAtom(applyTaskRuntimeEventAtom)
  return (
    <section aria-label={name}>
      <output>
        {tasks[0]?.state}: {tasks[0]?.progressPercent}
      </output>
      <span>{state.eventCursors.get(task.id) ?? 'no cursor'}</span>
      <button
        onClick={() => {
          apply({ tasks: [task], type: 'list-snapshot' })
          for (const [progressPercent, updatedAt] of [
            [80, '2026-07-20T10:03:00Z'],
            [60, '2026-07-20T10:02:00Z'],
          ] as const) {
            apply({
              type: 'task-snapshot',
              task: { ...task, progressPercent, updatedAt },
            })
          }
          apply({ type: 'event-cursor', taskId: task.id, eventId: 'resume-here' })
        }}
      >
        Receive progress
      </button>
      <button
        onClick={() =>
          apply({
            type: 'stream-event',
            taskId: task.id,
            taskVersion: '2026-07-20T10:04:00Z',
            event: { event: 'terminal', id: 'finished', data: { state: 'succeeded' } },
          })
        }
      >
        Complete
      </button>
    </section>
  )
}

it('keeps batched progress monotonic, retires terminal cursors, and isolates page sessions', () => {
  render(
    <>
      <ScopeProvider atoms={[taskRuntimeStateAtom]}>
        <TaskProgress name="left" />
      </ScopeProvider>
      <ScopeProvider atoms={[taskRuntimeStateAtom]}>
        <TaskProgress name="right" />
      </ScopeProvider>
    </>,
  )
  const left = within(screen.getByRole('region', { name: 'left' }))
  const right = within(screen.getByRole('region', { name: 'right' }))
  fireEvent.click(left.getByRole('button', { name: 'Receive progress' }))
  expect(left.getByRole('status')).toHaveTextContent('running: 80')
  expect(left.getByText('resume-here')).toBeVisible()
  expect(right.getByRole('status')).toHaveTextContent('running: 45')
  fireEvent.click(left.getByRole('button', { name: 'Complete' }))
  expect(left.getByRole('status')).toHaveTextContent('succeeded')
  expect(left.getByText('no cursor')).toBeVisible()
  expect(right.getByRole('status')).toHaveTextContent('running: 45')
})
