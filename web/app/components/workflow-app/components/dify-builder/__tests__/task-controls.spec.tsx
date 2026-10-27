import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDifyBuilderRuntime } from '@/test/fixtures/dify-builder'
import DifyBuilderComposer from '../composer'
import { createSessionView } from '../session/__tests__/fixtures'
import {
  difyBuilderSessionBusyAtom,
  difyBuilderSessionViewAtom,
  difyBuilderTaskControlAtom,
} from '../session/state'
import {
  difyBuilderCanvasAppliedViewAtom,
  difyBuilderDraftAtom,
  difyBuilderRuntimeAtom,
} from '../store'
import { createBuilderQueryClient } from './model-fixtures'

const renderComposer = (paused = false) => {
  const store = createStore()
  const queryClient = createBuilderQueryClient()
  const stopTask = vi.fn(async () => {
    store.set(difyBuilderTaskControlAtom, { operation: 'stop', phase: 'pending' })
    return true
  })
  const resumeTask = vi.fn(async () => {
    store.set(difyBuilderTaskControlAtom, { operation: 'resume', phase: 'saving' })
    return true
  })
  const runtime = createDifyBuilderRuntime({ session: { stopTask, resumeTask } })
  const view = createSessionView({
    phase: 'test',
    run_status: paused ? 'paused' : 'processing',
    canvas_read_only: !paused,
    actions: [],
  })
  store.set(queryClientAtom, queryClient)
  store.set(difyBuilderRuntimeAtom, runtime)
  store.set(difyBuilderSessionViewAtom, view)
  store.set(difyBuilderCanvasAppliedViewAtom, { sessionId: view.session_id, version: view.version })
  store.set(difyBuilderSessionBusyAtom, !paused)
  store.set(difyBuilderDraftAtom, 'Keep my draft')
  renderWithConsoleQuery(
    <Provider store={store}>
      <DifyBuilderComposer />
    </Provider>,
    { queryClient },
  )
  return { store, stopTask, resumeTask }
}

it('provides an icon-only Stop during execution and blocks repeat activation while stopping', async () => {
  const user = userEvent.setup()
  const { store, stopTask } = renderComposer()
  const stop = screen.getByRole('button', { name: 'difyBuilder.taskControl.stop' })
  expect(stop).toHaveTextContent('')
  expect(stop).toBeEnabled()
  expect(stop).toHaveAccessibleDescription('difyBuilder.taskControl.running')
  expect(screen.queryByRole('button', { name: 'difyBuilder.messageSend' })).not.toBeInTheDocument()

  await user.click(stop)
  expect(stopTask).toHaveBeenCalledOnce()
  expect(stop).toHaveAttribute('aria-disabled', 'true')
  expect(stop).toHaveAccessibleDescription('difyBuilder.taskControl.stopping')
  await user.click(stop)
  expect(stopTask).toHaveBeenCalledOnce()
  expect(store.get(difyBuilderDraftAtom)).toBe('Keep my draft')
})

it('provides icon-only Resume with empty server actions and retains the unsent draft while saving', async () => {
  const user = userEvent.setup()
  const { store, resumeTask } = renderComposer(true)
  const resume = screen.getByRole('button', { name: 'difyBuilder.taskControl.resume' })
  expect(resume).toHaveTextContent('')
  expect(resume).toBeEnabled()
  expect(resume).toHaveAccessibleDescription('difyBuilder.taskControl.paused')
  expect(screen.getByRole('textbox')).toBeDisabled()
  await user.click(resume)
  expect(resumeTask).toHaveBeenCalledOnce()
  expect(resume).toHaveAttribute('aria-disabled', 'true')
  expect(resume).toHaveAccessibleDescription('difyBuilder.taskControl.saving')
  expect(store.get(difyBuilderDraftAtom)).toBe('Keep my draft')
})

it('offers the same control for an uncertain request and announces that its status is unknown', async () => {
  const user = userEvent.setup()
  const { store, stopTask } = renderComposer()
  act(() => {
    store.set(difyBuilderSessionBusyAtom, false)
    store.set(difyBuilderTaskControlAtom, { operation: 'stop', phase: 'unknown' })
  })
  expect(
    screen.getByRole('button', { name: 'difyBuilder.taskControl.stop' }),
  ).toHaveAccessibleDescription('difyBuilder.taskControl.unknown')
  expect(
    screen.queryByRole('button', { name: 'difyBuilder.taskControl.resume' }),
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'difyBuilder.taskControl.stop' }))
  expect(stopTask).toHaveBeenCalledOnce()
})

it('does not turn the second click of a fast Resume double-click into Stop', async () => {
  const user = userEvent.setup()
  const { store, stopTask, resumeTask } = renderComposer(true)
  resumeTask.mockImplementation(async () => {
    store.set(difyBuilderSessionViewAtom, createSessionView({ version: 2 }))
    return true
  })
  await user.dblClick(screen.getByRole('button', { name: 'difyBuilder.taskControl.resume' }))
  expect(resumeTask).toHaveBeenCalledOnce()
  expect(stopTask).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'difyBuilder.taskControl.stop' })).toBeEnabled()
})
