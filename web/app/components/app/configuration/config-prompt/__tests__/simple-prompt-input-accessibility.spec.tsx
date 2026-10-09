import { render, screen } from '@testing-library/react'
import { AppModeEnum } from '@/types/app'
import Prompt from '../simple-prompt-input'

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeaturesStore: () => ({
    getState: () => ({ features: { opening: { enabled: false } }, setFeatures: vi.fn() }),
  }),
}))

describe('SimplePromptInput accessibility', () => {
  it.each([AppModeEnum.CHAT, AppModeEnum.COMPLETION])(
    'names the real editor from the visible section heading in %s mode',
    (mode) => {
      render(<Prompt mode={mode} promptTemplate="" promptVariables={[]} noResize />)
      const heading = screen.getByRole('heading', { level: 2 })
      expect(screen.getByRole('textbox', { name: heading.textContent! })).toHaveAttribute(
        'aria-labelledby',
        heading.id,
      )
    },
  )

  it('keeps an accessible editor name when embedded without a section heading', () => {
    render(
      <Prompt mode={AppModeEnum.CHAT} promptTemplate="" promptVariables={[]} noTitle noResize />,
    )
    expect(screen.getByRole('textbox', { name: 'appDebug.chatSubTitle' })).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })
})
