/**
 * Validation tests for renderWorkflowComponent and renderNodeComponent.
 */
import type { Shape } from '../store/workflow'
import { act, screen } from '@testing-library/react'
import * as React from 'react'
import { useNodes } from 'reactflow'
import { FlowType } from '@/types/common'
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
  const showConfirm = useStore(s => s.showConfirm)
  return React.createElement('div', { 'data-testid': 'store-reader' }, showConfirm ? 'has-confirm' : 'no-confirm')
}

function StoreWriter() {
  const store = useWorkflowStore()
  return React.createElement(
    'button',
    {
      'data-testid': 'store-writer',
      'onClick': () => store.setState({ showConfirm: { title: 'Test', onConfirm: () => {} } } as Partial<Shape>),
    },
    'Write',
  )
}

function HooksStoreReader() {
  const flowId = useHooksStore(s => s.configsMap?.flowId ?? 'none')
  return React.createElement('div', { 'data-testid': 'hooks-reader' }, flowId)
}

function NodeRenderer(props: { id: string, data: { title: string }, selected?: boolean }) {
  return React.createElement(
    'div',
    { 'data-testid': 'node-render' },
    `${props.id}:${props.data.title}:${props.selected ? 'sel' : 'nosel'}`,
  )
}

function FlowReader() {
  const nodes = useNodes()
  const showConfirm = useStore(s => s.showConfirm)
  return React.createElement('div', { 'data-testid': 'flow-reader' }, `${nodes.length}:${showConfirm ? 'confirm' : 'clear'}`)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderWorkflowComponent', () => {
  it('should provide WorkflowContext with default store', () => {
    renderWorkflowComponent(React.createElement(StoreReader))
    expect(screen.getByTestId('store-reader'))!.toHaveTextContent('no-confirm')
  })

  it('should apply initialStoreState', () => {
    renderWorkflowComponent(React.createElement(StoreReader), {
      initialStoreState: { showConfirm: { title: 'Hey', onConfirm: () => {} } },
    })
    expect(screen.getByTestId('store-reader'))!.toHaveTextContent('has-confirm')
  })

  it('should return a live store that components can mutate', () => {
    const { store } = renderWorkflowComponent(
      React.createElement(React.Fragment, null, React.createElement(StoreReader), React.createElement(StoreWriter)),
    )

    expect(store.getState().showConfirm).toBeUndefined()

    act(() => {
      screen.getByTestId('store-writer').click()
    })

    expect(store.getState().showConfirm).toBeDefined()
    expect(screen.getByTestId('store-reader'))!.toHaveTextContent('has-confirm')
  })

  it('should provide HooksStoreContext when hooksStoreProps given', () => {
    renderWorkflowComponent(React.createElement(HooksStoreReader), {
      hooksStoreProps: { configsMap: { flowId: 'test-123', flowType: FlowType.appFlow, fileSettings: {} } },
    })
    expect(screen.getByTestId('hooks-reader'))!.toHaveTextContent('test-123')
  })

  it('should throw when HooksStoreContext is not provided', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => {
        renderWorkflowComponent(React.createElement(HooksStoreReader))
      }).toThrow('Missing HooksStoreContext.Provider')
    }
    finally {
      consoleSpy.mockRestore()
    }
  })

  it('should forward extra render options (container)', () => {
    const container = document.createElement('section')
    document.body.appendChild(container)

    try {
      renderWorkflowComponent(React.createElement(StoreReader), { container })
      expect(container.querySelector('[data-testid="store-reader"]')).toBeTruthy()
    }
    finally {
      document.body.removeChild(container)
    }
  })
})

describe('renderNodeComponent', () => {
  it('should render node with default id and selected=false', () => {
    renderNodeComponent(NodeRenderer, { title: 'Hello' })
    expect(screen.getByTestId('node-render'))!.toHaveTextContent('test-node-1:Hello:nosel')
  })

  it('should accept custom nodeId and selected', () => {
    renderNodeComponent(NodeRenderer, { title: 'World' }, {
      nodeId: 'custom-42',
      selected: true,
    })
    expect(screen.getByTestId('node-render'))!.toHaveTextContent('custom-42:World:sel')
  })

  it('should provide WorkflowContext to node components', () => {
    function NodeWithStore(props: { id: string, data: Record<string, unknown> }) {
      const controlMode = useStore(s => s.controlMode)
      return React.createElement('div', { 'data-testid': 'node-store' }, `${props.id}:${controlMode}`)
    }

    renderNodeComponent(NodeWithStore, {}, {
      initialStoreState: { controlMode: 'hand' as Shape['controlMode'] },
    })
    expect(screen.getByTestId('node-store'))!.toHaveTextContent('test-node-1:hand')
  })
})

describe('renderWorkflowFlowComponent', () => {
  it('should provide both ReactFlow and Workflow contexts', () => {
    renderWorkflowFlowComponent(React.createElement(FlowReader), {
      nodes: [
        createNode({ id: 'n-1' }),
        createNode({ id: 'n-2' }),
      ],
      initialStoreState: { showConfirm: { title: 'Hey', onConfirm: () => {} } },
    })

    expect(screen.getByTestId('flow-reader'))!.toHaveTextContent('2:confirm')
  })
})

describe('renderWorkflowFlowHook', () => {
  it('should render hooks inside a real ReactFlow provider', () => {
    const { result } = renderWorkflowFlowHook(() => useNodes(), {
      nodes: [
        createNode({ id: 'flow-1' }),
      ],
    })

    expect(result.current).toHaveLength(1)
    expect(result.current[0]!.id).toBe('flow-1')
  })
})
