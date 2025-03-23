import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Context } from 'hono';
import { serve } from '@hono/node-server';
// kuromojiを動的にインポート
// import * as kuromoji from 'kuromoji';
import type { Tokenizer, IpadicFeatures } from 'kuromoji';

const app = new Hono();

// ミドルウェアを設定
app.use('*', logger());
app.use('*', cors());

// kuromojiを初期化する関数
const initKuromoji = async (): Promise<Tokenizer<IpadicFeatures>> => {
  return new Promise((resolve, reject) => {
    // 動的にインポート
    import('kuromoji').then((kuromoji) => {
      kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((err, tokenizer) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(tokenizer);
      });
    }).catch(reject);
  });
};

// カタカナをひらがなに変換する関数
const katakanaToHiragana = (str: string): string => {
  return str.replace(/[\u30A1-\u30F6]/g, (match) => {
    const chr = match.charCodeAt(0) - 0x60;
    return String.fromCharCode(chr);
  });
};

// トークナイザーをグローバルに保持
let tokenizerInstance: Tokenizer<IpadicFeatures> | null = null;

// APIのルートを設定
app.post('/hiragana', async (c: Context) => {
  try {
    // リクエストボディを取得
    const { text } = await c.req.json<{ text: string }>();

    if (!text) {
      return c.json({ error: 'テキストが指定されていません' }, 400);
    }

    // トークナイザーが初期化されていなければ初期化
    if (!tokenizerInstance) {
      tokenizerInstance = await initKuromoji();
    }

    // テキストを形態素解析
    const tokens = tokenizerInstance.tokenize(text);

    // 読みを抽出してひらがなに変換
    let hiragana = '';
    
    for (const token of tokens) {
      // 読みがある場合は読みを使用、ない場合は表層形をそのまま使用
      if (token.reading) {
        hiragana += katakanaToHiragana(token.reading);
      } else {
        // 記号や数字などの場合は表層形をそのまま使用
        hiragana += token.surface_form;
      }
    }

    return c.json({ hiragana });
  } catch (error) {
    console.error('エラーが発生しました:', error);
    return c.json({ error: '内部サーバーエラー' }, 500);
  }
});

// ヘルスチェック用エンドポイント
app.get('/', (c: Context) => {
  return c.json({ status: 'ok' });
});

// サーバー起動
const port = process.env.PORT || 3000;
console.log(`Server is running on port ${port}`);

// 本番環境では直接サーバーを起動
if (process.env.NODE_ENV !== 'test') {
  serve({
    fetch: app.fetch,
    port: Number(port)
  });
}

export default app; 
