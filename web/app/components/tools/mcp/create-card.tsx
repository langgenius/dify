'use client'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppContext } from '@/context/app-context'
import { useDocLink } from '@/context/i18n'
import { useCreateMCP } from '@/service/use-tools'
import CreateEntryCard from '../provider/create-entry-card'
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
