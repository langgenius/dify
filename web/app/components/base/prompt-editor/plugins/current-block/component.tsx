import type { FC } from 'react'
import { File05 } from '@/app/components/base/icons/src/vender/solid/files'
import { GeneratorType } from '@/app/components/app/configuration/config/automatic/types'

type CurrentBlockComponentProps = {
  nodeKey: string
  generatorType: GeneratorType
}

const CurrentBlockComponent: FC<CurrentBlockComponentProps> = ({
  generatorType,
}) => {
  return (
    <div className={`
      group inline-flex h-6 items-center rounded-[5px] border border-transparent bg-[#F4F3FF] pl-1 pr-0.5 text-[#6938EF] hover:bg-[#EBE9FE]
      ${'bg-[#F4F3FF]'}
    `}>
      <File05 className='mr-1 h-[14px] w-[14px]' />
      <div className='mr-1 text-xs font-medium'>{generatorType === GeneratorType.prompt ? 'current_prompt' : 'current_code'}</div>
    </div>
  )
}

export default CurrentBlockComponent
