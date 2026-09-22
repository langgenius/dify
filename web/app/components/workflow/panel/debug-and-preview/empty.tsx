import { useTranslation } from 'react-i18next'

const Empty = () => {
  const { t } = useTranslation(['workflow'])

  return (
    <div className="absolute top-1/2 left-1/2 -translate-1/2">
      <div className="mb-2 flex justify-center">
        <span
          aria-hidden
          className="i-custom-vender-line-communication-chat-bot-slim size-12 text-gray-300"
        />
      </div>
      <div className="w-[256px] text-center text-[13px] text-gray-400">
        {t(($) => $['common.previewPlaceholder'], { ns: 'workflow' })}
      </div>
    </div>
  )
}

export default Empty
