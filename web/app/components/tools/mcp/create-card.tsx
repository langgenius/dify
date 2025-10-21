'use client'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import {
  RiAddCircleFill,
  RiArrowRightUpLine,
  RiBookOpenLine,
} from '@remixicon/react'
import MCPModal from './modal'
import I18n from '@/context/i18n'
import { getLanguage } from '@/i18n-config/language'
import { useAppContext } from '@/context/app-context'
import { useCreateMCP } from '@/service/use-tools'
import type { ToolWithProvider } from '@/app/components/workflow/types'

type Props = {
  handleCreate: (provider: ToolWithProvider) => void
}

const NewMCPCard = ({ handleCreate }: Props) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const language = getLanguage(locale)
  const { isCurrentWorkspaceManager } = useAppContext()

  const { mutateAsync: createMCP } = useCreateMCP()

  const create = async (info: any) => {
    const provider = await createMCP(info)
    handleCreate(provider)
  }

  const linkUrl = useMemo(() => {
    if (language.startsWith('zh_'))
      return 'https://docs.dify.ai/zh-hans/guides/tools/mcp'
    if (language.startsWith('ja_jp'))
      return 'https://docs.dify.ai/ja_jp/guides/tools/mcp'
    return 'https://docs.dify.ai/en/guides/tools/mcp'
  }, [language])

  const [showModal, setShowModal] = useState(false)

  return (
    <>
      {isCurrentWorkspaceManager && (
        <div className='col-span-1 flex min-h-[108px] cursor-pointer flex-col rounded-xl bg-background-default-dimmed transition-all duration-200 ease-in-out'>
          <div className='group grow rounded-t-xl' onClick={() => setShowModal(true)}>
            <div className='flex shrink-0 items-center p-4 pb-3'>
              <div className='flex h-10 w-10 items-center justify-center rounded-lg border border-dashed border-divider-deep group-hover:border-solid group-hover:border-state-accent-hover-alt group-hover:bg-state-accent-hover'>
                <RiAddCircleFill className='h-4 w-4 text-text-quaternary group-hover:text-text-accent'/>
              </div>
              <div className='system-md-semibold ml-3 text-text-secondary group-hover:text-text-accent'>{t('tools.mcp.create.cardTitle')}</div>
            </div>
          </div>
          <div className='rounded-b-xl border-t-[0.5px] border-divider-subtle px-4 py-3 text-text-tertiary hover:text-text-accent'>
            <a href={linkUrl} target='_blank' rel='noopener noreferrer' className='flex items-center space-x-1'>
              <RiBookOpenLine className='h-3 w-3 shrink-0' />
              <div className='system-xs-regular grow truncate' title={t('tools.mcp.create.cardLink') || ''}>{t('tools.mcp.create.cardLink')}</div>
              <RiArrowRightUpLine className='h-3 w-3 shrink-0' />
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
