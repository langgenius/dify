import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useDebounceFn } from 'ahooks'
import { useEducation } from './hooks'
import Input from '@/app/components/base/input'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

type SearchInputProps = {
  value?: string
  onChange: (value: string) => void
}
const SearchInput = ({
  value,
  onChange,
}: SearchInputProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const {
    schools,
    isLoading,
    querySchoolsWithDebounced,
  } = useEducation()

  const {
    run: handleSearch,
  } = useDebounceFn(() => {
    querySchoolsWithDebounced({
      keywords: value,
      page: 1,
    })
  }, {
    wait: 300,
  })
  const handleValueChange = useCallback((e: { target: { value: string } }) => {
    onChange(e.target.value)
    handleSearch()
  }, [handleSearch, onChange])

  useEffect(() => {
    if (!isLoading && !open && schools.length)
      setOpen(true)
  }, [isLoading, open, schools])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom'
      offset={4}
    >
      <PortalToFollowElemTrigger className='block w-full'>
        <Input
          className='w-full'
          placeholder={t('education.form.schoolName.placeholder')}
          value={value}
          onChange={handleValueChange}
        />
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className='p-1 border-[0.5px] border-components-panel-border bg-components-panel-bg-blur rounded-xl'>
          {
            schools.map((school, index) => (
              <div
                key={index}
                className='flex items-center px-2 py-1.5 h-8 system-md-regular text-text-secondary truncate'
                title={school}
              >
                {school}
              </div>
            ))
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default SearchInput
