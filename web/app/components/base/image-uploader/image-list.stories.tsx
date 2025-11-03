import type { Meta, StoryObj } from '@storybook/nextjs'
import { useMemo, useState } from 'react'
import ImageList from './image-list'
import ImageLinkInput from './image-link-input'
import type { ImageFile } from '@/types/app'
import { TransferMethod } from '@/types/app'

const SAMPLE_BASE64
  = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAADICAYAAACtWK6eAAAACXBIWXMAAAsSAAALEgHS3X78AAABbElEQVR4nO3SsQkAIBDARMT+V20sTg6LXhWEATnnMHDx4sWLFi1atGjRokWLFi1atGjRokWLFi1atGjRokWLFi1atGjRokWLFi1atGjRokWLFi1atGjRokWLFi1atGjRokWLFi1atGjRokWLFi1atGjRokWLFi1atGjRokWLFi1atGjRokWLFi1atGjRokWLFi1atGjRokWLFi1atGjRokWLFi1atGjRokWLFi1atGjRokWLFi1atGjRokWLFi1atGjRokWLFu2r/H3n4BG518Gr4AAAAASUVORK5CYII='

const createRemoteImage = (
  id: string,
  progress: number,
  url: string,
): ImageFile => ({
  type: TransferMethod.remote_url,
  _id: id,
  fileId: `remote-${id}`,
  progress,
  url,
})

const createLocalImage = (id: string, progress: number): ImageFile => ({
  type: TransferMethod.local_file,
  _id: id,
  fileId: `local-${id}`,
  progress,
  url: SAMPLE_BASE64,
  base64Url: SAMPLE_BASE64,
})

const initialImages: ImageFile[] = [
  createLocalImage('local-initial', 100),
  createRemoteImage(
    'remote-loading',
    40,
    'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=300&q=80',
  ),
  {
    ...createRemoteImage(
      'remote-error',
      -1,
      'https://example.com/not-an-image.jpg',
    ),
    url: 'https://example.com/not-an-image.jpg',
  },
]

const meta = {
  title: 'Base/Data Entry/ImageList',
  component: ImageList,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Renders thumbnails for uploaded images and manages their states like uploading, error, and deletion.',
      },
    },
  },
  argTypes: {
    list: { control: false },
    onRemove: { control: false },
    onReUpload: { control: false },
    onImageLinkLoadError: { control: false },
    onImageLinkLoadSuccess: { control: false },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ImageList>

export default meta
type Story = StoryObj<typeof meta>

const ImageUploaderPlayground = ({ readonly }: Story['args']) => {
  const [images, setImages] = useState<ImageFile[]>(() => initialImages)

  const activeImages = useMemo(() => images.filter(item => !item.deleted), [images])

  const handleRemove = (id: string) => {
    setImages(prev => prev.map(item => (item._id === id ? { ...item, deleted: true } : item)))
  }

  const handleReUpload = (id: string) => {
    setImages(prev => prev.map((item) => {
      if (item._id !== id)
        return item

      return {
        ...item,
        progress: 60,
      }
    }))

    setTimeout(() => {
      setImages(prev => prev.map((item) => {
        if (item._id !== id)
          return item

        return {
          ...item,
          progress: 100,
        }
      }))
    }, 1200)
  }

  const handleImageLinkLoadSuccess = (id: string) => {
    setImages(prev => prev.map(item => (item._id === id ? { ...item, progress: 100 } : item)))
  }

  const handleImageLinkLoadError = (id: string) => {
    setImages(prev => prev.map(item => (item._id === id ? { ...item, progress: -1 } : item)))
  }

  const handleUploadFromLink = (imageFile: ImageFile) => {
    setImages(prev => [
      ...prev,
      {
        ...imageFile,
        fileId: `remote-${imageFile._id}`,
      },
    ])
  }

  const handleAddLocalImage = () => {
    const id = `local-${Date.now()}`
    setImages(prev => [
      ...prev,
      createLocalImage(id, 100),
    ])
  }

  return (
    <div className="flex w-[360px] flex-col gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-4">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-[0.18em] text-text-tertiary">Add images</span>
        <div className="flex items-center gap-2">
          <ImageLinkInput onUpload={handleUploadFromLink} disabled={readonly} />
          <button
            type="button"
            className="rounded-md border border-divider-subtle px-2 py-1 text-xs font-medium text-text-secondary hover:bg-state-base-hover disabled:cursor-not-allowed disabled:text-text-tertiary"
            onClick={handleAddLocalImage}
            disabled={readonly}
          >
            Simulate local
          </button>
        </div>
      </div>

      <ImageList
        list={activeImages}
        readonly={readonly}
        onRemove={handleRemove}
        onReUpload={handleReUpload}
        onImageLinkLoadSuccess={handleImageLinkLoadSuccess}
        onImageLinkLoadError={handleImageLinkLoadError}
      />

      <div className="rounded-lg border border-divider-subtle bg-background-default p-2">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">
          Files state
        </span>
        <pre className="max-h-40 overflow-auto text-[11px] leading-relaxed text-text-tertiary">
          {JSON.stringify(activeImages, null, 2)}
        </pre>
      </div>
    </div>
  )
}

export const Playground: Story = {
  render: args => <ImageUploaderPlayground {...args} />,
  args: {
    list: [],
  },
}

export const ReadonlyList: Story = {
  render: args => <ImageUploaderPlayground {...args} />,
  args: {
    list: [],
  },
}
