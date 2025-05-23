import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { memo } from 'react'
import type { DataSourceNodeType } from './types'
import { CollectionType } from '@/app/components/tools/types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { BoxGroupField } from '@/app/components/workflow/nodes/_base/components/layout'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import TagInput from '@/app/components/base/tag-input'
import { useConfig } from './hooks/use-config'

const Panel: FC<NodePanelProps<DataSourceNodeType>> = ({ id, data }) => {
  const { t } = useTranslation()
  const {
    provider_id,
    provider_type,
    fileExtensions = [],
  } = data
  const { handleFileExtensionsChange } = useConfig(id)
  const isLocalFile = provider_id === 'langgenius/file/file' && provider_type === CollectionType.datasource

  return (
    <div >
      {
        isLocalFile && (
          <BoxGroupField
            boxGroupProps={{
              boxProps: { withBorderBottom: true },
            }}
            fieldProps={{
              fieldTitleProps: {
                title: t('workflow.nodes.dataSource.supportedFileFormats'),
              },
            }}
          >
            <div className='rounded-lg bg-components-input-bg-normal p-1 pt-0'>
              <TagInput
                items={fileExtensions}
                onChange={handleFileExtensionsChange}
                placeholder={t('workflow.nodes.dataSource.supportedFileFormatsPlaceholder')}
                inputClassName='bg-transparent'
              />
            </div>
          </BoxGroupField>
        )
      }
      <OutputVars>
        <VarItem
          name='datasource_type'
          type='string'
          description={'local_file, online_document, website_crawl'}
        />
        {
          isLocalFile && (
            <VarItem
              name='file'
              type='Object'
              description={'file'}
              subItems={[
                {
                  name: 'type',
                  type: 'string',
                  description: '',
                },
                {
                  name: 'upload_file_id',
                  type: 'string',
                  description: '',
                },
                {
                  name: 'name',
                  type: 'string',
                  description: '',
                },
                {
                  name: 'size',
                  type: 'number',
                  description: '',
                },
                {
                  name: 'extension',
                  type: 'string',
                  description: '',
                },
                {
                  name: 'mime_type',
                  type: 'string',
                  description: '',
                },
                {
                  name: 'upload_file_url',
                  type: 'string',
                  description: '',
                },
              ]}
            />
          )
        }
      </OutputVars>
    </div>
  )
}

export default memo(Panel)
