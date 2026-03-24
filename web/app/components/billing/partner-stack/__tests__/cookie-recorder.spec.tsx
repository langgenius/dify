import { render } from '@testing-library/react'
import PartnerStackCookieRecorder from '../cookie-recorder'

const saveOrUpdate = vi.fn()

vi.mock('../use-ps-info', () => ({
  default: () => ({
    saveOrUpdate,
  }),
}))

describe('PartnerStackCookieRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call saveOrUpdate once on mount', () => {
    render(<PartnerStackCookieRecorder />)

    expect(saveOrUpdate).toHaveBeenCalledTimes(1)
  })

  it('should render null', () => {
    const { container } = render(<PartnerStackCookieRecorder />)

    expect(container.innerHTML).toBe('')
  })
})
