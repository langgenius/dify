import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { AgentKnowledgeRetrievalItem } from '@/features/agent-v2/agent-composer/form-state'
import { zKnowledgeFsSpaceListResponse } from '@dify/contracts/api/console/knowledge-fs/zod.gen'
import { Button } from '@langgenius/dify-ui/button'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { getInitOptions } from '@/i18n-config/settings'
import agentEn from '@/i18n/en-US/agent-v-2.json'
import appDebugEn from '@/i18n/en-US/app-debug.json'
import commonEn from '@/i18n/en-US/common.json'
import workflowEn from '@/i18n/en-US/workflow.json'
import agentZh from '@/i18n/zh-Hans/agent-v-2.json'
import appDebugZh from '@/i18n/zh-Hans/app-debug.json'
import commonZh from '@/i18n/zh-Hans/common.json'
import workflowZh from '@/i18n/zh-Hans/workflow.json'
import { consoleQuery } from '@/service/client'
import { AgentKnowledgeRetrievalDialog } from './dialog'

const examples = [
  { name: '产品手册', description: '' },
  { name: 'API 参考', description: '接口鉴权、请求参数、响应格式与错误码。' },
  {
    name: '客户服务知识库',
    description:
      '订单查询、退款流程、常见问题与售后支持。\n完整的使用说明可以在高级设置中阅读，不会撑高列表。',
  },
  {
    name: '工程规范与系统架构设计：服务部署、可观测性及故障排查参考手册',
    description: '用于理解服务架构、发布流程与排查生产故障。',
  },
  { name: '内部培训资料', description: '' },
  { name: '无绑定权限的知识库', description: '缺少绑定权限，不应出现在候选列表中。' },
  { name: '暂不可用的知识库', description: '当前不可用，不应出现在候选列表中。' },
]

function createPreviewQueryClient(many: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  const data = Array.from({ length: many ? 30 : examples.length }, (_, index) => {
    const example = examples[index % examples.length]!
    const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
    return {
      control_space_id: id,
      knowledge_space_id: id,
      created_at: '2026-09-07T00:00:00Z',
      updated_at: '2026-09-07T00:00:00Z',
      linked_apps: 0,
      owner_account_id: 'storybook',
      resource_version: 1,
      state: 'active',
      technical_status: index % examples.length === 6 ? 'unavailable' : 'available',
      visibility: 'only_me',
      permission_keys: [
        'knowledge_space_read',
        'knowledge_space_query',
        ...(index % examples.length === 5 ? [] : ['knowledge_space_access_config']),
      ],
      technical_summary: {
        knowledge_space_id: id,
        name: many ? `${example.name} ${index + 1}` : example.name,
        description: example.description,
        revision: 1,
        slug: id,
      },
    }
  })
  const options = consoleQuery.knowledgeFs.spaces.get.infiniteOptions({
    input: (pageParam) => ({ query: { limit: 50, page: pageParam } }),
    initialPageParam: 1,
    getNextPageParam: () => undefined,
  })
  client.setQueryData(options.queryKey, {
    pages: [zKnowledgeFsSpaceListResponse.parse({ data, page: 1, limit: 50, has_more: false })],
    pageParams: [1],
  })
  return client
}

function PickerPreview({
  locale = 'zh-Hans',
  many = false,
}: {
  locale?: 'zh-Hans' | 'en-US'
  many?: boolean
}) {
  const [bindings, setBindings] = useState<AgentKnowledgeRetrievalItem[]>([])
  const [open, setOpen] = useState(true)
  const [queryClient] = useState(() => createPreviewQueryClient(many))
  const [i18n] = useState(() => {
    const instance = createInstance()
    void instance.use(initReactI18next).init({
      ...getInitOptions(),
      lng: locale,
      ns: ['agentV2', 'common', 'appDebug', 'workflow'],
      resources: {
        'zh-Hans': {
          agentV2: agentZh,
          common: commonZh,
          appDebug: appDebugZh,
          workflow: workflowZh,
        },
        'en-US': { agentV2: agentEn, common: commonEn, appDebug: appDebugEn, workflow: workflowEn },
      },
    })
    return instance
  })

  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <div className="min-h-screen bg-background-default p-6">
          <Button onClick={() => setOpen(true)}>
            {locale === 'zh-Hans' ? '选择知识库' : 'Select knowledge'}
          </Button>
          <output className="mt-4 block system-sm-regular text-text-secondary">
            {bindings.map((item) => item.name).join(' · ')}
          </output>
          {open && (
            <AgentKnowledgeRetrievalDialog
              initialBindings={bindings}
              onClose={() => setOpen(false)}
              onConfirm={(next) => {
                setBindings(next)
                setOpen(false)
              }}
            />
          )}
        </div>
      </I18nextProvider>
    </QueryClientProvider>
  )
}

const meta = {
  title: 'Agents/KnowledgeFS/Picker',
  component: PickerPreview,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PickerPreview>

export default meta
type Story = StoryObj<typeof meta>

export const Chinese: Story = {}
export const English: Story = { args: { locale: 'en-US' } }
export const LongList: Story = { args: { many: true } }
