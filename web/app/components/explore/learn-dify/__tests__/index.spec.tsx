import type { App } from '@/models/explore'
import { render, screen } from '@testing-library/react'
import { createSystemFeaturesWrapper } from '@/__tests__/utils/mock-system-features'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import { AppModeEnum } from '@/types/app'
import LearnDify from '../index'
import { LEARN_DIFY_HIDDEN_STORAGE_KEY } from '../storage'

let mockLearnDifyApps: App[] = []
let mockLearnDifyLoading = false

vi.mock('@/service/use-explore', () => ({
  useLearnDifyAppList: () => ({
    data: mockLearnDifyApps,
    isLoading: mockLearnDifyLoading,
  }),
}))

const createApp = (overrides: Partial<App> = {}): App => ({
  app: {
    id: overrides.app?.id ?? 'app-basic-id',
    mode: overrides.app?.mode ?? AppModeEnum.CHAT,
    icon_type: overrides.app?.icon_type ?? 'emoji',
    icon: overrides.app?.icon ?? '😀',
    icon_background: overrides.app?.icon_background ?? '#fff',
    icon_url: overrides.app?.icon_url ?? '',
    name: overrides.app?.name ?? 'Learn Dify App',
    description: overrides.app?.description ?? 'Learn Dify description',
    use_icon_as_answer_icon: overrides.app?.use_icon_as_answer_icon ?? false,
  },
  can_trial: overrides.can_trial ?? true,
  app_id: overrides.app_id ?? 'learn-dify-app',
  description: overrides.description ?? 'Learn Dify description',
  copyright: overrides.copyright ?? '',
  privacy_policy: overrides.privacy_policy ?? null,
  custom_disclaimer: overrides.custom_disclaimer ?? null,
  categories: overrides.categories ?? ['Writing'],
  position: overrides.position ?? 1,
  is_listed: overrides.is_listed ?? true,
  install_count: overrides.install_count ?? 0,
  installed: overrides.installed ?? false,
  editable: overrides.editable ?? false,
  is_agent: overrides.is_agent ?? false,
})

const renderLearnDify = ({
  enableLearnApp = true,
  forceVisible = false,
}: {
  enableLearnApp?: boolean
  forceVisible?: boolean
} = {}) => {
  const { wrapper } = createSystemFeaturesWrapper({
    systemFeatures: {
      enable_learn_app: enableLearnApp,
    },
  })

  return render(
    <LearnDify forceVisible={forceVisible} stepByStepTourTarget={STEP_BY_STEP_TOUR_TARGETS.home} />,
    { wrapper },
  )
}

describe('LearnDify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockLearnDifyApps = [createApp()]
    mockLearnDifyLoading = false
  })

  it('should stay hidden when the user hidden preference is set', () => {
    localStorage.setItem(LEARN_DIFY_HIDDEN_STORAGE_KEY, 'true')

    renderLearnDify()

    expect(
      screen.queryByRole('heading', { name: 'explore.learnDify.title' }),
    ).not.toBeInTheDocument()
  })

  it('should show hidden content when forceVisible is set for the step tour', () => {
    localStorage.setItem(LEARN_DIFY_HIDDEN_STORAGE_KEY, 'true')

    renderLearnDify({ forceVisible: true })

    const learnDifyHeading = screen.getByRole('heading', { name: 'explore.learnDify.title' })
    expect(learnDifyHeading).toBeInTheDocument()
    expect(learnDifyHeading.closest('section')).toHaveAttribute(
      'data-step-by-step-tour-target',
      STEP_BY_STEP_TOUR_TARGETS.home,
    )
    expect(screen.queryByRole('button', { name: 'explore.learnDify.hide' })).not.toBeInTheDocument()
  })

  it('should keep Learn Dify hidden when the system feature is disabled', () => {
    localStorage.setItem(LEARN_DIFY_HIDDEN_STORAGE_KEY, 'true')

    renderLearnDify({ enableLearnApp: false, forceVisible: true })

    expect(
      screen.queryByRole('heading', { name: 'explore.learnDify.title' }),
    ).not.toBeInTheDocument()
  })
})
