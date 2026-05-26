import type { CodeNodeType } from '../types'
import { render } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import Node from '../node'
import { CodeLanguage } from '../types'

const createData = (overrides: Partial<CodeNodeType> = {}): CodeNodeType => ({
  title: 'Code',
  desc: '',
  type: BlockEnum.Code,
  variables: [],
  code_language: CodeLanguage.javascript,
  code: 'function main() { return {} }',
  outputs: {},
  ...overrides,
})

describe('code/node', () => {
  it('renders an empty summary container', () => {
    const { container } = render(
      <Node
        id="code-node"
        data={createData()}
      />,
    )

    expect(container.firstChild).toBeEmptyDOMElement()
  })
})
