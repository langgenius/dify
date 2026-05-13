'use client'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import {
  RiAddLine,
  RiArrowRightUpLine,
} from '@remixicon/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppContext } from '@/context/app-context'
import { useDocLink } from '@/context/i18n'
import { useCreateMCP } from '@/service/use-tools'
import MCPModal from './modal'

type Props = {
  handleCreate: (provider: ToolWithProvider) => void
}

const NewMCPCard = ({ handleCreate }: Props) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const { isCurrentWorkspaceManager } = useAppContext()

  const { mutateAsync: createMCP } = useCreateMCP()

  const create = async (info: any) => {
    const provider = await createMCP(info)
    handleCreate(provider)
  }

  const linkUrl = useMemo(() => docLink('/use-dify/build/mcp'), [docLink])

  const [showModal, setShowModal] = useState(false)

  return (
    <>
      {isCurrentWorkspaceManager && (
        <div className="col-span-1 flex h-[120px] flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-md">
          <button
            type="button"
            className="group flex h-[84px] w-full cursor-pointer items-center gap-3 p-4 text-left outline-hidden hover:bg-components-panel-on-panel-item-bg-hover focus-visible:ring-1 focus-visible:ring-components-input-border-hover"
            onClick={() => setShowModal(true)}
          >
            <div className="flex size-10 shrink-0 items-center justify-center">
              <div className="flex size-10 items-center justify-center rounded-lg border-[0.5px] border-dashed border-divider-regular bg-background-body">
                <RiAddLine className="size-4 text-text-quaternary group-hover:text-text-accent" />
              </div>
            </div>
            <div className="min-w-0 flex-1 py-px">
              <div className="truncate system-md-semibold text-text-primary group-hover:text-text-accent" title={t('mcp.create.cardTitle', { ns: 'tools' }) || ''}>
                {t('mcp.create.cardTitle', { ns: 'tools' })}
              </div>
            </div>
          </button>
          <a
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-8 items-center gap-0.5 border-t border-divider-subtle px-3 py-2 text-components-button-secondary-text outline-hidden hover:bg-components-panel-on-panel-item-bg-hover hover:text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-hover"
          >
            <div className="min-w-0 flex-1 px-0.5">
              <div className="truncate system-sm-medium" title={t('mcp.create.cardLink', { ns: 'tools' }) || ''}>{t('mcp.create.cardLink', { ns: 'tools' })}</div>
            </div>
            <RiArrowRightUpLine className="size-4 shrink-0" />
          </a>
        </div>
      )}
      {showModal && (
        <MCPModal
          show={showModal}
          onConfirm={create}
          onHide={() => setShowModal(false)}
        />
      )}
    </>
  )
}
export default NewMCPCard
