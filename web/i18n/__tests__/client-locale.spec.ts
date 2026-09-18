import Cookies from 'js-cookie'
import { changeLanguage, setLocaleOnClient } from '../client'

const mocks = vi.hoisted(() => ({ changeLanguage: vi.fn() }))

vi.mock('js-cookie', () => ({ default: { set: vi.fn() } }))
vi.mock('react-i18next', () => ({ getI18n: () => ({ changeLanguage: mocks.changeLanguage }) }))

describe('client locale inputs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.changeLanguage.mockResolvedValue(undefined)
  })

  it.each([
    ['zh_Hans', 'zh-Hans'],
    ['ja_JP', 'ja-JP'],
    ['en_US', 'en-US'],
    ['ZH-hans', 'zh-Hans'],
    ['zh-Hant', 'zh-Hant'],
    ['en--US', 'en-US'],
    ['unsupported', 'en-US'],
  ])('changes and persists %s as %s', async (input, expected) => {
    await setLocaleOnClient(input, false)

    expect(Cookies.set).toHaveBeenCalledWith('locale', expected, { expires: 365 })
    expect(mocks.changeLanguage).toHaveBeenCalledWith(expected)
  })

  it('normalizes a share-app override without persisting console preferences', async () => {
    await changeLanguage('zh_Hans')

    expect(mocks.changeLanguage).toHaveBeenCalledWith('zh-Hans')
    expect(Cookies.set).not.toHaveBeenCalled()
  })

  it('preserves the current language when the app has no override', async () => {
    await changeLanguage(undefined)

    expect(mocks.changeLanguage).not.toHaveBeenCalled()
    expect(Cookies.set).not.toHaveBeenCalled()
  })
})
