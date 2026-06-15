import { render, screen } from '@testing-library/react'
import Footer from '../footer'

describe('Footer', () => {
  describe('left content', () => {
    describe('when there are results', () => {
      it('should show result count', () => {
        render(
          <Footer
            resultCount={5}
            searchMode="general"
            isError={false}
            isCommandsMode={false}
            hasQuery={true}
          />,
        )

        expect(screen.getByText('app.gotoAnything.resultCount:{"count":5}')).toBeInTheDocument()
      })

      it('should show scope when not in general mode', () => {
        render(
          <Footer
            resultCount={3}
            searchMode="@app"
            isError={false}
            isCommandsMode={false}
            hasQuery={true}
          />,
        )

        expect(screen.getByText('app.gotoAnything.inScope:{"scope":"app"}')).toBeInTheDocument()
      })

      it('should NOT show scope when in general mode', () => {
        render(
          <Footer
            resultCount={3}
            searchMode="general"
            isError={false}
            isCommandsMode={false}
            hasQuery={true}
          />,
        )

        expect(screen.queryByText(/inScope/)).not.toBeInTheDocument()
      })
    })

    describe('when there is an error', () => {
      it('should show error message', () => {
        render(
          <Footer
            resultCount={0}
            searchMode="general"
            isError={true}
            isCommandsMode={false}
            hasQuery={true}
          />,
        )

        expect(screen.getByText('app.gotoAnything.someServicesUnavailable')).toBeInTheDocument()
      })

      it('should have red text styling', () => {
        const { container } = render(
          <Footer
            resultCount={0}
            searchMode="general"
            isError={true}
            isCommandsMode={false}
            hasQuery={true}
          />,
        )

        const errorText = container.querySelector('.text-red-500')
        expect(errorText).toBeInTheDocument()
      })

      it('should show error even with results', () => {
        render(
          <Footer
            resultCount={5}
            searchMode="general"
            isError={true}
            isCommandsMode={false}
            hasQuery={true}
          />,
        )

        expect(screen.getByText('app.gotoAnything.someServicesUnavailable')).toBeInTheDocument()
      })
    })

    describe('when no results and no error', () => {
      it('should show select to navigate in commands mode', () => {
        render(
          <Footer
            resultCount={0}
            searchMode="general"
            isError={false}
            isCommandsMode={true}
            hasQuery={false}
          />,
        )

        expect(screen.getByText('app.gotoAnything.selectToNavigate')).toBeInTheDocument()
      })

      it('should show searching when has query', () => {
        render(
          <Footer
            resultCount={0}
            searchMode="general"
            isError={false}
            isCommandsMode={false}
            hasQuery={true}
          />,
        )

        expect(screen.getByText('app.gotoAnything.searching')).toBeInTheDocument()
      })

      it('should show start typing when no query', () => {
        render(
          <Footer
            resultCount={0}
            searchMode="general"
            isError={false}
            isCommandsMode={false}
            hasQuery={false}
          />,
        )

        expect(screen.getByText('app.gotoAnything.startTyping')).toBeInTheDocument()
      })
    })
  })

  describe('right content', () => {
    describe('when there are results or error', () => {
      it('should show clear to search all when in specific mode', () => {
        render(
          <Footer
            resultCount={5}
            searchMode="@app"
            isError={false}
            isCommandsMode={false}
            hasQuery={true}
          />,
        )

        expect(screen.getByText('app.gotoAnything.clearToSearchAll')).toBeInTheDocument()
      })

      it('should show use @ for specific when in general mode', () => {
        render(
          <Footer
            resultCount={5}
            searchMode="general"
            isError={false}
            isCommandsMode={false}
            hasQuery={true}
          />,
        )

        expect(screen.getByText('app.gotoAnything.useAtForSpecific')).toBeInTheDocument()
      })

      it('should show same hint when error', () => {
        render(
          <Footer
            resultCount={0}
            searchMode="general"
            isError={true}
            isCommandsMode={false}
            hasQuery={true}
          />,
        )

        expect(screen.getByText('app.gotoAnything.useAtForSpecific')).toBeInTheDocument()
      })
    })

    describe('when no results and no error', () => {
      it('should show tips when has query', () => {
        render(
          <Footer
            resultCount={0}
            searchMode="general"
            isError={false}
            isCommandsMode={false}
            hasQuery={true}
          />,
        )

        expect(screen.getByText('app.gotoAnything.tips')).toBeInTheDocument()
      })

      it('should show tips when in commands mode', () => {
        render(
          <Footer
            resultCount={0}
            searchMode="general"
            isError={false}
            isCommandsMode={true}
            hasQuery={false}
          />,
        )

        expect(screen.getByText('app.gotoAnything.tips')).toBeInTheDocument()
      })

      it('should show press ESC to close when no query and not in commands mode', () => {
        render(
          <Footer
            resultCount={0}
            searchMode="general"
            isError={false}
            isCommandsMode={false}
            hasQuery={false}
          />,
        )

        expect(screen.getByText('app.gotoAnything.pressEscToClose')).toBeInTheDocument()
      })
    })
  })

  describe('styling', () => {
    it('should have border and background classes', () => {
      const { container } = render(
        <Footer
          resultCount={0}
          searchMode="general"
          isError={false}
          isCommandsMode={false}
          hasQuery={false}
        />,
      )

      const footer = container.firstChild
      expect(footer).toHaveClass('border-t', 'border-divider-subtle', 'bg-components-panel-bg-blur')
    })

    it('should have flex layout for content', () => {
      const { container } = render(
        <Footer
          resultCount={0}
          searchMode="general"
          isError={false}
          isCommandsMode={false}
          hasQuery={false}
        />,
      )

      const flexContainer = container.querySelector('.flex.items-center.justify-between')
      expect(flexContainer).toBeInTheDocument()
    })
  })
})
