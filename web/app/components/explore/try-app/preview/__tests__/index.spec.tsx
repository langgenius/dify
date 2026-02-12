import type { TryAppInfo } from '@/service/try-app'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Preview from '../index'

vi.mock('../basic-app-preview', () => ({
  default: ({ appId }: { appId: string }) => (
    <div data-testid="basic-app-preview" data-app-id={appId}>
      BasicAppPreview
    </div>
  ),
}))

vi.mock('../flow-app-preview', () => ({
  default: ({ appId, className }: { appId: string, className?: string }) => (
    <div data-testid="flow-app-preview" data-app-id={appId} className={className}>
      FlowAppPreview
    </div>
  ),
}))

const createMockAppDetail = (mode: string): TryAppInfo => ({
  id: 'test-app-id',
  name: 'Test App',
  description: 'Test Description',
  mode,
  site: {
    title: 'Test Site Title',
    icon: 'icon',
    icon_type: 'emoji',
    icon_background: '#FFFFFF',
    icon_url: '',
  },
  model_config: {
    model: {
      provider: 'test/provider',
      name: 'test-model',
      mode: 'chat',
    },
    dataset_configs: {
      datasets: {
        datasets: [],
      },
    },
    agent_mode: {
      tools: [],
    },
    user_input_form: [],
  },
} as unknown as TryAppInfo)

describe('Preview', () => {
  afterEach(() => {
    cleanup()
  })

  describe('basic app rendering', () => {
    it('renders BasicAppPreview for agent-chat mode', () => {
      const appDetail = createMockAppDetail('agent-chat')
      render(<Preview appId="test-app-id" appDetail={appDetail} />)

      expect(screen.getByTestId('basic-app-preview')).toBeInTheDocument()
      expect(screen.queryByTestId('flow-app-preview')).not.toBeInTheDocument()
    })

    it('renders BasicAppPreview for chat mode', () => {
      const appDetail = createMockAppDetail('chat')
      render(<Preview appId="test-app-id" appDetail={appDetail} />)

      expect(screen.getByTestId('basic-app-preview')).toBeInTheDocument()
      expect(screen.queryByTestId('flow-app-preview')).not.toBeInTheDocument()
    })

    it('renders BasicAppPreview for completion mode', () => {
      const appDetail = createMockAppDetail('completion')
      render(<Preview appId="test-app-id" appDetail={appDetail} />)

      expect(screen.getByTestId('basic-app-preview')).toBeInTheDocument()
      expect(screen.queryByTestId('flow-app-preview')).not.toBeInTheDocument()
    })

    it('passes appId to BasicAppPreview', () => {
      const appDetail = createMockAppDetail('chat')
      render(<Preview appId="my-app-id" appDetail={appDetail} />)

      const basicPreview = screen.getByTestId('basic-app-preview')
      expect(basicPreview).toHaveAttribute('data-app-id', 'my-app-id')
    })
  })

  describe('flow app rendering', () => {
    it('renders FlowAppPreview for workflow mode', () => {
      const appDetail = createMockAppDetail('workflow')
      render(<Preview appId="test-app-id" appDetail={appDetail} />)

      expect(screen.getByTestId('flow-app-preview')).toBeInTheDocument()
      expect(screen.queryByTestId('basic-app-preview')).not.toBeInTheDocument()
    })

    it('renders FlowAppPreview for advanced-chat mode', () => {
      const appDetail = createMockAppDetail('advanced-chat')
      render(<Preview appId="test-app-id" appDetail={appDetail} />)

      expect(screen.getByTestId('flow-app-preview')).toBeInTheDocument()
      expect(screen.queryByTestId('basic-app-preview')).not.toBeInTheDocument()
    })

    it('passes appId and className to FlowAppPreview', () => {
      const appDetail = createMockAppDetail('workflow')
      render(<Preview appId="my-flow-app-id" appDetail={appDetail} />)

      const flowPreview = screen.getByTestId('flow-app-preview')
      expect(flowPreview).toHaveAttribute('data-app-id', 'my-flow-app-id')
      expect(flowPreview).toHaveClass('h-full')
    })
  })

  describe('wrapper styling', () => {
    it('renders with correct wrapper classes', () => {
      const appDetail = createMockAppDetail('chat')
      const { container } = render(<Preview appId="test-app-id" appDetail={appDetail} />)

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('h-full', 'w-full')
    })
  })
})
