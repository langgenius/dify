import { RiMindMap } from '@remixicon/react'
import { useTranslation } from 'react-i18next'

const FailBranchCard = () => {
  const { t } = useTranslation()

  return (
    <div className='px-4 pt-2'>
      <div className='rounded-[10px] bg-workflow-process-bg p-4'>
        <div className='mb-2 flex h-8 w-8 items-center justify-center rounded-[10px] border-[0.5px] bg-components-card-bg shadow-lg'>
          <RiMindMap className='h-5 w-5 text-text-tertiary' />
        </div>
        <div className='system-sm-medium mb-1 text-text-secondary'>
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
