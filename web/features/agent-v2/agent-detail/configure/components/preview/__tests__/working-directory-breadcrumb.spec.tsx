import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentWorkingDirectoryBreadcrumb } from '../working-directory-breadcrumb'

describe('AgentWorkingDirectoryBreadcrumb', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render the working directory path by default', () => {
      render(
        <AgentWorkingDirectoryBreadcrumb
          path="."
          onPathChange={vi.fn()}
        />,
      )

      expect(screen.getByRole('navigation', {
        name: 'agentV2.agentDetail.configure.workingDirectory.breadcrumbLabel',
      })).toBeInTheDocument()
      expect(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.workingDirectory.home',
      })).toBeInTheDocument()
      expect(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.workingDirectory.workingDirectory',
      })).toHaveAttribute('aria-current', 'page')
    })

    it('should render home as the current path when path is home', () => {
      render(
        <AgentWorkingDirectoryBreadcrumb
          path="../"
          onPathChange={vi.fn()}
        />,
      )

      expect(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.workingDirectory.home',
      })).toHaveAttribute('aria-current', 'page')
      expect(screen.queryByRole('button', {
        name: 'agentV2.agentDetail.configure.workingDirectory.workingDirectory',
      })).not.toBeInTheDocument()
    })

    it('should render the selected folder as the final breadcrumb layer', () => {
      render(
        <AgentWorkingDirectoryBreadcrumb
          path="web-game"
          onPathChange={vi.fn()}
        />,
      )

      expect(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.workingDirectory.home',
      })).toBeInTheDocument()
      expect(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.workingDirectory.workingDirectory',
      })).toBeInTheDocument()
      expect(screen.getByRole('button', {
        name: 'web-game',
      })).toHaveAttribute('aria-current', 'page')
    })

    it('should collapse middle breadcrumb layers when path is deeper than three layers', () => {
      render(
        <AgentWorkingDirectoryBreadcrumb
          path="web-game/src"
          onPathChange={vi.fn()}
        />,
      )

      expect(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.workingDirectory.home',
      })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '...' })).toBeInTheDocument()
      expect(screen.queryByRole('button', {
        name: 'agentV2.agentDetail.configure.workingDirectory.workingDirectory',
      })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'web-game' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'src' })).toHaveAttribute('aria-current', 'page')
    })
  })

  describe('User Interactions', () => {
    it('should request home path when home is clicked', async () => {
      const user = userEvent.setup()
      const handlePathChange = vi.fn()
      render(
        <AgentWorkingDirectoryBreadcrumb
          path="."
          onPathChange={handlePathChange}
        />,
      )

      await user.click(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.workingDirectory.home',
      }))

      expect(handlePathChange).toHaveBeenCalledWith('../')
    })

    it('should request working directory path when working directory is clicked', async () => {
      const user = userEvent.setup()
      const handlePathChange = vi.fn()
      render(
        <AgentWorkingDirectoryBreadcrumb
          path="."
          onPathChange={handlePathChange}
        />,
      )

      await user.click(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.workingDirectory.workingDirectory',
      }))

      expect(handlePathChange).toHaveBeenCalledWith('.')
    })

    it('should request a hidden breadcrumb path from the ellipsis menu', async () => {
      const user = userEvent.setup()
      const handlePathChange = vi.fn()
      render(
        <AgentWorkingDirectoryBreadcrumb
          path="web-game/src"
          onPathChange={handlePathChange}
        />,
      )

      await user.click(screen.getByRole('button', { name: '...' }))
      await user.click(screen.getByRole('menuitem', {
        name: 'agentV2.agentDetail.configure.workingDirectory.workingDirectory',
      }))

      expect(handlePathChange).toHaveBeenCalledWith('.')
    })
  })
})
