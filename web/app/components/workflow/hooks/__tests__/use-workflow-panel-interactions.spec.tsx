import type { Shape } from '../../store/workflow'
import { act } from '@testing-library/react'
import { useReactFlow } from 'reactflow'
import { createEdge, createNode, createWorkflowRunningData } from '../../__tests__/fixtures'
import { renderWorkflowFlowHook } from '../../__tests__/workflow-test-env'
import { ControlMode } from '../../types'
import { useWorkflowMoveMode } from '../use-workflow-panel-interactions'

const setup = (state: Partial<Shape> = {}) =>
  renderWorkflowFlowHook(
    () => ({
      mode: useWorkflowMoveMode(),
      flow: useReactFlow(),
    }),
    {
      nodes: [createNode({ id: 'a', data: { _isBundled: true } }), createNode({ id: 'b' })],
      edges: [createEdge({ source: 'a', target: 'b', data: { _isBundled: true } })],
      initialStoreState: { controlMode: ControlMode.Pointer, ...state },
    },
  )

it('allows hand and pointer modes while Builder keeps nodes read-only', () => {
  const { result, store } = setup({ workflowDraftSyncPhase: 'builder' })
  act(() => result.current.mode.handleModeHand())
  expect(store.getState().controlMode).toBe(ControlMode.Hand)
  act(() => result.current.mode.handleModePointer())
  expect(store.getState().controlMode).toBe(ControlMode.Pointer)
})

it('switches from pointer to hand and clears the real graph selection', () => {
  const { result, store } = setup()
  act(() => result.current.mode.handleModeHand())
  expect(store.getState().controlMode).toBe(ControlMode.Hand)
  expect(result.current.flow.getNode('a')?.data._isBundled).toBe(false)
  expect(result.current.flow.getEdges()[0]?.data._isBundled).toBe(false)
  act(() => result.current.mode.handleModePointer())
  expect(store.getState().controlMode).toBe(ControlMode.Pointer)
})

it('allows navigation and comments on a readonly canvas', () => {
  const { result, store } = setup({ canvasReadOnly: true })
  act(() => result.current.mode.handleModeHand())
  expect(store.getState().controlMode).toBe(ControlMode.Hand)
  expect(result.current.flow.getNode('a')?.data._isBundled).toBe(false)
  act(() => result.current.mode.handleModeComment())
  expect(store.getState().controlMode).toBe(ControlMode.Comment)
  expect(result.current.flow.getNode('a')?.data._isBundled).toBe(false)
  act(() => result.current.mode.handleModePointer())
  expect(store.getState().controlMode).toBe(ControlMode.Pointer)
})

it('preserves mode and graph selection while a workflow run blocks comments', () => {
  const { result, store } = setup({ workflowRunningData: createWorkflowRunningData() })
  act(() => result.current.mode.handleModeComment())
  expect(result.current.mode.canUseCommentMode).toBe(false)
  expect(store.getState().controlMode).toBe(ControlMode.Pointer)
  expect(result.current.flow.getNode('a')?.data._isBundled).toBe(true)
})
