const translation = {
  common: {
    publishAsPipeline: {
      name: 'パイプライン名とアイコン',
      description: '知識の説明',
      namePlaceholder: 'この知識パイプラインの名前を入力してください。(必須)',
      descriptionPlaceholder: 'このナレッジパイプラインの説明を入力してください。（任意）',
    },
    testRun: 'テストラン',
    reRun: '再実行',
    processing: '処理中',
    confirmPublish: '公開を確認する',
    preparingDataSource: 'データソースを準備中',
    goToAddDocuments: 'ドキュメントを追加するために行く',
    publishAs: '知識パイプラインとして公開する',
    confirmPublishContent: '知識パイプラインを正常に公開した後、この知識ベースのチャンク構造は変更できません。本当に公開してもよろしいですか？',
  },
  inputField: {
    manage: '管理する',
    create: 'ユーザー入力フィールドを作成する',
  },
  publishToast: {
    title: 'このパイプラインはまだ公開されていません',
    desc: 'パイプラインが公開されていない場合、ナレッジベースノードのチャンク構造を変更することができ、パイプラインオーケストレーションと変更は自動的にドラフトとして保存されます。',
  },
  result: {
    resultPreview: {
      loading: '処理中です...お待ちください',
      error: '実行中にエラーが発生しました',
      viewDetails: '詳細を見る',
      footerTip: 'テスト実行モードでは、最大{{count}}チャンクまでプレビュー',
    },
  },
  ragToolSuggestions: {
    title: 'RAGのための提案',
    noRecommendationPlugins: '推奨プラグインがありません。<CustomLink>マーケットプレイス</CustomLink>で詳細をご確認ください',
  },
}

export default translation
