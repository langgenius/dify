import {
  useCallback,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
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
    setSchools,
    querySchoolsWithDebounced,
    handleUpdateSchools,
    hasNext,
  } = useEducation()
  const pageRef = useRef(0)
  const valueRef = useRef(value)

  const handleSearch = useCallback((debounced?: boolean) => {
    const keywords = valueRef.current
    const page = pageRef.current
    if (debounced) {
      querySchoolsWithDebounced({
        keywords,
        page,
      })
      return
    }

    handleUpdateSchools({
      keywords,
      page,
    })
  }, [querySchoolsWithDebounced, handleUpdateSchools])

  const handleValueChange = useCallback((e: any) => {
    setOpen(true)
    setSchools([])
    pageRef.current = 0
    const inputValue = e.target.value
    valueRef.current = inputValue
    onChange(inputValue)
    handleSearch(true)
  }, [onChange, handleSearch, setSchools])

  const handleScroll = useCallback((e: Event) => {
    const target = e.target as HTMLDivElement
    const {
      scrollTop,
      scrollHeight,
      clientHeight,
    } = target
    if (scrollTop + clientHeight >= scrollHeight - 5 && scrollTop > 0 && hasNext) {
      pageRef.current += 1
      handleSearch()
    }
  }, [handleSearch, hasNext])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom'
      offset={4}
      triggerPopupSameWidth
    >
      <PortalToFollowElemTrigger className='block w-full'>
        <Input
          className='w-full'
          placeholder={t('education.form.schoolName.placeholder')}
          value={value}
          onChange={handleValueChange}
        />
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-10'>
        {
          !!schools.length && value && (
            <div
              className='p-1 max-h-[330px] overflow-y-auto border-[0.5px] border-components-panel-border bg-components-panel-bg-blur rounded-xl'
              onScroll={handleScroll as any}
            >
              {
                schools.map((school, index) => (
                  <div
                    key={index}
                    className='flex items-center px-2 py-1.5 h-8 system-md-regular text-text-secondary truncate cursor-pointer hover:bg-state-base-hover rounded-lg'
                    title={school}
                    onClick={() => {
                      onChange(school)
                      setOpen(false)
                    }}
                  >
                    {school}
                  </div>
                ))
              }
            </div>
          )
        }
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default SearchInput
