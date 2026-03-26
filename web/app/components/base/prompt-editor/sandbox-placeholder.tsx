import type { FC, PropsWithChildren, ReactElement } from 'react'
import { Trans } from 'react-i18next'

type SandboxPlaceholderTokenProps = PropsWithChildren<{
  variant: 'kbd' | 'action'
}>

const SandboxPlaceholderToken: FC<SandboxPlaceholderTokenProps> = ({ variant, children }) => {
  if (variant === 'kbd') {
    return (
      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] bg-components-kbd-bg-gray px-1 text-text-tertiary system-kbd">
        {children}
      </span>
    )
  }

  return (
    <span className="border-b border-dotted border-current">
      {children}
    </span>
  )
}

type SandboxPlaceholderProps = {
  disableToolBlocks?: boolean
  isSupportSandbox?: boolean
}

const SandboxPlaceholder: FC<SandboxPlaceholderProps> = ({
  disableToolBlocks,
  isSupportSandbox,
}) => {
  if (!isSupportSandbox)
    return null

  const components: ReactElement[] = [
    <SandboxPlaceholderToken key="slash" variant="kbd" />,
    <SandboxPlaceholderToken key="insert" variant="action" />,
  ]

  if (!disableToolBlocks) {
    components.push(
      <SandboxPlaceholderToken key="at" variant="kbd" />,
      <SandboxPlaceholderToken key="tools" variant="action" />,
    )
  }

  return (
    <Trans
      i18nKey={disableToolBlocks ? 'promptEditor.placeholderSandboxNoTools' : 'promptEditor.placeholderSandbox'}
      ns="common"
      components={components}
    />
  )
}

export default SandboxPlaceholder
