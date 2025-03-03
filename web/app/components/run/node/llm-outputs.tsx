import { memo } from 'react'
import { Markdown } from '@/app/components/base/markdown'
type LLMOutputsProps = {
  text: string;
}
const LLMOutputs = ({ text }: LLMOutputsProps) => {
  return (
    <div className="w-full overflow-hidden p-3">
      <div className='px-4 py-3 bg-[#D1E9FF]/50 rounded-2xl text-sm text-gray-900'>
        <Markdown content={text || ''} />
      </div>
    </div>
  )
}
export default memo(LLMOutputs)
