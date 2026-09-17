import { Button } from '@langgenius/dify-ui/button'
import { Trans } from 'react-i18next'

type DifyBuilderEntryProps = {
  disabled?: boolean
  onClick: () => void
}

const DifyBuilderEntry = ({ disabled = false, onClick }: DifyBuilderEntryProps) => {
  return (
    <Button type="button" variant="secondary" size="medium" disabled={disabled} onClick={onClick}>
      <span className="inline-flex items-center gap-1">
        <Trans
          i18nKey={($) => $['difyBuilder.fixRun']}
          ns="workflow"
          components={{
            builder: <span className="inline-flex items-center gap-1 font-semibold" />,
            icon: (
              <span
                aria-hidden="true"
                className="i-custom-public-app-builder-builder-mark size-4 shrink-0"
              />
            ),
          }}
        />
      </span>
    </Button>
  )
}

export default DifyBuilderEntry
