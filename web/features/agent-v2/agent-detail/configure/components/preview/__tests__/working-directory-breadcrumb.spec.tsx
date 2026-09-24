import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentWorkingDirectoryBreadcrumb } from '../working-directory-breadcrumb'

describe('AgentWorkingDirectoryBreadcrumb', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render the root path by default', () => {
      render(<AgentWorkingDirectoryBreadcrumb path="." onPathChange={vi.fn()} />)

      expect(
        screen.getByRole('navigation', {
          name: 'agentV2.agentDetail.configure.workingDirectory.breadcrumbLabel',
        }),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '.' })).toHaveAttribute('aria-current', 'location')
    })

    it('should render the saved-files root path', () => {
      render(<AgentWorkingDirectoryBreadcrumb path="~" onPathChange={vi.fn()} />)

      expect(screen.getByRole('button', { name: '~' })).toHaveAttribute('aria-current', 'location')
    })

    it('should render the saved-files prefix before its path segments', () => {
      render(<AgentWorkingDirectoryBreadcrumb path="~/web-game" onPathChange={vi.fn()} />)

      expect(screen.getByRole('button', { name: '~' })).toBeInTheDocument()
      expect(
        screen.getByRole('button', {
          name: 'web-game',
        }),
      ).toHaveAttribute('aria-current', 'location')
    })

    it('should collapse middle breadcrumb layers when path is deeper than three layers', () => {
      render(<AgentWorkingDirectoryBreadcrumb path="~/web-game/src/app" onPathChange={vi.fn()} />)

      expect(screen.getAllByRole('listitem')).toHaveLength(4)
      expect(screen.getByRole('button', { name: '~' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.more' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'web-game' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'src' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'app' })).toHaveAttribute(
        'aria-current',
        'location',
      )
    })
  })

  describe('User Interactions', () => {
    it('should request the saved-files root when its prefix is clicked', async () => {
      const user = userEvent.setup()
      const handlePathChange = vi.fn()
      render(<AgentWorkingDirectoryBreadcrumb path="~/web-game" onPathChange={handlePathChange} />)

      await user.click(screen.getByRole('button', { name: '~' }))

      expect(handlePathChange).toHaveBeenCalledWith('~')
    })

    it('should request the selected path segment when a breadcrumb item is clicked', async () => {
      const user = userEvent.setup()
      const handlePathChange = vi.fn()
      render(
        <AgentWorkingDirectoryBreadcrumb path="./web-game/src" onPathChange={handlePathChange} />,
      )

      await user.click(screen.getByRole('button', { name: 'web-game' }))

      expect(handlePathChange).toHaveBeenCalledWith('./web-game')
    })

    it('should request a hidden breadcrumb path from the ellipsis menu', async () => {
      const user = userEvent.setup()
      const handlePathChange = vi.fn()
      render(
        <AgentWorkingDirectoryBreadcrumb
          path="~/web-game/src/app"
          onPathChange={handlePathChange}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
      await user.click(
        screen.getByRole('menuitem', {
          name: 'web-game',
        }),
      )

      expect(handlePathChange).toHaveBeenCalledWith('~/web-game')
    })
  })
})
