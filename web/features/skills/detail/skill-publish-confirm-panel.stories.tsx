import type { SkillReferenceResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'
import { SkillPublishBottomActions } from './publish-bar'
import { SkillPublishConfirmPanel } from './skill-metadata'

const scrollSkillId = 'publish-confirm-scroll-visual-test'
const designComparisonSkillId = 'publish-confirm-design-comparison'
const referenceIcons = ['🐍', '🍯', '🕹️', '🧭'] as const
const referenceIconBackgrounds = ['#F2F4F7', '#FFF6ED', '#FDF2FA', '#EEF4FF'] as const
const referenceNames = [
  'Python bug fixer',
  'Translation Workflow',
  'Automated Email Reply',
  'Customer complaint escalation',
] as const
const references: SkillReferenceResponse[] = Array.from({ length: 11 }, (_, index) => ({
  agent_id: `agent-${index + 1}`,
  agent_icon: referenceIcons[index % referenceIcons.length] ?? '🐍',
  agent_icon_background:
    referenceIconBackgrounds[index % referenceIconBackgrounds.length] ?? '#F2F4F7',
  agent_icon_type: 'emoji',
  app_id: `app-${index + 1}`,
  display_name: referenceNames[index % referenceNames.length] ?? `Reference ${index + 1}`,
  name: `reference-${index + 1}`,
  type: 'agent',
}))
const referencesQueryOptions =
  consoleQuery.workspaces.current.skills.bySkillId.references.get.queryOptions({
    input: {
      params: {
        skill_id: scrollSkillId,
      },
    },
    enabled: true,
  })
const designComparisonQueryOptions =
  consoleQuery.workspaces.current.skills.bySkillId.references.get.queryOptions({
    input: {
      params: {
        skill_id: designComparisonSkillId,
      },
    },
    enabled: true,
  })
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: Infinity,
    },
  },
})
queryClient.setQueryData(referencesQueryOptions.queryKey, { data: references })
queryClient.setQueryData(designComparisonQueryOptions.queryKey, { data: references.slice(0, 3) })

const meta = {
  title: 'Features/Skills/Detail/PublishConfirmPanel',
  component: SkillPublishConfirmPanel,
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <div className="relative h-[680px] w-[800px] bg-background-default">
          <SkillPublishBottomActions>
            <Story />
          </SkillPublishBottomActions>
        </div>
      </QueryClientProvider>
    ),
  ],
  parameters: {
    layout: 'centered',
  },
  args: {
    loading: false,
    onCancel: () => undefined,
    onConfirm: () => undefined,
    open: true,
    referenceCount: references.length,
    skillId: scrollSkillId,
  },
} satisfies Meta<typeof SkillPublishConfirmPanel>

export default meta
type Story = StoryObj<typeof meta>

export const WithScrollableReferences: Story = {}

export const DesignComparison: Story = {
  args: {
    referenceCount: 3,
    skillId: designComparisonSkillId,
  },
}
