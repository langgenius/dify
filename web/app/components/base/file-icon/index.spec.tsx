import { render } from '@testing-library/react'
import FileIcon from '.'

describe('File icon component', () => {
  it('renders csv icon', () => {
    const { container } = render(<FileIcon type="csv" />)
    const icon = container.querySelector('[data-icon="Csv"]')
    expect(icon).toBeInTheDocument()
  })

  it('renders doc icon', () => {
    const { container } = render(<FileIcon type="doc" />)
    const icon = container.querySelector('[data-icon="Doc"]')
    expect(icon).toBeInTheDocument()
  })

  it('renders docx icon', () => {
    const { container } = render(<FileIcon type="docx" />)
    const icon = container.querySelector('[data-icon="Docx"]')
    expect(icon).toBeInTheDocument()
  })

  it('renders htm icon', () => {
    const { container } = render(<FileIcon type="htm" />)
    const icon = container.querySelector('[data-icon="Html"]')
    expect(icon).toBeInTheDocument()
  })

  it('renders html icon', () => {
    const { container } = render(<FileIcon type="html" />)
    const icon = container.querySelector('[data-icon="Html"]')
    expect(icon).toBeInTheDocument()
  })

  it('renders md icon', () => {
    const { container } = render(<FileIcon type="md" />)
    const icon = container.querySelector('[data-icon="Md"]')
    expect(icon).toBeInTheDocument()
  })

  it('renders mdx icon', () => {
    const { container } = render(<FileIcon type="mdx" />)
    const icon = container.querySelector('[data-icon="Md"]')
    expect(icon).toBeInTheDocument()
  })

  it('renders markdown icon', () => {
    const { container } = render(<FileIcon type="markdown" />)
    const icon = container.querySelector('[data-icon="Md"]')
    expect(icon).toBeInTheDocument()
  })

  it('renders pdf icon', () => {
    const { container } = render(<FileIcon type="pdf" />)
    const icon = container.querySelector('[data-icon="Pdf"]')
    expect(icon).toBeInTheDocument()
  })

  it('renders xls icon', () => {
    const { container } = render(<FileIcon type="xls" />)
    const icon = container.querySelector('[data-icon="Xlsx"]')
    expect(icon).toBeInTheDocument()
  })

  it('renders xlsx icon', () => {
    const { container } = render(<FileIcon type="xlsx" />)
    const icon = container.querySelector('[data-icon="Xlsx"]')
    expect(icon).toBeInTheDocument()
  })

  it('renders notion icon', () => {
    const { container } = render(<FileIcon type="notion" />)
    const icon = container.querySelector('[data-icon="Notion"]')
    expect(icon).toBeInTheDocument()
  })

  it('renders unknown icon', () => {
    const { container } = render(<FileIcon type="something-else" />)
    const icon = container.querySelector('[data-icon="Unknown"]')
    expect(icon).toBeInTheDocument()
  })

  it('renders txt icon', () => {
    const { container } = render(<FileIcon type="txt" />)
    const icon = container.querySelector('[data-icon="Txt"]')
    expect(icon).toBeInTheDocument()
  })

  it('renders json icon', () => {
    const { container } = render(<FileIcon type="json" />)
    const icon = container.querySelector('[data-icon="Json"]')
    expect(icon).toBeInTheDocument()
  })
})
