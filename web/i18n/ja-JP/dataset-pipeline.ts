const translation = {
  creation: {
    createFromScratch: {
      title: '空白のナレッジパイプライン',
      description: 'データ処理と構造を完全に制御できるカスタムパイプラインをゼロから作成します。',
    },
    backToKnowledge: 'ナレッジベースに戻る',
    caution: '注意',
    importDSL: 'DSLファイルからインポートする',
    errorTip: 'ナレッジベースの作成に失敗しました',
    createKnowledge: 'ナレッジベースを作成する',
    successTip: 'ナレッジベースが正常に作成されました',
  },
  templates: {
    customized: 'カスタマイズされた',
  },
  operations: {
    details: '詳細',
    convert: '変換する',
    choose: '選ぶ',
    preview: 'プレビュー',
    dataSource: 'データソース',
    editInfo: '情報を編集する',
    exportPipeline: 'パイプラインをエクスポートする',
    saveAndProcess: '保存して処理する',
    backToDataSource: 'データソースに戻る',
    useTemplate: 'このナレッジパイプラインを使用してください',
    process: 'プロセス',
  },
  deletePipeline: {
    content: 'パイプラインテンプレートの削除は元に戻せません。',
    title: 'このパイプラインテンプレートを削除してもよろしいですか？',
  },
  publishPipeline: {
    success: {
      message: 'ナレッジパイプラインが公開されました',
      tip: '<CustomLink>ドキュメントに移動</CustomLink>して、ドキュメントを追加または管理してください。',
    },
    error: {
      message: 'ナレッジパイプラインの公開に失敗しました',
    },
  },
  publishTemplate: {
    success: {
      learnMore: 'もっと学ぶ',
      tip: 'このテンプレートは作成ページで使用できます。',
      message: 'パイプラインテンプレートが公開されました',
    },
    error: {
      message: 'パイプラインテンプレートの公開に失敗しました',
    },
  },
  exportDSL: {
    successTip: 'エクスポートパイプラインDSLが成功しました',
    errorTip: 'パイプラインDSLのエクスポートに失敗しました',
  },
  details: {
    createdBy: '{{author}}により作成',
    structure: '構造',
    structureTooltip: 'チャンク構造は、ドキュメントがどのように分割され、インデックスされるかを決定します。一般、親子、Q&Aモードを提供し、各ナレッジベースにユニークです。',
  },
  testRun: {
    steps: {
      documentProcessing: 'ドキュメント処理',
      dataSource: 'データソース',
    },
    dataSource: {
      localFiles: 'ローカルファイル',
    },
    notion: {
      title: 'Notionページを選択する',
      docTitle: 'Notionドキュメント',
    },
    tooltip: 'テスト実行モードでは、デバッグと観察を容易にするため、同時に1つのドキュメントのみをインポートすることが許可されています。',
    title: 'テストラン',
  },
  inputFieldPanel: {
    uniqueInputs: {
      title: '各入口のユニークな入力',
      tooltip: 'ユニークな入力は選択したデータソースとその下流ノードのみがアクセス可能です。他のデータソースを選択する際、ユーザーはこれを記入する必要がありません。データソース変数で参照される入力フィールドのみが最初のステップ（データソース）に表示され、他のフィールドは第二のステップ（ドキュメント処理）で表示されます。',
    },
    globalInputs: {
      title: 'すべての入口に対するグローバル入力',
      tooltip: 'グローバル入力はすべてのノードで共有されます。ユーザーは任意のデータソースを選択する際にこれらを入力する必要があります。区切り文字や最大チャンク長などのフィールドは複数のデータソースに一様に適用できます。データソース変数で参照される入力フィールドのみが最初のステップ（データソース）に表示され、他のフィールドは第二のステップ（ドキュメント処理）に表示されます。',
    },
    preview: {
      stepOneTitle: 'データソース',
      stepTwoTitle: 'ドキュメントを処理する',
    },
    error: {
      variableDuplicate: '変数名はすでに存在します。異なる名前を選択してください。',
    },
    title: 'ユーザー入力フィールド',
    addInputField: '入力フィールドを追加する',
    editInputField: '入力フィールドを編集する',
    description: 'ユーザー入力フィールドは、パイプライン実行プロセス中に必要な変数を定義および収集するために使用されます。ユーザーは、フィールドタイプをカスタマイズし、異なるデータソースやドキュメント処理ステップのニーズに応じて入力値を柔軟に構成できます。',
  },
  addDocuments: {
    title: 'ドキュメントを追加する',
    steps: {
      chooseDatasource: 'データソースを選択する',
      processDocuments: 'ドキュメントを処理する',
      processingDocuments: '文書の処理',
    },
    backToDataSource: 'データソース',
    stepOne: {
      preview: 'プレビュー',
    },
    stepTwo: {
      chunkSettings: 'チャンク設定',
      previewChunks: 'プレビュー チャンク',
    },
    stepThree: {
      learnMore: 'もっと学ぶ',
    },
    characters: 'キャラクター',
    selectOnlineDocumentTip: '最大{{count}}ページまで処理',
    selectOnlineDriveTip: '最大{{count}}ファイルまで処理、各ファイル最大{{fileSize}}MB',
  },
  documentSettings: {
    title: 'ドキュメント設定',
  },
  onlineDocument: {
    pageSelectorTitle: '{{name}}ページ',
  },
  onlineDrive: {
    notConnected: '{{name}}が接続されていません',
    notConnectedTip: '{{name}}と同期するには、まず{{name}}への接続を確立する必要があります。',
    breadcrumbs: {
      allBuckets: 'すべてのクラウドストレージバケット',
      allFiles: 'すべてのファイル',
      searchResult: '"{{folderName}}"フォルダ内で{{searchResultsLength}}件のアイテムを見つけました',
      searchPlaceholder: 'ファイルを検索...',
    },
    notSupportedFileType: 'このファイルタイプはサポートされていません',
    emptyFolder: 'このフォルダーは空です',
    emptySearchResult: 'アイテムは見つかりませんでした',
    resetKeywords: 'キーワードをリセットする',
  },
  credentialSelector: {
    name: '{{credentialName}}の{{pluginName}}',
  },
  configurationTip: '{{pluginName}}を設定',
  conversion: {
    confirm: {
      title: '確認',
      content: 'この操作は永久的です。以前の方法に戻すことはできません。変換することを確認してください。',
    },
    warning: 'この操作は元に戻せません。',
    title: 'ナレッジパイプラインに変換する',
    successMessage: 'データセットをパイプラインに正常に変換しました',
    errorMessage: 'データセットをパイプラインに変換できませんでした',
    descriptionChunk1: '既存のナレッジベースを文書処理のためにナレッジパイプラインを使用するように変換できます。',
    descriptionChunk2: '— よりオープンで柔軟なアプローチを採用し、私たちのマーケットプレイスからのプラグインへのアクセスを提供します。これにより、すべての将来のドキュメントに新しい処理方法が適用されることになります。',
  },
  knowledgeNameAndIcon: 'ナレッジベースの名前とアイコン',
  inputField: '入力フィールド',
  pipelineNameAndIcon: 'パイプライン名とアイコン',
  knowledgePermissions: '権限',
  knowledgeNameAndIconPlaceholder: 'ナレッジベースの名前を入力してください',
  editPipelineInfo: 'パイプライン情報を編集する',
  knowledgeDescription: 'ナレッジベースの説明',
  knowledgeDescriptionPlaceholder: 'このナレッジベースに何が含まれているかを説明してください。詳細な説明は、AIがデータセットの内容により正確にアクセスできるようにします。空の場合、Difyはデフォルトのヒット戦略を使用します。（オプション）',
}

export default translation
