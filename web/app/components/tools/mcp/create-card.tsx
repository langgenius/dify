'use client'
import type { ComponentProps } from 'react'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { useDocLink } from '@/context/i18n'
import { useCreateMCP } from '@/service/use-tools'
import { hasPermission } from '@/utils/permission'
import MCPModal from './modal'

type Props = {
  handleCreate: (provider: ToolWithProvider) => void
}

type MCPModalConfirmPayload = Parameters<ComponentProps<typeof MCPModal>['onConfirm']>[0]

const NewMCPCard = ({ handleCreate }: Props) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const workspacePermissionKeys = useAppContextWithSelector(state => state.workspacePermissionKeys)
  const canManageMCP = hasPermission(workspacePermissionKeys, 'mcp.manage')

  const { mutateAsync: createMCP } = useCreateMCP()

  const create = async (info: MCPModalConfirmPayload) => {
    if (!canManageMCP)
      return

    const provider = await createMCP(info)
    handleCreate(provider)
  }

  const linkUrl = useMemo(() => docLink('/use-dify/build/mcp'), [docLink])

  const [showModal, setShowModal] = useState(false)

  return (
    <>
      {canManageMCP && (
        <div className="col-span-1 flex min-h-[108px] cursor-pointer flex-col rounded-xl bg-background-default-dimmed transition-all duration-200 ease-in-out">
          <div className="group grow rounded-t-xl" onClick={() => setShowModal(true)}>
            <div className="flex shrink-0 items-center p-4 pb-3">
              <div className="flex size-10 items-center justify-center rounded-lg border border-dashed border-divider-deep group-hover:border-solid group-hover:border-state-accent-hover-alt group-hover:bg-state-accent-hover">
                <span className="i-ri-add-circle-fill size-4 text-text-quaternary group-hover:text-text-accent" />
              </div>
              <div className="ml-3 system-md-semibold text-text-secondary group-hover:text-text-accent">{t('mcp.create.cardTitle', { ns: 'tools' })}</div>
            </div>
          </div>
          <div className="rounded-b-xl border-t-[0.5px] border-divider-subtle px-4 py-3 text-text-tertiary hover:text-text-accent">
            <a href={linkUrl} target="_blank" rel="noopener noreferrer" className="flex items-center space-x-1">
              <span className="i-ri-book-open-line size-3 shrink-0" />
              <div className="grow truncate system-xs-regular" title={t('mcp.create.cardLink', { ns: 'tools' }) || ''}>{t('mcp.create.cardLink', { ns: 'tools' })}</div>
              <span className="i-ri-arrow-right-up-line size-3 shrink-0" />
            </a>
          </div>
        </div>
      )}
      {canManageMCP && showModal && (
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
