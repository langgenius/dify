import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { InputVarType } from '@/app/components/workflow/types'

export const MOCK_DATA = {
  site: {
    app_id: 'e9823576-d836-4f2b-b46f-bd4df1d82230',
    end_user_id: 'b7aa295d-1560-4d87-a828-77b3f39b30d0',
    enable_site: true,
    site: {
      title: 'wf',
      chat_color_theme: null,
      chat_color_theme_inverted: false,
      icon_type: 'emoji',
      icon: '\uD83E\uDD16',
      icon_background: '#FFEAD5',
      icon_url: null,
      description: null,
      copyright: null,
      privacy_policy: null,
      custom_disclaimer: '',
      default_language: 'en-US',
      prompt_public: false,
      show_workflow_steps: true,
      use_icon_as_answer_icon: false,
    },
    model_config: null,
    plan: 'basic',
    can_replace_logo: false,
    custom_config: null,
  },
  // 采用与上方 form editor 相同的数据结构，唯一不同的就是
  // 对于 Text 类型，其文本已完成了变量替换（即，所有使用
  // {{#node_name.var_name#}} 格式引用其他变量的位置，都
  // 被替换成了对应的变量的值）
  //
  // 参考 FormContent
  form_content: `
    # Experiencing the Four Seasons
    ![Four seasons landscape]({{#nodename.image#}})

    ## My Seasonal Guide
    Name: {{#noddename.name#}}
    Location: {{#nodename.location#}}
    Favorite Season: {{#nodename.season#}}

    The four seasons throughout the year:
    - Spring: Cherry blossoms, returning birds
    - Summer: Long sunny days, thunderstorms, beach adventures
    - Autumn: Red and gold foliage, harvest festivals, apple picking
    - Winter: Snowfall, frozen lakes, holiday celebrations
    ## Notes

    {{#$output.content#}}
  `,
  // 对每一个字段的描述，参考上方 FormInput 的定义。
  inputs: [
    {
      output_variable_name: 'content',
      type: InputVarType.paragraph,
      label: 'Name',
      options: [],
      max_length: 4096,
      placeholder: 'Enter your name',
    },
    {
      output_variable_name: 'location',
      type: InputVarType.textInput,
      label: 'Location',
      // placeholder: 'Enter your location',
      options: [],
      max_length: 4096,
    },
    {
      output_variable_name: 'season',
      type: InputVarType.textInput,
      label: 'Favorite Season',
      // placeholder: 'Enter your favorite season',
      options: [],
      max_length: 4096,
    },
  ],
  // 用户对这个表单可采取的操作，参考上方 UserAction 的定义。
  user_actions: [
    {
      id: 'approve-action',
      title: 'Post to X',
      button_style: UserActionButtonType.Primary,
    },
    {
      id: 'regenerate-action',
      title: 'regenerate',
      button_style: UserActionButtonType.Default,
    },
    {
      id: 'thinking-action',
      title: 'thinking',
      button_style: UserActionButtonType.Accent,
    },
    {
      id: 'cancel-action',
      title: 'cancel',
      button_style: UserActionButtonType.Ghost,
    },
  ],
  timeout: 3,
  timeout_unit: 'day',
}
