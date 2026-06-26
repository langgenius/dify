'use client'

import type { AgentFileNode } from '@/features/agent-v2/agent-composer/form-state'
import {
  Drawer,
  DrawerBackdrop,
  DrawerCloseButton,
  DrawerContent,
  DrawerDescription,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { FileTreeFile } from '@langgenius/dify-ui/file-tree'
import { useTranslation } from 'react-i18next'
import { AgentFileTree } from '../orchestrate/files/tree'

type AgentWorkingDirectoryPanelProps = {
  onOpenChange: (open: boolean) => void
  open: boolean
}

const workingDirectoryFiles: AgentFileNode[] = [
  {
    id: 'working-directory/_index.json',
    name: '_index.json',
    icon: 'json',
    driveKey: 'working-directory/_index.json',
  },
  {
    id: 'working-directory/web-game',
    name: 'web-game',
    icon: 'folder',
    driveKey: 'working-directory/web-game',
    children: [
      {
        id: 'working-directory/web-game/public',
        name: 'public',
        icon: 'folder',
        driveKey: 'working-directory/web-game/public',
      },
      {
        id: 'working-directory/web-game/assets',
        name: 'assets',
        icon: 'folder',
        driveKey: 'working-directory/web-game/assets',
      },
      {
        id: 'working-directory/web-game/src',
        name: 'src',
        icon: 'folder',
        driveKey: 'working-directory/web-game/src',
      },
      {
        id: 'working-directory/web-game/styles',
        name: 'styles',
        icon: 'folder',
        driveKey: 'working-directory/web-game/styles',
      },
      {
        id: 'working-directory/web-game/README.md',
        name: 'README.md',
        icon: 'markdown',
        driveKey: 'working-directory/web-game/README.md',
      },
    ],
  },
]

const selectedWorkingDirectoryFileId = 'working-directory/web-game/README.md'

export function AgentWorkingDirectoryPanel({
  onOpenChange,
  open,
}: AgentWorkingDirectoryPanelProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')

  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="right">
      <DrawerPortal>
        <DrawerBackdrop forceRender className="fixed bg-transparent" />
        <DrawerViewport>
          <DrawerPopup className="data-[swipe-direction=right]:top-2 data-[swipe-direction=right]:bottom-2 data-[swipe-direction=right]:h-auto data-[swipe-direction=right]:w-[360px]">
            <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
              <div className="flex shrink-0 items-start gap-2 px-4 pt-3 pb-2">
                <div className="min-w-0 flex-1">
                  <DrawerTitle className="truncate system-xl-semibold text-text-primary">
                    {t('agentDetail.configure.workingDirectory.title')}
                  </DrawerTitle>
                  <DrawerDescription className="body-xs-regular text-text-tertiary">
                    {t('agentDetail.configure.workingDirectory.description')}
                  </DrawerDescription>
                </div>
                <DrawerCloseButton
                  aria-label={tCommon('operation.close')}
                  className="size-6 rounded-md p-0.5"
                />
              </div>
              <AgentFileTree
                files={workingDirectoryFiles}
                selectedFileId={selectedWorkingDirectoryFileId}
                treeLabel={t('agentDetail.configure.workingDirectory.treeLabel')}
                className="min-h-0 flex-1 px-3 py-1"
                scrollAreaClassName="flex-1"
                rootClassName="p-0"
                listClassName="gap-px"
                renderFile={({ selected, children }) => (
                  <FileTreeFile selected={selected}>
                    {children}
                    {selected && (
                      <span aria-hidden className="ms-auto i-ri-more-fill flex size-5 shrink-0 items-center justify-center text-text-tertiary" />
                    )}
                  </FileTreeFile>
                )}
              />
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}
