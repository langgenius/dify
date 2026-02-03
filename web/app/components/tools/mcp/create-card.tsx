'use client'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import {
  RiAddCircleFill,
  RiArrowRightUpLine,
  RiBookOpenLine,
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
        <div className="col-span-1 flex min-h-[108px] cursor-pointer flex-col rounded-xl bg-background-default-dimmed transition-all duration-200 ease-in-out">
          <div className="group grow rounded-t-xl" onClick={() => setShowModal(true)}>
            <div className="flex shrink-0 items-center p-4 pb-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-dashed border-divider-deep group-hover:border-solid group-hover:border-state-accent-hover-alt group-hover:bg-state-accent-hover">
                <RiAddCircleFill className="h-4 w-4 text-text-quaternary group-hover:text-text-accent" />
              </div>
              <div className="system-md-semibold ml-3 text-text-secondary group-hover:text-text-accent">{t('mcp.create.cardTitle', { ns: 'tools' })}</div>
            </div>
          </div>
          <div className="rounded-b-xl border-t-[0.5px] border-divider-subtle px-4 py-3 text-text-tertiary hover:text-text-accent">
            <a href={linkUrl} target="_blank" rel="noopener noreferrer" className="flex items-center space-x-1">
              <RiBookOpenLine className="h-3 w-3 shrink-0" />
              <div className="system-xs-regular grow truncate" title={t('mcp.create.cardLink', { ns: 'tools' }) || ''}>{t('mcp.create.cardLink', { ns: 'tools' })}</div>
              <RiArrowRightUpLine className="h-3 w-3 shrink-0" />
            </a>
          </div>
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
