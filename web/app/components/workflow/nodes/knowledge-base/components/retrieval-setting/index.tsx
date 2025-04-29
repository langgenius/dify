import { Field } from '@/app/components/workflow/nodes/_base/components/layout'
import VectorSearchCard from './vector-search'
import FullTextSearchCard from './full-text-search'
import HybridSearchCard from './hybrid-search'

const RetrievalSetting = () => {
  return (
    <Field
      fieldTitleProps={{
        title: 'Retrieval Setting',
        subTitle: (
          <div className='body-xs-regular flex items-center text-text-tertiary'>
            <a
              href=''
              className='text-text-accent'
              target='_blank'
            >
              Learn more
            </a>
            &nbsp;
            about retrieval method.
          </div>
        ),
      }}
    >
      <div className='space-y-1'>
        <VectorSearchCard />
        <FullTextSearchCard />
        <HybridSearchCard />
      </div>
    </Field>
  )
}

export default RetrievalSetting
