import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { DataSourceCredential } from '@/app/components/header/account-setting/data-source-page-new/types'
import type { NotionPage } from '@/models/common'
import { useEffect, useMemo, useState } from 'react'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import { NotionPageSelector } from '.'

const DATASET_ID = 'dataset-demo'
const CREDENTIALS: DataSourceCredential[] = [
  {
    id: 'cred-1',
    name: 'Marketing Workspace',
    type: CredentialTypeEnum.OAUTH2,
    is_default: true,
    avatar_url: '',
    credential: {
      workspace_name: 'Marketing Workspace',
      workspace_icon: null,
      workspace_id: 'workspace-1',
    },
  },
  {
    id: 'cred-2',
    name: 'Product Workspace',
    type: CredentialTypeEnum.OAUTH2,
    is_default: false,
    avatar_url: '',
    credential: {
      workspace_name: 'Product Workspace',
      workspace_icon: null,
      workspace_id: 'workspace-2',
    },
  },
]

const marketingPages = {
  notion_info: [
    {
      workspace_name: 'Marketing Workspace',
      workspace_id: 'workspace-1',
      workspace_icon: null,
      pages: [
        {
          page_icon: { type: 'emoji', emoji: '\u{1F4CB}', url: null },
          page_id: 'briefs',
          page_name: 'Campaign Briefs',
          parent_id: 'root',
          type: 'page',
          is_bound: false,
        },
        {
          page_icon: { type: 'emoji', emoji: '\u{1F4DD}', url: null },
          page_id: 'notes',
          page_name: 'Meeting Notes',
          parent_id: 'root',
          type: 'page',
          is_bound: true,
        },
        {
          page_icon: { type: 'emoji', emoji: '\u{1F30D}', url: null },
          page_id: 'localizations',
          page_name: 'Localization Pipeline',
          parent_id: 'briefs',
          type: 'page',
          is_bound: false,
        },
      ],
    },
  ],
}

const productPages = {
  notion_info: [
    {
      workspace_name: 'Product Workspace',
      workspace_id: 'workspace-2',
      workspace_icon: null,
      pages: [
        {
          page_icon: { type: 'emoji', emoji: '\u{1F4A1}', url: null },
          page_id: 'ideas',
          page_name: 'Idea Backlog',
          parent_id: 'root',
          type: 'page',
          is_bound: false,
        },
        {
          page_icon: { type: 'emoji', emoji: '\u{1F9EA}', url: null },
          page_id: 'experiments',
          page_name: 'Experiments',
          parent_id: 'ideas',
          type: 'page',
          is_bound: false,
        },
      ],
    },
  ],
}

type NotionApiResponse = typeof marketingPages
const emptyNotionResponse: NotionApiResponse = { notion_info: [] }

const useMockNotionApi = () => {
  const responseMap = useMemo(() => ({
    [`${DATASET_ID}:cred-1`]: marketingPages,
    [`${DATASET_ID}:cred-2`]: productPages,
  }) satisfies Record<`${typeof DATASET_ID}:${typeof CREDENTIALS[number]['id']}`, NotionApiResponse>, [])

  useEffect(() => {
    const originalFetch = globalThis.fetch?.bind(globalThis)

    const handler = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

      if (url.includes('/notion/pre-import/pages')) {
        const parsed = new URL(url, globalThis.location.origin)
        const datasetId = parsed.searchParams.get('dataset_id') || ''
        const credentialId = parsed.searchParams.get('credential_id') || ''
        let payload: NotionApiResponse = emptyNotionResponse

        if (datasetId === DATASET_ID) {
          const credential = CREDENTIALS.find(item => item.id === credentialId)
          if (credential) {
            const mapKey = `${DATASET_ID}:${credential.id}` as keyof typeof responseMap
            payload = responseMap[mapKey]
          }
        }

        return new Response(
          JSON.stringify(payload),
          { headers: { 'Content-Type': 'application/json' }, status: 200 },
        )
      }

      if (originalFetch)
        return originalFetch(input, init)

      throw new Error(`Unmocked fetch call for ${url}`)
    }

    globalThis.fetch = handler as typeof globalThis.fetch

    return () => {
      if (originalFetch)
        globalThis.fetch = originalFetch
    }
  }, [responseMap])
}

const NotionSelectorPreview = () => {
  const [selectedPages, setSelectedPages] = useState<NotionPage[]>([])
  const [credentialId, setCredentialId] = useState<string>()

  useMockNotionApi()

  return (
    <div className="flex w-full max-w-3xl flex-col gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <NotionPageSelector
        datasetId={DATASET_ID}
        credentialList={CREDENTIALS}
        value={selectedPages.map(page => page.page_id)}
        onSelect={setSelectedPages}
        onSelectCredential={setCredentialId}
        canPreview
      />
      <div className="rounded-xl border border-divider-subtle bg-background-default-subtle p-4 text-xs text-text-secondary">
        <div className="mb-2 font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          Debug state
        </div>
        <p className="mb-1">
          Active credential:
          <span className="font-mono">{credentialId || 'None'}</span>
        </p>
        <pre className="max-h-40 overflow-auto rounded-lg bg-background-default p-3 font-mono text-[11px] leading-relaxed text-text-tertiary">
          {JSON.stringify(selectedPages, null, 2)}
        </pre>
      </div>
    </div>
  )
}

const meta = {
  title: 'Base/Other/NotionPageSelector',
  component: NotionSelectorPreview,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Credential-aware selector that fetches Notion pages and lets users choose which ones to sync.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof NotionSelectorPreview>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}
