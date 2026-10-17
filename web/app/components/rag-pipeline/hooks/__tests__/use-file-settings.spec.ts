import { renderHook } from '@testing-library/react'
import { useFileSettings } from '../use-file-settings'

let mockFileUploadConfig = { max_size: 10 }
vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { fileUploadConfig: typeof mockFileUploadConfig }) => unknown) =>
    selector({ fileUploadConfig: mockFileUploadConfig }),
}))

it('combines pipeline upload limits with the disabled image settings and follows config changes', () => {
  mockFileUploadConfig = { max_size: 10 }
  const { result, rerender } = renderHook(() => useFileSettings())
  expect(result.current).toEqual({
    image: {
      enabled: false,
      detail: 'high',
      number_limits: 3,
      transfer_methods: ['local_file', 'remote_url'],
    },
    fileUploadConfig: { max_size: 10 },
  })
  mockFileUploadConfig = { max_size: 20 }
  rerender()
  expect(result.current.fileUploadConfig).toEqual({ max_size: 20 })
})
