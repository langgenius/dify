import type { FC } from 'react'
import {
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { memo } from 'react'
import type { DataSourceNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { GroupWithBox } from '@/app/components/workflow/nodes/_base/components/layout'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import StructureOutputItem from '@/app/components/workflow/nodes/_base/components/variable/object-child-tree-panel/show'
import { Type } from '../llm/types'

const Panel: FC<NodePanelProps<DataSourceNodeType>> = ({ data }) => {
  const { t } = useTranslation()
  const { output_schema = {} } = data
  const outputSchema = useMemo(() => {
      const res: any[] = []
      if (!output_schema)
        return []
      Object.keys(output_schema.properties).forEach((outputKey) => {
        const output = output_schema.properties[outputKey]
        const type = output.type
        if (type === 'object') {
          res.push({
            name: outputKey,
            value: output,
          })
        }
        else {
          res.push({
            name: outputKey,
            type: output.type === 'array'
              ? `Array[${output.items?.type.slice(0, 1).toLocaleUpperCase()}${output.items?.type.slice(1)}]`
              : `${output.type.slice(0, 1).toLocaleUpperCase()}${output.type.slice(1)}`,
            description: output.description,
          })
        }
      })
      return res
    }, [output_schema])
  const hasObjectOutput = useMemo(() => {
    if (!output_schema)
      return false
    const properties = output_schema.properties
    return Object.keys(properties).some(key => properties[key].type === 'object')
  }, [output_schema])

  return (
    <div >
      <GroupWithBox boxProps={{ withBorderBottom: true }}>

      </GroupWithBox>
      <OutputVars>
        <VarItem
            name='text'
            type='string'
            description={t('workflow.nodes.tool.outputVars.text')}
            isIndent={hasObjectOutput}
          />
          <VarItem
            name='files'
            type='array[file]'
            description={t('workflow.nodes.tool.outputVars.files.title')}
            isIndent={hasObjectOutput}
          />
          <VarItem
            name='json'
            type='array[object]'
            description={t('workflow.nodes.tool.outputVars.json')}
            isIndent={hasObjectOutput}
          />
          {outputSchema.map((outputItem: any) => (
            <div key={outputItem.name}>
              {outputItem.value?.type === 'object' ? (
                <StructureOutputItem
                  rootClassName='code-sm-semibold text-text-secondary'
                  payload={{
                    schema: {
                      type: Type.object,
                      properties: {
                        [outputItem.name]: outputItem.value,
                      },
                      additionalProperties: false,
                    },
                  }} />
              ) : (
                <VarItem
                  name={outputItem.name}
                  type={outputItem.type.toLocaleLowerCase()}
                  description={outputItem.description}
                  isIndent={hasObjectOutput}
                />
              )}
            </div>
          ))}
      </OutputVars>
    </div>
  )
}

export default memo(Panel)
