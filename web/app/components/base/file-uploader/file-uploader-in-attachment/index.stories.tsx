import type { Meta, StoryObj } from '@storybook/nextjs'
import { fn } from 'storybook/test'
import { useState } from 'react'
import FileUploaderInAttachmentWrapper from './index'
import type { FileEntity } from '../types'
import type { FileUpload } from '@/app/components/base/features/types'
import { PreviewMode } from '@/app/components/base/features/types'
import { TransferMethod } from '@/types/app'
import { ToastProvider } from '@/app/components/base/toast'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'

const SAMPLE_IMAGE = 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'128\' height=\'128\'><rect width=\'128\' height=\'128\' rx=\'16\' fill=\'#E0F2FE\'/><text x=\'50%\' y=\'50%\' dominant-baseline=\'middle\' text-anchor=\'middle\' font-family=\'sans-serif\' font-size=\'18\' fill=\'#1F2937\'>IMG</text></svg>'

const mockFiles: FileEntity[] = [
  {
    id: 'file-1',
    name: 'Requirements.pdf',
    size: 256000,
    type: 'application/pdf',
    progress: 100,
    transferMethod: TransferMethod.local_file,
    supportFileType: SupportUploadFileTypes.document,
    url: '',
  },
  {
    id: 'file-2',
    name: 'Interface.png',
    size: 128000,
    type: 'image/png',
    progress: 100,
    transferMethod: TransferMethod.local_file,
    supportFileType: SupportUploadFileTypes.image,
    base64Url: SAMPLE_IMAGE,
  },
  {
    id: 'file-3',
    name: 'Voiceover.mp3',
    size: 512000,
    type: 'audio/mpeg',
    progress: 35,
    transferMethod: TransferMethod.remote_url,
    supportFileType: SupportUploadFileTypes.audio,
    url: '',
  },
]

const fileConfig: FileUpload = {
  enabled: true,
  allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
  allowed_file_types: ['document', 'image', 'audio'],
  number_limits: 5,
  preview_config: { mode: PreviewMode.NewPage, file_type_list: ['pdf', 'png'] },
}

const meta = {
  title: 'Base/Data Entry/FileUploaderInAttachment',
  component: FileUploaderInAttachmentWrapper,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Attachment-style uploader that supports local files and remote links. Demonstrates upload progress, re-upload, and preview actions.',
      },
    },
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: '/apps/demo-app/uploads',
        params: { appId: 'demo-app' },
      },
    },
  },
  tags: ['autodocs'],
  args: {
    fileConfig,
  },
} satisfies Meta<typeof FileUploaderInAttachmentWrapper>

export default meta
type Story = StoryObj<typeof meta>

const AttachmentDemo = (props: React.ComponentProps<typeof FileUploaderInAttachmentWrapper>) => {
  const [files, setFiles] = useState<FileEntity[]>(mockFiles)

  return (
    <ToastProvider>
      <div className="w-[320px] rounded-2xl border border-divider-subtle bg-components-panel-bg p-4 shadow-xs">
        <FileUploaderInAttachmentWrapper
          {...props}
          value={files}
          onChange={setFiles}
        />
      </div>
    </ToastProvider>
  )
}

export const Playground: Story = {
  render: args => <AttachmentDemo {...args} />,
  args: {
    onChange: fn(),
  },
}

export const Disabled: Story = {
  render: args => <AttachmentDemo {...args} isDisabled />,
  args: {
    onChange: fn(),
  },
}
