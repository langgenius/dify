import type { CreateAppModalProps } from './index'
import type { UsagePlanInfo } from '@/app/components/billing/type'
import { act, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { createMockPlan, createMockPlanTotal, createMockPlanUsage } from '@/__mocks__/provider-context'
import { Plan } from '@/app/components/billing/type'
import { AppModeEnum } from '@/types/app'
import CreateAppModal from './index'

let mockTranslationOverrides: Record<string, string | undefined> = {}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const override = mockTranslationOverrides[key]
      if (override !== undefined)
        return override
      if (options?.returnObjects)
        return [`${key}-feature-1`, `${key}-feature-2`]
      if (options) {
        const { ns, ...rest } = options
        const prefix = ns ? `${ns}.` : ''
        const suffix = Object.keys(rest).length > 0 ? `:${JSON.stringify(rest)}` : ''
        return `${prefix}${key}${suffix}`
      }
      return key
    },
    i18n: {
      language: 'en',
      changeLanguage: vi.fn(),
    },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => children,
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
}))

// Avoid heavy emoji dataset initialization during unit tests.
vi.mock('emoji-mart', () => ({
  init: vi.fn(),
  SearchIndex: { search: vi.fn().mockResolvedValue([]) },
}))
vi.mock('@emoji-mart/data', () => ({
  default: {
    categories: [
      { id: 'people', emojis: ['😀'] },
    ],
  },
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({}),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    userProfile: { email: 'test@example.com' },
    langGeniusVersionInfo: { current_version: '0.0.0' },
  }),
}))

const createPlanInfo = (buildApps: number): UsagePlanInfo => ({
  vectorSpace: 0,
  buildApps,
  teamMembers: 0,
  annotatedResponse: 0,
  documentsUploadQuota: 0,
  apiRateLimit: 0,
  triggerEvents: 0,
})

let mockEnableBilling = false
let mockPlanType: Plan = Plan.team
let mockUsagePlanInfo: UsagePlanInfo = createPlanInfo(1)
let mockTotalPlanInfo: UsagePlanInfo = createPlanInfo(10)

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => {
    const withPlan = createMockPlan(mockPlanType)
    const withUsage = createMockPlanUsage(mockUsagePlanInfo, withPlan)
    const withTotal = createMockPlanTotal(mockTotalPlanInfo, withUsage)
    return { ...withTotal, enableBilling: mockEnableBilling }
  },
}))

type ConfirmPayload = Parameters<CreateAppModalProps['onConfirm']>[0]

const setup = (overrides: Partial<CreateAppModalProps> = {}) => {
  const onConfirm = vi.fn<(payload: ConfirmPayload) => Promise<void>>().mockResolvedValue(undefined)
  const onHide = vi.fn()

  const props: CreateAppModalProps = {
    show: true,
    isEditModal: false,
    appName: 'Test App',
    appDescription: 'Test description',
    appIconType: 'emoji',
    appIcon: '🤖',
    appIconBackground: '#FFEAD5',
    appIconUrl: null,
    appMode: AppModeEnum.CHAT,
    appUseIconAsAnswerIcon: false,
    max_active_requests: null,
    onConfirm,
    confirmDisabled: false,
    onHide,
    ...overrides,
  }

  render(<CreateAppModal {...props} />)
  return { onConfirm, onHide }
}

const getAppIconTrigger = (): HTMLElement => {
  const nameInput = screen.getByPlaceholderText('app.newApp.appNamePlaceholder')
  const iconRow = nameInput.parentElement?.parentElement
  const iconTrigger = iconRow?.firstElementChild
  if (!(iconTrigger instanceof HTMLElement))
    throw new Error('Failed to locate app icon trigger')
  return iconTrigger
}

describe('CreateAppModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTranslationOverrides = {}
    mockEnableBilling = false
    mockPlanType = Plan.team
    mockUsagePlanInfo = createPlanInfo(1)
    mockTotalPlanInfo = createPlanInfo(10)
  })

  // The title and form sections vary based on the modal mode (create vs edit).
  describe('Rendering', () => {
    it('should render create title and actions when creating', () => {
      setup({ appName: 'My App', isEditModal: false })

      expect(screen.getByText('explore.appCustomize.title:{"name":"My App"}')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.create' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeInTheDocument()
    })

    it('should render edit-only fields when editing a chat app', () => {
      setup({ isEditModal: true, appMode: AppModeEnum.CHAT, max_active_requests: 5 })

      expect(screen.getByText('app.editAppTitle')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeInTheDocument()
      expect(screen.getByRole('switch')).toBeInTheDocument()
      expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('5')
    })

    it.each([AppModeEnum.ADVANCED_CHAT, AppModeEnum.AGENT_CHAT])('should render answer icon switch when editing %s app', (mode) => {
      setup({ isEditModal: true, appMode: mode })

      expect(screen.getByRole('switch')).toBeInTheDocument()
    })

    it('should not render answer icon switch when editing a non-chat app', () => {
      setup({ isEditModal: true, appMode: AppModeEnum.COMPLETION })

      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    })

    it('should not render modal content when hidden', () => {
      setup({ show: false })

      expect(screen.queryByRole('button', { name: 'common.operation.create' })).not.toBeInTheDocument()
    })
  })

  // Disabled states prevent submission and reflect parent-driven props.
  describe('Props', () => {
    it('should disable confirm action when confirmDisabled is true', () => {
      setup({ confirmDisabled: true })

      expect(screen.getByRole('button', { name: 'common.operation.create' })).toBeDisabled()
    })

    it('should disable confirm action when appName is empty', () => {
      setup({ appName: '   ' })

      expect(screen.getByRole('button', { name: 'common.operation.create' })).toBeDisabled()
    })
  })

  // Defensive coverage for falsy input values and translation edge cases.
  describe('Edge Cases', () => {
    it('should default description to empty string when appDescription is empty', () => {
      setup({ appDescription: '' })

      expect((screen.getByPlaceholderText('app.newApp.appDescriptionPlaceholder') as HTMLTextAreaElement).value).toBe('')
    })

    it('should fall back to empty placeholders when translations return empty string', () => {
      mockTranslationOverrides = {
        'newApp.appNamePlaceholder': '',
        'newApp.appDescriptionPlaceholder': '',
      }

      setup()

      expect((screen.getByDisplayValue('Test App') as HTMLInputElement).placeholder).toBe('')
      expect((screen.getByDisplayValue('Test description') as HTMLTextAreaElement).placeholder).toBe('')
    })
  })

  // The modal should close from user-initiated cancellation actions.
  describe('User Interactions', () => {
    it('should call onHide when cancel button is clicked', () => {
      const { onConfirm, onHide } = setup()

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

      expect(onHide).toHaveBeenCalledTimes(1)
      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('should call onHide when pressing Escape while visible', () => {
      const { onHide } = setup()

      fireEvent.keyDown(window, { key: 'Escape', keyCode: 27 })

      expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('should not call onHide when pressing Escape while hidden', () => {
      const { onHide } = setup({ show: false })

      fireEvent.keyDown(window, { key: 'Escape', keyCode: 27 })

      expect(onHide).not.toHaveBeenCalled()
    })
  })

  // When billing limits are reached, the modal blocks app creation and shows quota guidance.
  describe('Quota Gating', () => {
    it('should show AppsFull and disable create when apps quota is reached', () => {
      mockEnableBilling = true
      mockPlanType = Plan.team
      mockUsagePlanInfo = createPlanInfo(10)
      mockTotalPlanInfo = createPlanInfo(10)

      setup({ isEditModal: false })

      expect(screen.getByText('billing.apps.fullTip2')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.create' })).toBeDisabled()
    })

    it('should allow saving when apps quota is reached in edit mode', () => {
      mockEnableBilling = true
      mockPlanType = Plan.team
      mockUsagePlanInfo = createPlanInfo(10)
      mockTotalPlanInfo = createPlanInfo(10)

      setup({ isEditModal: true })

      expect(screen.queryByText('billing.apps.fullTip2')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeEnabled()
    })
  })

  // Shortcut handlers are important for power users and must respect gating rules.
  describe('Keyboard Shortcuts', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it.each([
      ['meta+enter', { metaKey: true }],
      ['ctrl+enter', { ctrlKey: true }],
    ])('should submit when %s is pressed while visible', (_, modifier) => {
      const { onConfirm, onHide } = setup()

      fireEvent.keyDown(window, { key: 'Enter', keyCode: 13, ...modifier })
      act(() => {
        vi.advanceTimersByTime(300)
      })

      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('should not submit when modal is hidden', () => {
      const { onConfirm, onHide } = setup({ show: false })

      fireEvent.keyDown(window, { key: 'Enter', keyCode: 13, metaKey: true })
      act(() => {
        vi.advanceTimersByTime(300)
      })

      expect(onConfirm).not.toHaveBeenCalled()
      expect(onHide).not.toHaveBeenCalled()
    })

    it('should not submit when apps quota is reached in create mode', () => {
      mockEnableBilling = true
      mockPlanType = Plan.team
      mockUsagePlanInfo = createPlanInfo(10)
      mockTotalPlanInfo = createPlanInfo(10)

      const { onConfirm, onHide } = setup({ isEditModal: false })

      fireEvent.keyDown(window, { key: 'Enter', keyCode: 13, metaKey: true })
      act(() => {
        vi.advanceTimersByTime(300)
      })

      expect(onConfirm).not.toHaveBeenCalled()
      expect(onHide).not.toHaveBeenCalled()
    })

    it('should submit when apps quota is reached in edit mode', () => {
      mockEnableBilling = true
      mockPlanType = Plan.team
      mockUsagePlanInfo = createPlanInfo(10)
      mockTotalPlanInfo = createPlanInfo(10)

      const { onConfirm, onHide } = setup({ isEditModal: true })

      fireEvent.keyDown(window, { key: 'Enter', keyCode: 13, metaKey: true })
      act(() => {
        vi.advanceTimersByTime(300)
      })

      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('should not submit when name is empty', () => {
      const { onConfirm, onHide } = setup({ appName: '   ' })

      fireEvent.keyDown(window, { key: 'Enter', keyCode: 13, metaKey: true })
      act(() => {
        vi.advanceTimersByTime(300)
      })

      expect(onConfirm).not.toHaveBeenCalled()
      expect(onHide).not.toHaveBeenCalled()
    })
  })

  // The app icon picker is a key user flow for customizing metadata.
  describe('App Icon Picker', () => {
    it('should open and close the picker when cancel is clicked', () => {
      setup({
        appIconType: 'image',
        appIcon: 'file-123',
        appIconUrl: 'https://example.com/icon.png',
      })

      fireEvent.click(getAppIconTrigger())

      expect(screen.getByRole('button', { name: 'app.iconPicker.cancel' })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'app.iconPicker.cancel' }))

      expect(screen.queryByRole('button', { name: 'app.iconPicker.cancel' })).not.toBeInTheDocument()
    })

    it('should update icon payload when selecting emoji and confirming', () => {
      vi.useFakeTimers()
      try {
        const { onConfirm } = setup({
          appIconType: 'image',
          appIcon: 'file-123',
          appIconUrl: 'https://example.com/icon.png',
        })

        fireEvent.click(getAppIconTrigger())

        // Find the emoji grid by locating the category label, then find the clickable emoji wrapper
        const categoryLabel = screen.getByText('people')
        const emojiGrid = categoryLabel.nextElementSibling
        const clickableEmojiWrapper = emojiGrid?.firstElementChild
        if (!(clickableEmojiWrapper instanceof HTMLElement))
          throw new Error('Failed to locate emoji wrapper')
        fireEvent.click(clickableEmojiWrapper)

        fireEvent.click(screen.getByRole('button', { name: 'app.iconPicker.ok' }))

        fireEvent.click(screen.getByRole('button', { name: 'common.operation.create' }))
        act(() => {
          vi.advanceTimersByTime(300)
        })

        expect(onConfirm).toHaveBeenCalledTimes(1)
        const payload = onConfirm.mock.calls[0][0]
        expect(payload).toMatchObject({
          icon_type: 'emoji',
          icon: '😀',
          icon_background: '#FFEAD5',
        })
      }
      finally {
        vi.useRealTimers()
      }
    })

    it('should reset emoji icon to initial props when picker is cancelled', () => {
      vi.useFakeTimers()
      try {
        const { onConfirm } = setup({
          appIconType: 'emoji',
          appIcon: '🤖',
          appIconBackground: '#FFEAD5',
        })

        // Open picker, select a new emoji, and confirm
        fireEvent.click(getAppIconTrigger())

        // Find the emoji grid by locating the category label, then find the clickable emoji wrapper
        const categoryLabel = screen.getByText('people')
        const emojiGrid = categoryLabel.nextElementSibling
        const clickableEmojiWrapper = emojiGrid?.firstElementChild
        if (!(clickableEmojiWrapper instanceof HTMLElement))
          throw new Error('Failed to locate emoji wrapper')
        fireEvent.click(clickableEmojiWrapper)

        fireEvent.click(screen.getByRole('button', { name: 'app.iconPicker.ok' }))

        expect(screen.queryByRole('button', { name: 'app.iconPicker.cancel' })).not.toBeInTheDocument()

        // Open picker again and cancel - should reset to initial props
        fireEvent.click(getAppIconTrigger())
        fireEvent.click(screen.getByRole('button', { name: 'app.iconPicker.cancel' }))

        expect(screen.queryByRole('button', { name: 'app.iconPicker.cancel' })).not.toBeInTheDocument()

        // Submit and verify the payload uses the original icon (cancel reverts to props)
        fireEvent.click(screen.getByRole('button', { name: 'common.operation.create' }))
        act(() => {
          vi.advanceTimersByTime(300)
        })

        expect(onConfirm).toHaveBeenCalledTimes(1)
        const payload = onConfirm.mock.calls[0][0]
        expect(payload).toMatchObject({
          icon_type: 'emoji',
          icon: '🤖',
          icon_background: '#FFEAD5',
        })
      }
      finally {
        vi.useRealTimers()
      }
    })
  })

  // Submitting uses a debounced handler and builds a payload from current form state.
  describe('Submitting', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should call onConfirm with emoji payload and hide when create is clicked', () => {
      const { onConfirm, onHide } = setup({
        appName: 'My App',
        appDescription: 'My description',
        appIconType: 'emoji',
        appIcon: '😀',
        appIconBackground: '#000000',
      })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.create' }))
      act(() => {
        vi.advanceTimersByTime(300)
      })

      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onHide).toHaveBeenCalledTimes(1)

      const payload = onConfirm.mock.calls[0][0]
      expect(payload).toMatchObject({
        name: 'My App',
        icon_type: 'emoji',
        icon: '😀',
        icon_background: '#000000',
        description: 'My description',
        use_icon_as_answer_icon: false,
      })
      expect(payload).not.toHaveProperty('max_active_requests')
    })

    it('should include updated description when textarea is changed before submitting', () => {
      const { onConfirm } = setup({ appDescription: 'Old description' })

      fireEvent.change(screen.getByPlaceholderText('app.newApp.appDescriptionPlaceholder'), { target: { value: 'Updated description' } })
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.create' }))
      act(() => {
        vi.advanceTimersByTime(300)
      })

      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onConfirm.mock.calls[0][0]).toMatchObject({ description: 'Updated description' })
    })

    it('should omit icon_background when submitting with image icon', () => {
      const { onConfirm } = setup({
        appIconType: 'image',
        appIcon: 'file-123',
        appIconUrl: 'https://example.com/icon.png',
        appIconBackground: null,
      })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.create' }))
      act(() => {
        vi.advanceTimersByTime(300)
      })

      const payload = onConfirm.mock.calls[0][0]
      expect(payload).toMatchObject({
        icon_type: 'image',
        icon: 'file-123',
      })
      expect(payload.icon_background).toBeUndefined()
    })

    it('should include max_active_requests and updated answer icon when saving', () => {
      const { onConfirm } = setup({
        isEditModal: true,
        appMode: AppModeEnum.CHAT,
        appUseIconAsAnswerIcon: false,
        max_active_requests: 3,
      })

      fireEvent.click(screen.getByRole('switch'))
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '12' } })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))
      act(() => {
        vi.advanceTimersByTime(300)
      })

      const payload = onConfirm.mock.calls[0][0]
      expect(payload).toMatchObject({
        use_icon_as_answer_icon: true,
        max_active_requests: 12,
      })
    })

    it('should omit max_active_requests when input is empty', () => {
      const { onConfirm } = setup({ isEditModal: true, max_active_requests: null })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))
      act(() => {
        vi.advanceTimersByTime(300)
      })

      const payload = onConfirm.mock.calls[0][0]
      expect(payload.max_active_requests).toBeUndefined()
    })

    it('should omit max_active_requests when input is not a number', () => {
      const { onConfirm } = setup({ isEditModal: true, max_active_requests: null })

      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: 'abc' } })
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))
      act(() => {
        vi.advanceTimersByTime(300)
      })

      const payload = onConfirm.mock.calls[0][0]
      expect(payload.max_active_requests).toBeUndefined()
    })

    it('should show toast error and not submit when name becomes empty before debounced submit runs', () => {
      const { onConfirm, onHide } = setup({ appName: 'My App' })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.create' }))
      fireEvent.change(screen.getByPlaceholderText('app.newApp.appNamePlaceholder'), { target: { value: '   ' } })

      act(() => {
        vi.advanceTimersByTime(300)
      })

      expect(screen.getByText('explore.appCustomize.nameRequired')).toBeInTheDocument()
      act(() => {
        vi.advanceTimersByTime(6000)
      })
      expect(screen.queryByText('explore.appCustomize.nameRequired')).not.toBeInTheDocument()
      expect(onConfirm).not.toHaveBeenCalled()
      expect(onHide).not.toHaveBeenCalled()
    })
  })
})
