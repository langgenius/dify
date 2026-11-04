import type { WorkflowAppState, WorkflowAppStore } from '../store/workflow'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store'
import {
  renderWorkflowCanvasHook as renderCanvasHook,
  renderWorkflowComponent as renderComponent,
  renderWorkflowFlowComponent as renderFlowComponent,
  renderWorkflowFlowHook as renderFlowHook,
  renderWorkflowHook as renderHook,
} from '@/app/components/workflow/__tests__/workflow-test-env'
import { createWorkflowSlice } from '../store/workflow/workflow-slice'
import { createWorkflowAppStore } from './workflow-store'

export function createTestWorkflowStore(initialState?: Partial<WorkflowAppState>) {
  const store = createWorkflowAppStore()
  if (initialState) store.setState(initialState)
  return store
}

const appSlice = createWorkflowSlice as InjectWorkflowStoreSliceFn

export function renderWorkflowHook<R, P = undefined>(
  hook: (props: P) => R,
  options?: Parameters<typeof renderHook<R, P>>[1],
) {
  const view = renderHook(hook, { ...options, injectWorkflowStoreSliceFn: appSlice })
  return { ...view, store: view.store as WorkflowAppStore }
}

export function renderWorkflowCanvasHook<R, P = undefined>(
  hook: (props: P) => R,
  options?: Parameters<typeof renderCanvasHook<R, P>>[1],
) {
  const view = renderCanvasHook(hook, { ...options, injectWorkflowStoreSliceFn: appSlice })
  return { ...view, store: view.store as WorkflowAppStore }
}

export function renderWorkflowFlowHook<R, P = undefined>(
  hook: (props: P) => R,
  options?: Parameters<typeof renderFlowHook<R, P>>[1],
) {
  const view = renderFlowHook(hook, { ...options, injectWorkflowStoreSliceFn: appSlice })
  return { ...view, store: view.store as WorkflowAppStore }
}

export function renderWorkflowComponent(
  ui: React.ReactElement,
  options?: Parameters<typeof renderComponent>[1],
) {
  const view = renderComponent(ui, { ...options, injectWorkflowStoreSliceFn: appSlice })
  return { ...view, store: view.store as WorkflowAppStore }
}

export function renderWorkflowFlowComponent(
  ui: React.ReactElement,
  options?: Parameters<typeof renderFlowComponent>[1],
) {
  const view = renderFlowComponent(ui, { ...options, injectWorkflowStoreSliceFn: appSlice })
  return { ...view, store: view.store as WorkflowAppStore }
}
