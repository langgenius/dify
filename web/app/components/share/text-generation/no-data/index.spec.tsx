import React from 'react'
import { render, screen } from '@testing-library/react'
import NoData from './index'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('NoData', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })
  it('should render empty state icon and text when mounted', () => {
    const { container } = render(<NoData />)

    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(screen.getByText('share.generation.noData')).toBeInTheDocument()
  })
})
