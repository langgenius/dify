'use client'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppContext } from '@/context/app-context'
import { useDocLink } from '@/context/i18n'
import { useCreateMCP } from '@/service/use-tools'
import CreateEntryCard from '../provider/create-entry-card'
import MCPModal from './modal'

type Props = Readonly<{
  handleCreate: (provider: ToolWithProvider) => Promise<void> | void
}>

function useMCPCreateAction({ handleCreate }: Props) {
  const { isCurrentWorkspaceManager } = useAppContext()
  const { mutateAsync: createMCP } = useCreateMCP()
  const [showModal, setShowModal] = useState(false)

  const create = async (info: Parameters<typeof createMCP>[0]) => {
    const provider = await createMCP(info)
    await handleCreate(provider)
  }

  return {
    create,
    isCurrentWorkspaceManager,
    setShowModal,
    showModal,
  }
}

export function NewMCPButton({ handleCreate }: Props) {
  const { t } = useTranslation()
  const addMCPServerLabel = t('mcp.create.cardTitle', { ns: 'tools' })
  const {
    create,
    isCurrentWorkspaceManager,
    setShowModal,
    showModal,
  } = useMCPCreateAction({ handleCreate })

  if (!isCurrentWorkspaceManager)
    return null

  return (
    <>
      <Button
        variant="secondary"
        className="gap-0.5 px-3!"
        onClick={() => setShowModal(true)}
        title={addMCPServerLabel}
        aria-label={addMCPServerLabel}
      >
        <span aria-hidden className="i-ri-add-line size-4 shrink-0" />
        {addMCPServerLabel}
      </Button>
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

const NewMCPCard = ({ handleCreate }: Props) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const {
    create,
    isCurrentWorkspaceManager,
    setShowModal,
    showModal,
  } = useMCPCreateAction({ handleCreate })

  const linkUrl = useMemo(() => docLink('/use-dify/build/mcp'), [docLink])

  return (
    <>
      {isCurrentWorkspaceManager && (
        <CreateEntryCard
          title={t('mcp.create.cardTitle', { ns: 'tools' })}
          linkText={t('mcp.create.cardLink', { ns: 'tools' })}
          linkUrl={linkUrl}
          onCreate={() => setShowModal(true)}
        />
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
