'use client'

import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import cn from 'classnames'

const PromptTemplatesNav = () => {
  const selectedLayoutSegment = useSelectedLayoutSegment()
  const isSelected = selectedLayoutSegment === 'prompt-templates'

  return (
    <Link
      href="/prompt-templates"
      className={cn(
        'flex items-center mr-3 px-3 h-8 text-sm font-medium rounded-lg',
        isSelected
          ? 'bg-primary-50 text-primary-600'
          : 'text-gray-700 hover:bg-gray-200'
      )}
    >
      Prompts
    </Link>
  )
}

export default PromptTemplatesNav 