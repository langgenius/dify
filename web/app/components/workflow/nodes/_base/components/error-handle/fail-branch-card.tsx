import { RiMindMap } from '@remixicon/react'
import { useTranslation } from 'react-i18next'

const FailBranchCard = () => {
  const { t } = useTranslation()

  return (
    <div className='px-4 pt-2'>
      <div className='bg-workflow-process-bg rounded-[10px] p-4'>
        <div className='bg-components-card-bg mb-2 flex h-8 w-8 items-center justify-center rounded-[10px] border-[0.5px] shadow-lg'>
          <RiMindMap className='text-text-tertiary h-5 w-5' />
        </div>
        <div className='system-sm-medium text-text-secondary mb-1'>
          {t('workflow.nodes.common.errorHandle.failBranch.customize')}
        </div>
        <div className='system-xs-regular text-text-tertiary'>
          {t('workflow.nodes.common.errorHandle.failBranch.customizeTip')}
          &nbsp;
          <a
            href='https://docs.dify.ai/guides/workflow/error-handling'
            target='_blank'
            className='text-text-accent'
          >
            {t('workflow.common.learnMore')}
          </a>
        </div>
      </div>
    </div>
  )
}

export default FailBranchCard
