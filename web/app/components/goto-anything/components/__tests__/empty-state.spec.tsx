import { render, screen } from '@testing-library/react'
import EmptyState from '../empty-state'

describe('EmptyState', () => {
  describe('loading variant', () => {
    it('should render loading spinner', () => {
      render(<EmptyState variant="loading" />)

      expect(screen.getByText('app.gotoAnything.searching')).toBeInTheDocument()
    })

    it('should have spinner animation class', () => {
      const { container } = render(<EmptyState variant="loading" />)

      const spinner = container.querySelector('.animate-spin')
      expect(spinner).toBeInTheDocument()
    })
  })

  describe('error variant', () => {
    it('should render error message when error has message', () => {
      const error = new Error('Connection failed')
      render(<EmptyState variant="error" error={error} />)

      expect(screen.getByText('app.gotoAnything.searchFailed')).toBeInTheDocument()
      expect(screen.getByText('Connection failed')).toBeInTheDocument()
    })

    it('should render generic error when error has no message', () => {
      render(<EmptyState variant="error" error={null} />)

      expect(screen.getByText('app.gotoAnything.searchTemporarilyUnavailable')).toBeInTheDocument()
      expect(screen.getByText('app.gotoAnything.servicesUnavailableMessage')).toBeInTheDocument()
    })

    it('should render generic error when error is undefined', () => {
      render(<EmptyState variant="error" />)

      expect(screen.getByText('app.gotoAnything.searchTemporarilyUnavailable')).toBeInTheDocument()
    })

    it('should have red error text styling', () => {
      const error = new Error('Test error')
      const { container } = render(<EmptyState variant="error" error={error} />)

      const errorText = container.querySelector('.text-red-500')
      expect(errorText).toBeInTheDocument()
    })
  })

  describe('default variant', () => {
    it('should render search title', () => {
      render(<EmptyState variant="default" />)

      expect(screen.getByText('app.gotoAnything.searchTitle')).toBeInTheDocument()
    })

    it('should render all hint messages', () => {
      render(<EmptyState variant="default" />)

      expect(screen.getByText('app.gotoAnything.searchHint')).toBeInTheDocument()
      expect(screen.getByText('app.gotoAnything.commandHint')).toBeInTheDocument()
      expect(screen.getByText('app.gotoAnything.slashHint')).toBeInTheDocument()
    })
  })

  describe('no-results variant', () => {
    describe('general search mode', () => {
      it('should render generic no results message', () => {
        render(<EmptyState variant="no-results" searchMode="general" />)

        expect(screen.getByText('app.gotoAnything.noResults')).toBeInTheDocument()
      })

      it('should show specific search hint with shortcuts', () => {
        const Actions = {
          app: { key: '@app', shortcut: '@app' },
          plugin: { key: '@plugin', shortcut: '@plugin' },
        } as unknown as Record<string, import('../../actions/types').ActionItem>
        render(<EmptyState variant="no-results" searchMode="general" Actions={Actions} />)

        expect(screen.getByText('app.gotoAnything.emptyState.trySpecificSearch:{"shortcuts":"@app, @plugin"}')).toBeInTheDocument()
      })
    })

    describe('app search mode', () => {
      it('should render no apps found message', () => {
        render(<EmptyState variant="no-results" searchMode="@app" />)

        expect(screen.getByText('app.gotoAnything.emptyState.noAppsFound')).toBeInTheDocument()
      })

      it('should show try different term hint', () => {
        render(<EmptyState variant="no-results" searchMode="@app" />)

        expect(screen.getByText('app.gotoAnything.emptyState.tryDifferentTerm')).toBeInTheDocument()
      })
    })

    describe('plugin search mode', () => {
      it('should render no plugins found message', () => {
        render(<EmptyState variant="no-results" searchMode="@plugin" />)

        expect(screen.getByText('app.gotoAnything.emptyState.noPluginsFound')).toBeInTheDocument()
      })
    })

    describe('knowledge search mode', () => {
      it('should render no knowledge bases found message', () => {
        render(<EmptyState variant="no-results" searchMode="@knowledge" />)

        expect(screen.getByText('app.gotoAnything.emptyState.noKnowledgeBasesFound')).toBeInTheDocument()
      })
    })

    describe('node search mode', () => {
      it('should render no workflow nodes found message', () => {
        render(<EmptyState variant="no-results" searchMode="@node" />)

        expect(screen.getByText('app.gotoAnything.emptyState.noWorkflowNodesFound')).toBeInTheDocument()
      })
    })

    describe('unknown search mode', () => {
      it('should fallback to generic no results message', () => {
        render(<EmptyState variant="no-results" searchMode="@unknown" />)

        expect(screen.getByText('app.gotoAnything.noResults')).toBeInTheDocument()
      })
    })
  })

  describe('default props', () => {
    it('should use general as default searchMode', () => {
      render(<EmptyState variant="no-results" />)

      expect(screen.getByText('app.gotoAnything.noResults')).toBeInTheDocument()
    })

    it('should use empty object as default Actions', () => {
      render(<EmptyState variant="no-results" searchMode="general" />)

      expect(screen.getByText('app.gotoAnything.emptyState.trySpecificSearch:{"shortcuts":""}')).toBeInTheDocument()
    })
  })
})
