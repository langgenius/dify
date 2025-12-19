import type { Meta, StoryObj } from '@storybook/nextjs'
import { useState } from 'react'
import { FileList } from './file-uploader-in-chat-input/file-list'
import type { FileEntity } from './types'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'

const SAMPLE_IMAGE = 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'160\' height=\'160\'><rect width=\'160\' height=\'160\' rx=\'16\' fill=\'#D1E9FF\'/><text x=\'50%\' y=\'50%\' dominant-baseline=\'middle\' text-anchor=\'middle\' font-family=\'sans-serif\' font-size=\'20\' fill=\'#1F2937\'>IMG</text></svg>'

const filesSample: FileEntity[] = [
  {
    id: '1',
    name: 'Project Brief.pdf',
    size: 256000,
    type: 'application/pdf',
    progress: 100,
    transferMethod: TransferMethod.local_file,
    supportFileType: SupportUploadFileTypes.document,
    url: '',
  },
  {
    id: '2',
    name: 'Design.png',
    size: 128000,
    type: 'image/png',
    progress: 100,
    transferMethod: TransferMethod.local_file,
    supportFileType: SupportUploadFileTypes.image,
    base64Url: SAMPLE_IMAGE,
  },
  {
    id: '3',
    name: 'Voiceover.mp3',
    size: 512000,
    type: 'audio/mpeg',
    progress: 45,
    transferMethod: TransferMethod.remote_url,
    supportFileType: SupportUploadFileTypes.audio,
    url: '',
  },
]

const meta = {
  title: 'Base/Data Display/FileList',
  component: FileList,
  parameters: {
    docs: {
      description: {
        component: 'Renders a responsive gallery of uploaded files, handling icons, previews, and progress states.',
      },
    },
  },
  tags: ['autodocs'],
  args: {
    files: filesSample,
  },
} satisfies Meta<typeof FileList>

export default meta
type Story = StoryObj<typeof meta>

const FileListPlayground = (args: React.ComponentProps<typeof FileList>) => {
  const [items, setItems] = useState<FileEntity[]>(args.files || [])

  return (
    <div className="rounded-2xl border border-divider-subtle bg-components-panel-bg p-4">
      <FileList
        {...args}
        files={items}
        onRemove={fileId => setItems(list => list.filter(file => file.id !== fileId))}
      />
    </div>
  )
}

export const Playground: Story = {
  render: args => <FileListPlayground {...args} />,
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
const [files, setFiles] = useState(initialFiles)

<FileList files={files} onRemove={(id) => setFiles(list => list.filter(file => file.id !== id))} />
        `.trim(),
      },
    },
  },
}

export const UploadStates: Story = {
  args: {
    files: filesSample.map(file => ({ ...file, progress: file.id === '3' ? 45 : 100 })),
  },
}
