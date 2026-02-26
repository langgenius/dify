import { render } from '@testing-library/react'
import FileIcon from '.'

describe('File icon component', () => {
  const testCases = [
    { type: 'csv', icon: 'Csv' },
    { type: 'doc', icon: 'Doc' },
    { type: 'docx', icon: 'Docx' },
    { type: 'htm', icon: 'Html' },
    { type: 'html', icon: 'Html' },
    { type: 'md', icon: 'Md' },
    { type: 'mdx', icon: 'Md' },
    { type: 'markdown', icon: 'Md' },
    { type: 'pdf', icon: 'Pdf' },
    { type: 'xls', icon: 'Xlsx' },
    { type: 'xlsx', icon: 'Xlsx' },
    { type: 'notion', icon: 'Notion' },
    { type: 'something-else', icon: 'Unknown' },
    { type: 'txt', icon: 'Txt' },
    { type: 'json', icon: 'Json' },
  ]

  it.each(testCases)('renders $icon icon for type $type', ({ type, icon }) => {
    const { container } = render(<FileIcon type={type} />)
    const iconElement = container.querySelector(`[data-icon="${icon}"]`)
    expect(iconElement).toBeInTheDocument()
  })
})
