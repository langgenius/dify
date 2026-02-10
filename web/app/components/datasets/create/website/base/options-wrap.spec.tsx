import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import OptionsWrap from './options-wrap'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@remixicon/react', () => ({
  RiEqualizer2Line: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="config-icon" {...props} />,
}))
vi.mock('@/app/components/base/icons/src/vender/line/arrows', () => ({
  ChevronRight: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="chevron-icon" {...props} />,
}))

describe('OptionsWrap', () => {
  it('should render children when not folded', () => {
    render(
      <OptionsWrap>
        <div data-testid="child-content">Options here</div>
      </OptionsWrap>,
    )
    expect(screen.getByTestId('child-content')).toBeInTheDocument()
  })

  it('should toggle fold on click', () => {
    render(
      <OptionsWrap>
        <div data-testid="child-content">Options here</div>
      </OptionsWrap>,
    )
    // Initially visible
    expect(screen.getByTestId('child-content')).toBeInTheDocument()

    // Click to fold
    fireEvent.click(screen.getByText('stepOne.website.options'))
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument()

    // Click to unfold
    fireEvent.click(screen.getByText('stepOne.website.options'))
    expect(screen.getByTestId('child-content')).toBeInTheDocument()
  })

  it('should render options label', () => {
    render(
      <OptionsWrap>
        <div>Content</div>
      </OptionsWrap>,
    )
    expect(screen.getByText('stepOne.website.options')).toBeInTheDocument()
  })
})
