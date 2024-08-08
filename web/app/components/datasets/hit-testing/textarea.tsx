import { useTranslation } from 'react-i18next'
import Button from '../../base/button'
import Tag from '../../base/tag'
import Tooltip from '../../base/tooltip'
import { getIcon } from '../common/retrieval-method-info'
import s from './style.module.css'
import cn from '@/utils/classnames'
import type { HitTestingResponse } from '@/models/datasets'
import { hitTesting } from '@/service/datasets'
import { asyncRunSafe } from '@/utils'
import { RETRIEVE_METHOD, type RetrievalConfig } from '@/types/app'

type TextAreaWithButtonIProps = {
  datasetId: string
  onUpdateList: () => void
  setHitResult: (res: HitTestingResponse) => void
  loading: boolean
  setLoading: (v: boolean) => void
  text: string
  setText: (v: string) => void
  onClickRetrievalMethod: () => void
  retrievalConfig: RetrievalConfig
  isEconomy: boolean
  onSubmit?: () => void
}

const TextAreaWithButton = ({
  datasetId,
  onUpdateList,
  setHitResult,
  setLoading,
  loading,
  text,
  setText,
  onClickRetrievalMethod,
  retrievalConfig,
  isEconomy,
  onSubmit: _onSubmit,
}: TextAreaWithButtonIProps) => {
  const { t } = useTranslation()

  function handleTextChange(event: any) {
    setText(event.target.value)
  }

  const onSubmit = async () => {
    setLoading(true)
    const [e, res] = await asyncRunSafe<HitTestingResponse>(
      hitTesting({
        datasetId,
        queryText: text,
        retrieval_model: {
          ...retrievalConfig,
          search_method: isEconomy ? RETRIEVE_METHOD.keywordSearch : retrievalConfig.search_method,
        },
      }) as Promise<HitTestingResponse>,
    )
    if (!e) {
      setHitResult(res)
      onUpdateList?.()
    }
    setLoading(false)
    _onSubmit && _onSubmit()
  }

  const retrievalMethod = isEconomy ? RETRIEVE_METHOD.invertedIndex : retrievalConfig.search_method
  const Icon = getIcon(retrievalMethod)
  return (
    <>
      <div className={s.wrapper}>
        <div className='pt-2 rounded-tl-xl rounded-tr-xl bg-[#EEF4FF]'>
          <div className="px-4 pb-2 flex justify-between h-8 items-center">
            <span className="text-gray-800 font-semibold text-sm">
              {t('datasetHitTesting.input.title')}
            </span>
            <Tooltip
              selector={'change-retrieval-method'}
              htmlContent={t('dataset.retrieval.changeRetrievalMethod')}
            >
              <div
                onClick={onClickRetrievalMethod}
                className='flex px-2 h-7 items-center space-x-1 bg-white hover:bg-[#ECE9FE] rounded-md shadow-sm cursor-pointer text-[#6927DA]'
              >
                <Icon className='w-3.5 h-3.5'></Icon>
                <div className='text-xs font-medium'>{t(`dataset.retrieval.${retrievalMethod}.title`)}</div>
              </div>
            </Tooltip>
          </div>
          <div className='h-2 rounded-tl-xl rounded-tr-xl bg-white'></div>
        </div>
        <div className='px-4 pb-11'>
          <textarea
            value={text}
            onChange={handleTextChange}
            placeholder={t('datasetHitTesting.input.placeholder') as string}
            className={s.textarea}
          />
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between mx-4 mt-2 mb-2">
            {text?.length > 200
              ? (
                <Tooltip
                  content={t('datasetHitTesting.input.countWarning') as string}
                  selector="hit-testing-warning"
                >
                  <div>
                    <Tag color="red" className="!text-red-600">
                      {text?.length}
                      <span className="text-red-300 mx-0.5">/</span>
                      200
                    </Tag>
                  </div>
                </Tooltip>
              )
              : (
                <Tag
                  color="gray"
                  className={cn('!text-gray-500', text?.length ? '' : 'opacity-50')}
                >
                  {text?.length}
                  <span className="text-gray-300 mx-0.5">/</span>
                  200
                </Tag>
              )}

            <div>
              <Button
                onClick={onSubmit}
                variant="primary"
                loading={loading}
                disabled={(!text?.length || text?.length > 200)}
              >
                {t('datasetHitTesting.input.testing')}
              </Button>
            </div>
          </div>
        </div>

      </div>
    </>
  )
}

export default TextAreaWithButton
