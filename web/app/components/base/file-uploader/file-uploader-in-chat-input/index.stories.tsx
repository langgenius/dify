import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { FileEntity } from '../types'
import type { FileUpload } from '@/app/components/base/features/types'
import { useState } from 'react'
import { ToastProvider } from '@/app/components/base/toast'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import FileUploaderInChatInput from '.'
import { FileList } from '../file-uploader-in-chat-input/file-list'
import { FileContextProvider } from '../store'

const mockFiles: FileEntity[] = [
  {
    id: '1',
    name: 'Dataset.csv',
    size: 64000,
    type: 'text/csv',
    progress: 100,
    transferMethod: TransferMethod.local_file,
    supportFileType: SupportUploadFileTypes.document,
  },
]

const chatUploadConfig: FileUpload = {
  enabled: true,
  allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
  allowed_file_types: ['image', 'document'],
  number_limits: 3,
}

type ChatInputDemoProps = React.ComponentProps<typeof FileUploaderInChatInput> & {
  initialFiles?: FileEntity[]
}

const ChatInputDemo = ({ initialFiles = mockFiles, ...props }: ChatInputDemoProps) => {
  const [files, setFiles] = useState<FileEntity[]>(initialFiles)

  return (
    <ToastProvider>
      <FileContextProvider value={files} onChange={setFiles}>
        <div className="w-[360px] rounded-2xl border border-divider-subtle bg-components-panel-bg p-4">
          <div className="mb-3 text-xs text-text-secondary">Simulated chat input</div>
          <div className="flex items-center gap-2">
            <FileUploaderInChatInput {...props} />
            <div className="flex-1 rounded-lg border border-divider-subtle bg-background-default-subtle p-2 text-xs text-text-tertiary">Type a message...</div>
          </div>
          <div className="mt-4">
            <FileList files={files} />
          </div>
        </div>
      </FileContextProvider>
    </ToastProvider>
  )
}

const meta = {
  title: 'Base/Data Entry/FileUploaderInChatInput',
  component: ChatInputDemo,
  parameters: {
    docs: {
      description: {
        component: 'Attachment trigger suited for chat inputs. Demonstrates integration with the shared file store and preview list.',
      },
    },
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: '/chats/demo',
        params: { appId: 'demo-app' },
      },
    },
  },
  tags: ['autodocs'],
  args: {
    fileConfig: chatUploadConfig,
    initialFiles: mockFiles,
  },
} satisfies Meta<typeof ChatInputDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {
  render: args => <ChatInputDemo {...args} />,
}

export const RemoteOnly: Story = {
  args: {
    fileConfig: {
      ...chatUploadConfig,
      allowed_file_upload_methods: [TransferMethod.remote_url],
    },
    initialFiles: [],
  },
}
