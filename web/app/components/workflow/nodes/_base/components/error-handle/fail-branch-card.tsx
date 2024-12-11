import { RiMindMap } from '@remixicon/react'
import { useTranslation } from 'react-i18next'

const FailBranchCard = () => {
  const { t } = useTranslation()

  return (
    <div className='pt-2 px-4'>
      <div className='p-4 rounded-[10px] bg-workflow-process-bg'>
        <div className='flex items-center justify-center mb-2 w-8 h-8 rounded-[10px] border-[0.5px] bg-components-card-bg shadow-lg'>
          <RiMindMap className='w-5 h-5 text-text-tertiary' />
        </div>
        <div className='mb-1 system-sm-medium text-text-secondary'>
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
