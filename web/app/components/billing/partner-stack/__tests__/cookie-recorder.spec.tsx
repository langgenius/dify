import { render } from '@testing-library/react'
import PartnerStackCookieRecorder from '../cookie-recorder'

let isCloudEdition = true

const saveOrUpdate = vi.fn()

vi.mock('@/config', () => ({
  get IS_CLOUD_EDITION() {
    return isCloudEdition
  },
}))

vi.mock('../use-ps-info', () => ({
  default: () => ({
    saveOrUpdate,
  }),
}))

describe('PartnerStackCookieRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isCloudEdition = true
  })

  it('should call saveOrUpdate once on mount when running in cloud edition', () => {
    render(<PartnerStackCookieRecorder />)

    expect(saveOrUpdate).toHaveBeenCalledTimes(1)
  })

  it('should not call saveOrUpdate when not running in cloud edition', () => {
    isCloudEdition = false

    render(<PartnerStackCookieRecorder />)

    expect(saveOrUpdate).not.toHaveBeenCalled()
  })

  it('should render null', () => {
    const { container } = render(<PartnerStackCookieRecorder />)

    expect(container.innerHTML).toBe('')
  })
})
