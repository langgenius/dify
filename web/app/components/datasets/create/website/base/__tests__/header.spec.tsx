import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Header from '../header'

it.each([true, false])(
  'opens crawler configuration from the header (pipeline: %s)',
  async (isInPipeline) => {
    const user = userEvent.setup()
    const onClickConfiguration = vi.fn()
    render(
      <Header
        title="Jina Reader"
        docTitle="Documentation"
        docLink="https://docs.example.com"
        buttonText="Configure"
        onClickConfiguration={onClickConfiguration}
        isInPipeline={isInPipeline}
      />,
    )
    expect(screen.getByRole('link', { name: 'Documentation' })).toHaveAttribute(
      'href',
      'https://docs.example.com',
    )
    await user.click(screen.getByRole('button'))
    expect(onClickConfiguration).toHaveBeenCalledOnce()
  },
)
