import { render } from '@testing-library/react'
import PartnerStackCookieRecorder from '../cookie-recorder'

let isCloudEdition = true
let psPartnerKey: string | undefined
let psClickId: string | undefined

const saveOrUpdate = vi.fn()

vi.mock('@/config', () => ({
  get IS_CLOUD_EDITION() {
    return isCloudEdition
  },
}))

vi.mock('../use-ps-info', () => ({
  default: () => ({
    psPartnerKey,
    psClickId,
    saveOrUpdate,
  }),
}))

describe('PartnerStackCookieRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isCloudEdition = true
    psPartnerKey = undefined
    psClickId = undefined
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

  it('should call saveOrUpdate again when partner stack query changes', () => {
    const { rerender } = render(<PartnerStackCookieRecorder />)

    expect(saveOrUpdate).toHaveBeenCalledTimes(1)

    psPartnerKey = 'updated-partner'
    psClickId = 'updated-click'
    rerender(<PartnerStackCookieRecorder />)

    expect(saveOrUpdate).toHaveBeenCalledTimes(2)
  })
})
