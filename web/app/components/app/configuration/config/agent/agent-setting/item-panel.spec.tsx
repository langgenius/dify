import { render, screen } from '@testing-library/react'
import * as React from 'react'
import ItemPanel from './item-panel'

describe('AgentSetting/ItemPanel', () => {
  it('should render icon, name, and children content', () => {
    render(
      <ItemPanel
        className="custom"
        icon={<span>icon</span>}
        name="Panel name"
        description="More info"
        children={<div>child content</div>}
      />,
    )

    expect(screen.getByText('Panel name')).toBeInTheDocument()
    expect(screen.getByText('child content')).toBeInTheDocument()
    expect(screen.getByText('icon')).toBeInTheDocument()
  })
})
