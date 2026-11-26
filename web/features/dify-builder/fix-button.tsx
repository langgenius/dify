import { Button } from '@langgenius/dify-ui/button'
import { Trans } from 'react-i18next'

type BuilderFixButtonProps = {
  disabled?: boolean
  onClick: () => void
}

const BuilderFixButton = ({ disabled = false, onClick }: BuilderFixButtonProps) => {
  return (
    <Button type="button" variant="secondary" size="medium" disabled={disabled} onClick={onClick}>
      <span className="inline-flex items-center gap-1">
        <Trans
          i18nKey={($) => $.fixRun}
          ns="difyBuilder"
          components={{
            builder: <span className="inline-flex items-center gap-1 font-semibold" />,
            icon: <span aria-hidden="true" className="builder-brand-mark size-4 shrink-0" />,
          }}
        />
      </span>
    </Button>
  )
}

export default BuilderFixButton
