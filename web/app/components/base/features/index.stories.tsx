import type { Meta, StoryObj } from '@storybook/nextjs'
import { useState } from 'react'
import { FeaturesProvider } from '.'
import NewFeaturePanel from './new-feature-panel'
import type { Features } from './types'

const DEFAULT_FEATURES: Features = {
  moreLikeThis: { enabled: false },
  opening: { enabled: false },
  suggested: { enabled: false },
  text2speech: { enabled: false },
  speech2text: { enabled: false },
  citation: { enabled: false },
  moderation: { enabled: false },
  file: { enabled: false },
  annotationReply: { enabled: false },
}

const meta = {
  title: 'Base/Other/FeaturesProvider',
  component: FeaturesProvider,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Zustand-backed provider used for feature toggles. Paired with `NewFeaturePanel` for workflow settings.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof FeaturesProvider>

export default meta
type Story = StoryObj<typeof meta>

const FeaturesDemo = () => {
  const [show, setShow] = useState(true)
  const [features, setFeatures] = useState<Features>(DEFAULT_FEATURES)

  return (
    <FeaturesProvider features={features}>
      <div className="flex h-[520px] items-center justify-center bg-background-default-subtle">
        <div className="rounded-xl border border-divider-subtle bg-components-panel-bg p-6 text-sm text-text-secondary shadow-inner">
          <div className="mb-4 font-medium text-text-primary">Feature toggles preview</div>
          <div className="flex gap-3">
            <button
              type="button"
              className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700"
              onClick={() => setShow(true)}
            >
              Configure features
            </button>
          </div>
        </div>
      </div>

      <NewFeaturePanel
        show={show}
        isChatMode
        disabled={false}
        onChange={next => setFeatures(prev => ({ ...prev, ...next }))}
        onClose={() => setShow(false)}
      />
    </FeaturesProvider>
  )
}

export const Playground: Story = {
  render: () => <FeaturesDemo />,
  args: {
    children: null,
  },
}
