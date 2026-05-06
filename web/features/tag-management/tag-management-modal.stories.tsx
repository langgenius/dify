import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { Tag } from '@/contract/console/tags'
import { ToastHost } from '@langgenius/dify-ui/toast'
import { useEffect, useState } from 'react'
import { TagManagementModal } from '@/features/tag-management/components/tag-management-modal'

const INITIAL_TAGS: Tag[] = [
  { id: 'tag-product', name: 'Product', type: 'app', binding_count: 12 },
  { id: 'tag-growth', name: 'Growth', type: 'app', binding_count: 4 },
  { id: 'tag-beta', name: 'Beta User', type: 'app', binding_count: 2 },
  { id: 'tag-rag', name: 'RAG', type: 'knowledge', binding_count: 3 },
  { id: 'tag-updates', name: 'Release Notes', type: 'knowledge', binding_count: 6 },
]

const TagManagementPlayground = ({
  type = 'app',
}: {
  type?: 'app' | 'knowledge'
}) => {
  const [showModal, setShowModal] = useState(true)

  useEffect(() => {
    const originalFetch = globalThis.fetch?.bind(globalThis)
    let tags = [...INITIAL_TAGS]

    const handler = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = request.url
      const method = request.method.toUpperCase()
      const parsedUrl = new URL(url, window.location.origin)

      if (parsedUrl.pathname.endsWith('/tags')) {
        if (method === 'GET') {
          const tagType = parsedUrl.searchParams.get('type') || 'app'
          const payload = tags.filter(tag => tag.type === tagType)
          return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (method === 'POST') {
          const body = await request.clone().json() as { name: string, type: Tag['type'] }
          const newTag: Tag = {
            id: `tag-${Date.now()}`,
            name: body.name,
            type: body.type,
            binding_count: 0,
          }
          tags = [newTag, ...tags]
          return new Response(JSON.stringify(newTag), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }

      if (parsedUrl.pathname.endsWith('/tag-bindings') || parsedUrl.pathname.endsWith('/tag-bindings/remove')) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (originalFetch)
        return originalFetch(request)

      throw new Error(`Unhandled request in mock fetch: ${url}`)
    }

    globalThis.fetch = handler as typeof globalThis.fetch

    return () => {
      if (originalFetch)
        globalThis.fetch = originalFetch
    }
  }, [])

  return (
    <>
      <ToastHost />
      <div className="flex w-full max-w-xl flex-col gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
        <button
          type="button"
          className="self-start rounded-md border border-divider-subtle bg-background-default px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-state-base-hover"
          onClick={() => setShowModal(true)}
        >
          Manage tags
        </button>
        <p className="text-xs text-text-tertiary">Mocked tag management flows with create and bind actions.</p>
      </div>
      <TagManagementModal show={showModal} type={type} onClose={() => setShowModal(false)} />
    </>
  )
}

const meta = {
  title: 'Base/Data Display/TagManagementModal',
  component: TagManagementPlayground,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Complete tag management modal with mocked service calls for browsing and creating tags.',
      },
    },
  },
  argTypes: {
    type: {
      control: 'radio',
      options: ['app', 'knowledge'],
    },
  },
  args: {
    type: 'app',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof TagManagementPlayground>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}
