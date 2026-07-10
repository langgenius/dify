'use client'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import { useCanManageMCP } from '@/app/components/tools/hooks/use-tool-permissions'
import { useDocLink } from '@/context/i18n'
import { useCreateMCP } from '@/service/use-tools'
import CreateEntryCard from '../provider/create-entry-card'
import MCPModal from './modal'

type Props = Readonly<{
  handleCreate: (provider: ToolWithProvider) => Promise<void> | void
}>

function useMCPCreateAction({ handleCreate }: Props) {
  const canManageMCP = useCanManageMCP()
  const { mutateAsync: createMCP } = useCreateMCP()
  const [showModal, setShowModal] = useState(false)

  const create = async (info: Parameters<typeof createMCP>[0]) => {
    if (!canManageMCP)
      return

    const provider = await createMCP(info)
    await handleCreate(provider)
  }

  return {
    canManageMCP,
    create,
    setShowModal,
    showModal,
  }
}

export function NewMCPButton({ handleCreate }: Props) {
  const { t } = useTranslation()
  const addMCPServerLabel = t($ => $['mcp.create.cardTitle'], { ns: 'tools' })
  const {
    canManageMCP,
    create,
    setShowModal,
    showModal,
  } = useMCPCreateAction({ handleCreate })

  if (!canManageMCP)
    return null

  return (
    <>
      <Button
        variant="secondary"
        className="gap-0.5 px-3!"
        data-step-by-step-tour-target={STEP_BY_STEP_TOUR_TARGETS.integrationMcpAdd}
        onClick={() => setShowModal(true)}
        title={addMCPServerLabel}
        aria-label={addMCPServerLabel}
      >
        <span aria-hidden className="i-ri-add-line size-4 shrink-0" />
        {addMCPServerLabel}
      </Button>
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

const NewMCPCard = ({ handleCreate }: Props) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const {
    canManageMCP,
    create,
    setShowModal,
    showModal,
  } = useMCPCreateAction({ handleCreate })

  const linkUrl = useMemo(() => docLink('/use-dify/workspace/tools#mcp'), [docLink])

  return (
    <>
      {canManageMCP && (
        <CreateEntryCard
          title={t($ => $['mcp.create.cardTitle'], { ns: 'tools' })}
          linkText={t($ => $['mcp.create.cardLink'], { ns: 'tools' })}
          linkUrl={linkUrl}
          onCreate={() => setShowModal(true)}
        />
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
