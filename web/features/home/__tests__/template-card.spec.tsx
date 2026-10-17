import type {
  RecommendedAppInfoResponse,
  RecommendedAppResponse,
} from '@dify/contracts/api/console/explore/types.gen'
import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { trackEvent } from '@/app/components/base/amplitude'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { TemplateCard } from '../template-card'

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

type TemplateFixture = RecommendedAppResponse & { app: RecommendedAppInfoResponse }
type TemplateFixtureOverrides = Omit<Partial<RecommendedAppResponse>, 'app'> & {
  app?: Partial<RecommendedAppInfoResponse>
}

const createApp = (overrides: TemplateFixtureOverrides = {}): TemplateFixture => ({
  can_trial: true,
  app_id: 'app-id',
  description: 'App description',
  copyright: '2024',
  privacy_policy: null,
  custom_disclaimer: null,
  categories: ['Assistant'],
  position: 1,
  is_listed: true,
  ...overrides,
  app: {
    id: 'id-1',
    mode: 'chat' as const,
    icon_type: null,
    icon: '🤖',
    icon_background: '#fff',
    icon_url: '',
    name: 'Sample App',
    ...overrides?.app,
  },
})

describe('TemplateCard', () => {
  const onCreate = vi.fn()
  const onTry = vi.fn()
  const mockTrackEvent = vi.mocked(trackEvent)
  let deploymentEdition: DeploymentEdition = 'CLOUD'

  const renderComponent = (props?: Partial<React.ComponentProps<typeof TemplateCard>>) => {
    const mergedProps: React.ComponentProps<typeof TemplateCard> = {
      app: createApp(),
      canCreate: false,
      onCreate,
      onTry,
      ...props,
    }
    return renderWithConsoleQuery(<TemplateCard {...mergedProps} />, {
      systemFeatures: { deployment_edition: deploymentEdition },
    })
  }

  beforeEach(() => {
    deploymentEdition = 'CLOUD'
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render app name and description', () => {
      renderComponent()

      expect(screen.getByText('Sample App')).toBeInTheDocument()
      expect(screen.getByText('App description')).toBeInTheDocument()
    })

    it.each([
      ['chat', 'APP.TYPES.CHATBOT'],
      ['advanced-chat', 'APP.TYPES.ADVANCED'],
      ['agent-chat', 'APP.TYPES.AGENT'],
      ['agent', 'APP.TYPES.AGENT'],
      ['workflow', 'APP.TYPES.WORKFLOW'],
      ['completion', 'APP.TYPES.COMPLETION'],
    ] as const)('should render correct mode label for %s mode', (mode, label) => {
      renderComponent({ app: createApp({ app: { ...createApp().app, mode } }) })

      expect(screen.getByText(label)).toBeInTheDocument()
    })

    it('should not render category badges', () => {
      renderComponent({ app: createApp({ categories: ['Search', 'Productivity'] }) })

      expect(screen.queryByText('Search')).not.toBeInTheDocument()
      expect(screen.queryByText('Productivity')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it.each([
      ['CLOUD', true, 'explore.appCard.try'],
      ['CLOUD', false, 'explore.appCard.try'],
      ['COMMUNITY', true, 'explore.tryApp.createFromSampleApp'],
    ] as const)(
      'describes the Agent card action on %s with canCreate=%s',
      async (edition, canCreate, action) => {
        const user = userEvent.setup()
        deploymentEdition = edition
        const templateName = 'An Agent template with a full descriptive name'
        const app = createApp({
          app: { mode: 'agent' as const, name: templateName },
          description:
            'A full template description that remains available when visually truncated.',
        })

        renderComponent({ app, canCreate })

        const cardButton = screen.getByRole('button', { name: templateName })
        expect(cardButton).toHaveAccessibleDescription(`${action} ${app.description}`)

        await user.click(cardButton)

        if (edition === 'CLOUD') {
          expect(onTry).toHaveBeenCalledWith(app)
          expect(onCreate).not.toHaveBeenCalled()
        } else {
          expect(onCreate).toHaveBeenCalledTimes(1)
          expect(onTry).not.toHaveBeenCalled()
        }
      },
    )

    it('should not make the app card clickable outside cloud edition when create is not allowed', () => {
      deploymentEdition = 'COMMUNITY'
      renderComponent({ canCreate: false })

      expect(screen.queryByRole('button', { name: 'Sample App' })).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it.each([
      ['CLOUD', 'explore.appCard.try'],
      ['COMMUNITY', 'explore.tryApp.createFromSampleApp'],
    ] as const)(
      'describes the card action without a template description on %s',
      (edition, action) => {
        deploymentEdition = edition
        renderComponent({
          app: createApp({ app: { mode: 'agent' as const }, description: '' }),
          canCreate: true,
        })

        expect(screen.getByRole('button', { name: 'Sample App' })).toHaveAccessibleDescription(
          action,
        )
      },
    )

    it('should call onCreate when app card is clicked outside cloud edition', async () => {
      deploymentEdition = 'COMMUNITY'

      renderComponent({ canCreate: true })

      await userEvent.setup().click(screen.getByRole('button', { name: 'Sample App' }))

      expect(onCreate).toHaveBeenCalledTimes(1)
      expect(onTry).not.toHaveBeenCalled()
      expect(mockTrackEvent).not.toHaveBeenCalled()
    })

    it.each(['{Enter}', ' '])('opens an Agent template with %s from the keyboard', async (key) => {
      const user = userEvent.setup()
      const app = createApp({ app: { mode: 'agent' as const } })

      renderComponent({ app, canCreate: true })

      await user.tab()
      expect(screen.getByRole('button', { name: 'Sample App' })).toHaveFocus()
      await user.keyboard(key)

      expect(onTry).toHaveBeenCalledWith(app)
    })

    it('should track preview event when app card is clicked', async () => {
      const app = createApp()

      renderComponent({ app, canCreate: true })

      await userEvent.setup().click(screen.getByRole('button', { name: 'Sample App' }))

      expect(onTry).toHaveBeenCalledExactlyOnceWith(app)
      expect(mockTrackEvent).toHaveBeenCalledWith('preview_template', {
        template_id: app.app_id,
        template_name: app.app.name,
        template_mode: app.app.mode,
        template_categories: app.categories,
        page: 'explore',
      })
    })
  })
})
