import type { TemplateTransformNodeType } from '../types'
import { render } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import Node from '../node'

const createData = (overrides: Partial<TemplateTransformNodeType> = {}): TemplateTransformNodeType => ({
  title: 'Template Transform',
  desc: '',
  type: BlockEnum.TemplateTransform,
  variables: [],
  template: '',
  ...overrides,
})

describe('template-transform/node', () => {
  it('renders an empty shell without summary content', () => {
    const { container } = render(
      <Node
        id="template-node"
        data={createData()}
      />,
    )

    expect(container.firstElementChild).toBeEmptyDOMElement()
  })
})
