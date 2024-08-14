const translation = {
  common: {
    welcome: '',
    appUnavailable: 'アプリが利用できません',
    appUnkonwError: 'アプリが利用できません',
  },
  chat: {
    newChat: '新しいチャット',
    pinnedTitle: 'ピン留めされた',
    unpinnedTitle: 'チャット',
    newChatDefaultName: '新しい会話',
    resetChat: '会話をリセット',
    powerBy: 'Powered by',
    prompt: 'プロンプト',
    privatePromptConfigTitle: '会話の設定',
    publicPromptConfigTitle: '初期プロンプト',
    configStatusDes: '開始前に、会話の設定を変更できます',
    configDisabled:
      '前回のセッションの設定がこのセッションで使用されました。',
    startChat: 'チャットを開始',
    privacyPolicyLeft:
      'アプリ開発者が提供する',
    privacyPolicyMiddle:
      'プライバシーポリシー',
    privacyPolicyRight:
      'をお読みください。',
    deleteConversation: {
      title: '会話を削除する',
      content: 'この会話を削除してもよろしいですか？',
    },
    tryToSolve: '解決しようとしています',
    temporarySystemIssue: '申し訳ありません、一時的なシステムの問題が発生しました。',
  },
  generation: {
    tabs: {
      create: '一度だけ実行',
      batch: '一括実行',
      saved: '保存済み',
    },
    savedNoData: {
      title: 'まだ結果が保存されていません！',
      description: 'コンテンツの生成を開始し、保存された結果をこちらで見つけてください。',
      startCreateContent: 'コンテンツの作成を開始',
    },
    title: 'AI Completion',
    queryTitle: 'コンテンツのクエリ',
    completionResult: 'Completion 結果',
    queryPlaceholder: 'クエリコンテンツを書いてください...',
    run: '実行',
    copy: 'コピー',
    resultTitle: 'AI Completion',
    noData: 'AIはここで必要なものを提供します。',
    csvUploadTitle: 'CSVファイルをここにドラッグアンドドロップするか、',
    browse: '参照',
    csvStructureTitle: 'CSVファイルは以下の構造に準拠する必要があります：',
    downloadTemplate: 'こちらからテンプレートをダウンロード',
    field: 'フィールド',
    batchFailed: {
      info: '{{num}} 回の実行が失敗しました',
      retry: '再試行',
      outputPlaceholder: '出力コンテンツなし',
    },
    errorMsg: {
      empty: 'アップロードされたファイルにコンテンツを入力してください。',
      fileStructNotMatch: 'アップロードされたCSVファイルが構造と一致しません。',
      emptyLine: '行 {{rowIndex}} が空です',
      invalidLine: '行 {{rowIndex}}: {{varName}} の値は空にできません',
      moreThanMaxLengthLine: '行 {{rowIndex}}: {{varName}} の値は {{maxLength}} 文字を超えることはできません',
      atLeastOne: 'アップロードされたファイルには少なくとも1行の入力が必要です。',
    },
  },
}

export default translation
