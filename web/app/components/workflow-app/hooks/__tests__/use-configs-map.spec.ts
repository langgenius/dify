import { renderHook } from '@testing-library/react'
import { FlowType } from '@/types/common'
import { useConfigsMap } from '../use-configs-map'

const mockUseFeatures = vi.fn()

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: (selector: (state: { features: { file: Record<string, unknown> } }) => unknown) => mockUseFeatures(selector),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T>(selector: (state: { appId: string }) => T) => selector({ appId: 'app-1' }),
}))

describe('useConfigsMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseFeatures.mockImplementation((selector: (state: { features: { file: Record<string, unknown> } }) => unknown) => selector({
      features: {
        file: {
          enabled: true,
          number_limits: 3,
        },
      },
    }))
  })

  it('should map workflow app id and feature file settings into inspect-var configs', () => {
    const { result } = renderHook(() => useConfigsMap())

    expect(result.current).toEqual({
      flowId: 'app-1',
      flowType: FlowType.appFlow,
      fileSettings: {
        enabled: true,
        number_limits: 3,
      },
    })
  })
})
