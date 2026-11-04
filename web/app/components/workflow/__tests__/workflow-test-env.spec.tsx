/**
 * Validation tests for renderWorkflowComponent and renderNodeComponent.
 */
import type { Shape } from '../store/workflow'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { useNodes } from 'reactflow'
import { useHooksStore } from '../hooks-store/store'
import { useStore, useWorkflowStore } from '../store/workflow'
import { createNode } from './fixtures'
import {
  renderNodeComponent,
  renderWorkflowComponent,
  renderWorkflowFlowComponent,
  renderWorkflowFlowHook,
} from './workflow-test-env'

// ---------------------------------------------------------------------------
// Test components that read from workflow contexts
// ---------------------------------------------------------------------------

function StoreReader() {
  const showConfirm = useStore((s) => s.showConfirm)
  return React.createElement(
    'div',
    { 'data-testid': 'store-reader' },
    showConfirm ? 'has-confirm' : 'no-confirm',
  )
}

function StoreWriter() {
  const store = useWorkflowStore()
  return React.createElement(
    'button',
    {
      'data-testid': 'store-writer',
      onClick: () =>
        store.setState({ showConfirm: { title: 'Test', onConfirm: () => {} } } as Partial<Shape>),
    },
    'Write',
  )
}

function HooksStoreReader() {
  const fileSettings = useHooksStore((s) => s.fileSettings)
  return React.createElement(
    'div',
    { 'data-testid': 'hooks-reader' },
    fileSettings ? 'configured' : 'none',
  )
}

function NodeRenderer(props: { id: string; data: { title: string }; selected?: boolean }) {
  return React.createElement(
    'div',
    { 'data-testid': 'node-render' },
    `${props.id}:${props.data.title}:${props.selected ? 'sel' : 'nosel'}`,
  )
}

function FlowReader() {
  const nodes = useNodes()
  const showConfirm = useStore((s) => s.showConfirm)
  return React.createElement(
    'div',
    { 'data-testid': 'flow-reader' },
    `${nodes.length}:${showConfirm ? 'confirm' : 'clear'}`,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderWorkflowComponent', () => {
  it('should return a live store that components can mutate', async () => {
    const user = userEvent.setup()
    const { store } = renderWorkflowComponent(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(StoreReader),
        React.createElement(StoreWriter),
      ),
    )

    expect(store.getState().showConfirm).toBeUndefined()

    await user.click(screen.getByRole('button', { name: 'Write' }))

    expect(store.getState().showConfirm).toBeDefined()
    expect(screen.getByTestId('store-reader'))!.toHaveTextContent('has-confirm')
  })

  it('should provide HooksStoreContext when hooksStoreProps given', () => {
    renderWorkflowComponent(React.createElement(HooksStoreReader), {
      resource: { kind: 'app' as const, appId: 'test-123', mode: 'workflow' as const },
      hooksStoreProps: {
        fileSettings: {},
      },
    })
    expect(screen.getByTestId('hooks-reader'))!.toHaveTextContent('configured')
  })
})

describe('renderNodeComponent', () => {
  it('should accept custom nodeId and selected', () => {
    renderNodeComponent(
      NodeRenderer,
      { title: 'World' },
      {
        nodeId: 'custom-42',
        selected: true,
      },
    )
    expect(screen.getByTestId('node-render'))!.toHaveTextContent('custom-42:World:sel')
  })

  it('should provide WorkflowContext to node components', () => {
    function NodeWithStore(props: { id: string; data: Record<string, unknown> }) {
      const controlMode = useStore((s) => s.controlMode)
      return React.createElement(
        'div',
        { 'data-testid': 'node-store' },
        `${props.id}:${controlMode}`,
      )
    }

    renderNodeComponent(
      NodeWithStore,
      {},
      {
        initialStoreState: { controlMode: 'hand' as Shape['controlMode'] },
      },
    )
    expect(screen.getByTestId('node-store'))!.toHaveTextContent('test-node-1:hand')
  })
})

describe('renderWorkflowFlowComponent', () => {
  it('should provide both ReactFlow and Workflow contexts', () => {
    renderWorkflowFlowComponent(React.createElement(FlowReader), {
      nodes: [createNode({ id: 'n-1' }), createNode({ id: 'n-2' })],
      initialStoreState: { showConfirm: { title: 'Hey', onConfirm: () => {} } },
    })

    expect(screen.getByTestId('flow-reader'))!.toHaveTextContent('2:confirm')
  })
})

describe('renderWorkflowFlowHook', () => {
  it('should render hooks inside a real ReactFlow provider', () => {
    const { result } = renderWorkflowFlowHook(() => useNodes(), {
      nodes: [createNode({ id: 'flow-1' })],
    })

    expect(result.current).toHaveLength(1)
    expect(result.current[0]!.id).toBe('flow-1')
  })
})
