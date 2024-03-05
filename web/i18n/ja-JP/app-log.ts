const translation = {
  title: 'ログ',
  description: 'ログは、アプリケーションの実行状態を記録します。ユーザーの入力やAIの応答などが含まれます。',
  dateTimeFormat: 'MM/DD/YYYY hh:mm A',
  table: {
    header: {
      time: '時間',
      endUser: 'エンドユーザー',
      input: '入力',
      output: '出力',
      summary: 'タイトル',
      messageCount: 'メッセージ数',
      userRate: 'ユーザー評価',
      adminRate: 'オペレータ評価',
    },
    pagination: {
      previous: '前へ',
      next: '次へ',
    },
    empty: {
      noChat: 'まだ会話がありません',
      noOutput: '出力なし',
      element: {
        title: '誰かいますか？',
        content: 'ここではエンドユーザーとAIアプリケーションの相互作用を観察し、注釈を付けることでAIの精度を継続的に向上させることができます。自分自身でWebアプリを<shareLink>共有</shareLink>したり<testLink>テスト</testLink>したりして、このページに戻ってください。',
      },
    },
  },
  detail: {
    time: '時間',
    conversationId: '会話ID',
    promptTemplate: 'プロンプトテンプレート',
    promptTemplateBeforeChat: 'チャット前のプロンプトテンプレート · システムメッセージとして',
    annotationTip: '{{user}}による改善',
    timeConsuming: '',
    second: '秒',
    tokenCost: 'トークン消費',
    loading: '読み込み中',
    operation: {
      like: 'いいね',
      dislike: 'いまいち',
      addAnnotation: '改善を追加',
      editAnnotation: '改善を編集',
      annotationPlaceholder: 'AIが返答することを期待する回答を入力してください。これはモデルの微調整やテキスト生成品質の継続的な改善に使用されます。',
    },
    variables: '変数',
    uploadImages: 'アップロードされた画像',
  },
  filter: {
    period: {
      today: '今日',
      last7days: '過去7日間',
      last4weeks: '過去4週間',
      last3months: '過去3ヶ月',
      last12months: '過去12ヶ月',
      monthToDate: '今月まで',
      quarterToDate: '四半期まで',
      yearToDate: '今年まで',
      allTime: 'すべての期間',
    },
    annotation: {
      all: 'すべて',
      annotated: '注釈付きの改善（{{count}}件）',
      not_annotated: '注釈なし',
    },
  },
}

export default translation
