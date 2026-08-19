import { screen } from '@testing-library/react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import ExpireNoticeModal from '../modal'

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => path,
}))

vi.mock('@/context/modal-context', () => ({
  useModalContextSelector: () => vi.fn(),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({ formatTime: () => '2026/08/20' }),
}))

describe('ExpireNoticeModal', () => {
  it('navigates re-verification through the canonical Education route', () => {
    const { wrapper } = createConsoleQueryWrapper({
      systemFeatures: { deployment_edition: 'CLOUD' },
    })

    render(<ExpireNoticeModal expireAt={1787155200} expired={false} onClose={vi.fn()} />, {
      wrapper,
    })

    expect(screen.getByRole('link', { name: 'education.notice.action.reVerify' })).toHaveAttribute(
      'href',
      '/education/verify',
    )
  })
})
