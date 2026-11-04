import { render, screen } from '@testing-library/react'
import DSLImportWarningDescription from '../dsl-import-warning-description'

describe('DSLImportWarningDescription', () => {
  it('should render each distinct warning on its own row', () => {
    render(
      <p>
        <DSLImportWarningDescription
          warnings={[
            { message: "Agent skill 'market-research-methodology' was not included." },
            { message: "Agent skill 'market-research-methodology' was not included." },
            { message: "Agent skill 'source-backed-market-reporting' was not included." },
            { message: "Agent tool 'jina_search' requires authorization." },
            { message: "Agent secret 'SEARCH_TOKEN' must be configured." },
          ]}
          fallback="Some configuration may need attention."
        />
      </p>,
    )

    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      "Agent skill 'market-research-methodology' was not included.",
      "Agent skill 'source-backed-market-reporting' was not included.",
      "Agent tool 'jina_search' requires authorization.",
      '…',
    ])
  })
})
