import type { TryAppInfo } from '@/service/try-app'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TryApp from '../index'

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

vi.mock('../chat', () => ({
  default: ({ appId, appDetail, className }: { appId: string, appDetail: TryAppInfo, className: string }) => (
    <div data-testid="chat-component" data-app-id={appId} data-mode={appDetail.mode} className={className}>
      Chat Component
    </div>
  ),
}))

vi.mock('../text-generation', () => ({
  default: ({
    appId,
    className,
    isWorkflow,
    appData,
  }: { appId: string, className: string, isWorkflow: boolean, appData: { mode: string } }) => (
    <div
      data-testid="text-generation-component"
      data-app-id={appId}
      data-is-workflow={isWorkflow}
      data-mode={appData?.mode}
      className={className}
    >
      TextGeneration Component
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

describe('TryApp (app/index.tsx)', () => {
  afterEach(() => {
    cleanup()
  })

  describe('chat mode rendering', () => {
    it('renders Chat component for chat mode', () => {
      const appDetail = createMockAppDetail('chat')
      render(<TryApp appId="test-app-id" appDetail={appDetail} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
      expect(screen.queryByTestId('text-generation-component')).not.toBeInTheDocument()
    })

    it('renders Chat component for advanced-chat mode', () => {
      const appDetail = createMockAppDetail('advanced-chat')
      render(<TryApp appId="test-app-id" appDetail={appDetail} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
      expect(screen.queryByTestId('text-generation-component')).not.toBeInTheDocument()
    })

    it('renders Chat component for agent-chat mode', () => {
      const appDetail = createMockAppDetail('agent-chat')
      render(<TryApp appId="test-app-id" appDetail={appDetail} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
      expect(screen.queryByTestId('text-generation-component')).not.toBeInTheDocument()
    })

    it('passes correct props to Chat component', () => {
      const appDetail = createMockAppDetail('chat')
      render(<TryApp appId="test-app-id" appDetail={appDetail} />)

      const chatComponent = screen.getByTestId('chat-component')
      expect(chatComponent).toHaveAttribute('data-app-id', 'test-app-id')
      expect(chatComponent).toHaveAttribute('data-mode', 'chat')
      expect(chatComponent).toHaveClass('h-full', 'grow')
    })
  })

  describe('completion mode rendering', () => {
    it('renders TextGeneration component for completion mode', () => {
      const appDetail = createMockAppDetail('completion')
      render(<TryApp appId="test-app-id" appDetail={appDetail} />)

      expect(screen.getByTestId('text-generation-component')).toBeInTheDocument()
      expect(screen.queryByTestId('chat-component')).not.toBeInTheDocument()
    })

    it('renders TextGeneration component for workflow mode', () => {
      const appDetail = createMockAppDetail('workflow')
      render(<TryApp appId="test-app-id" appDetail={appDetail} />)

      expect(screen.getByTestId('text-generation-component')).toBeInTheDocument()
      expect(screen.queryByTestId('chat-component')).not.toBeInTheDocument()
    })

    it('passes isWorkflow=true for workflow mode', () => {
      const appDetail = createMockAppDetail('workflow')
      render(<TryApp appId="test-app-id" appDetail={appDetail} />)

      const textGenComponent = screen.getByTestId('text-generation-component')
      expect(textGenComponent).toHaveAttribute('data-is-workflow', 'true')
    })

    it('passes isWorkflow=false for completion mode', () => {
      const appDetail = createMockAppDetail('completion')
      render(<TryApp appId="test-app-id" appDetail={appDetail} />)

      const textGenComponent = screen.getByTestId('text-generation-component')
      expect(textGenComponent).toHaveAttribute('data-is-workflow', 'false')
    })

    it('passes correct props to TextGeneration component', () => {
      const appDetail = createMockAppDetail('completion')
      render(<TryApp appId="test-app-id" appDetail={appDetail} />)

      const textGenComponent = screen.getByTestId('text-generation-component')
      expect(textGenComponent).toHaveAttribute('data-app-id', 'test-app-id')
      expect(textGenComponent).toHaveClass('h-full', 'grow')
    })
  })

  describe('document title', () => {
    it('calls useDocumentTitle with site title', async () => {
      const useDocumentTitle = (await import('@/hooks/use-document-title')).default
      const appDetail = createMockAppDetail('chat')
      appDetail.site.title = 'My App Title'

      render(<TryApp appId="test-app-id" appDetail={appDetail} />)

      expect(useDocumentTitle).toHaveBeenCalledWith('My App Title')
    })

    it('calls useDocumentTitle with empty string when site.title is undefined', async () => {
      const useDocumentTitle = (await import('@/hooks/use-document-title')).default
      const appDetail = createMockAppDetail('chat')
      appDetail.site = undefined as unknown as TryAppInfo['site']

      render(<TryApp appId="test-app-id" appDetail={appDetail} />)

      expect(useDocumentTitle).toHaveBeenCalledWith('')
    })
  })

  describe('wrapper styling', () => {
    it('renders with correct wrapper classes', () => {
      const appDetail = createMockAppDetail('chat')
      const { container } = render(<TryApp appId="test-app-id" appDetail={appDetail} />)

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex', 'h-full', 'w-full')
    })
  })
})
