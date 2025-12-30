import { render } from '@testing-library/react'
import PartnerStack from './index'

let isCloudEdition = true

const saveOrUpdate = vi.fn()
const bind = vi.fn()

vi.mock('@/config', () => ({
  get IS_CLOUD_EDITION() {
    return isCloudEdition
  },
}))

vi.mock('./use-ps-info', () => ({
  default: () => ({
    saveOrUpdate,
    bind,
  }),
}))

describe('PartnerStack', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isCloudEdition = true
  })

  it('does not call partner stack helpers when not in cloud edition', () => {
    isCloudEdition = false

    render(<PartnerStack />)

    expect(saveOrUpdate).not.toHaveBeenCalled()
    expect(bind).not.toHaveBeenCalled()
  })

  it('calls saveOrUpdate and bind once when running in cloud edition', () => {
    render(<PartnerStack />)

    expect(saveOrUpdate).toHaveBeenCalledTimes(1)
    expect(bind).toHaveBeenCalledTimes(1)
  })
})
