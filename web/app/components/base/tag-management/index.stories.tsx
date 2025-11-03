import type { Meta, StoryObj } from '@storybook/nextjs'
import { useEffect, useRef } from 'react'
import TagManagementModal from '.'
import { ToastProvider } from '@/app/components/base/toast'
import { useStore as useTagStore } from './store'
import type { Tag } from './constant'

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
  const originalFetchRef = useRef<typeof globalThis.fetch>(null)
  const tagsRef = useRef<Tag[]>(INITIAL_TAGS)
  const setTagList = useTagStore(s => s.setTagList)
  const showModal = useTagStore(s => s.showTagManagementModal)
  const setShowModal = useTagStore(s => s.setShowTagManagementModal)

  useEffect(() => {
    setTagList(tagsRef.current)
    setShowModal(true)
  }, [setTagList, setShowModal])

  useEffect(() => {
    originalFetchRef.current = globalThis.fetch?.bind(globalThis)

    const handler = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = request.url
      const method = request.method.toUpperCase()
      const parsedUrl = new URL(url, window.location.origin)

      if (parsedUrl.pathname.endsWith('/tags')) {
        if (method === 'GET') {
          const tagType = parsedUrl.searchParams.get('type') || 'app'
          const payload = tagsRef.current.filter(tag => tag.type === tagType)
          return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (method === 'POST') {
          const body = await request.clone().json() as { name: string; type: string }
          const newTag: Tag = {
            id: `tag-${Date.now()}`,
            name: body.name,
            type: body.type,
            binding_count: 0,
          }
          tagsRef.current = [newTag, ...tagsRef.current]
          setTagList(tagsRef.current)
          return new Response(JSON.stringify(newTag), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }

      if (parsedUrl.pathname.endsWith('/tag-bindings/create') || parsedUrl.pathname.endsWith('/tag-bindings/remove')) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (originalFetchRef.current)
        return originalFetchRef.current(request)

      throw new Error(`Unhandled request in mock fetch: ${url}`)
    }

    globalThis.fetch = handler as typeof globalThis.fetch

    return () => {
      if (originalFetchRef.current)
        globalThis.fetch = originalFetchRef.current
    }
  }, [setTagList])

  return (
    <ToastProvider>
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
      <TagManagementModal show={showModal} type={type} />
    </ToastProvider>
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
