export type FormValue = Record<string, string>
export type I18NText = {
  'en': string
  'zh-Hans': string
}
export type Option = {
  key: string
  label: I18NText
}
export type Field = {
  visible: (v?: FormValue) => boolean
  type: string
  key: string
  required?: boolean
  obfuscated?: boolean
  switch?: boolean
  label: I18NText
  options?: Option[]
  placeholder?: I18NText
  help?: I18NText
}

export type Config = {
  hit?: I18NText
  title: I18NText
  link: {
    href: string
    label: I18NText
  }
  defaultValue?: FormValue
  fields: Field[]
}
