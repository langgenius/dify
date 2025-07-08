# MFA実装 引き継ぎ書

## 概要
DifyにTOTPベースの多要素認証（MFA）機能を実装しました。ユーザーは認証アプリ（Google Authenticator等）を使用して、パスワードに加えて6桁のワンタイムパスワードでログインできます。

## 実装済み機能

### 1. MFA設定機能
- **場所**: アカウントページ（右上アイコン → アカウント → MFA設定ボタン）
- **機能**:
  - QRコード生成・表示
  - 秘密鍵の表示
  - バックアップコードの生成（10個）
  - TOTPトークンによる設定完了確認

### 2. MFAログイン機能
- パスワード認証後、MFAが有効な場合は追加認証画面を表示
- TOTPトークンまたはバックアップコードで認証可能
- バックアップコードは使い捨て

### 3. MFA無効化機能
- アカウントパスワードの再確認が必要
- 無効化後は通常のパスワードログインに戻る

## 技術仕様

### Backend (API)

#### 主要ファイル
- `/api/controllers/console/auth/mfa.py` - MFA APIエンドポイント
- `/api/services/mfa_service.py` - MFAビジネスロジック
- `/api/models/account.py` - MFA関連フィールド追加
- `/api/libs/totp.py` - TOTP実装

#### APIエンドポイント
```
GET  /console/api/account/mfa/status - MFAステータス取得
POST /console/api/account/mfa/setup - MFA設定開始（QRコード生成）
POST /console/api/account/mfa/setup/complete - MFA設定完了
POST /console/api/account/mfa/disable - MFA無効化
POST /console/api/mfa/verify - ログイン時のMFA検証
```

#### データベース変更
Accountテーブルに追加されたフィールド:
- `mfa_enabled` (Boolean)
- `mfa_secret` (String, 暗号化)
- `mfa_backup_codes` (Text, JSON形式)

### Frontend (Web)

#### 主要ファイル
- `/web/app/components/header/account-setting/mfa-page.tsx` - MFA設定ページ
- `/web/app/components/signin/mfa-verify.tsx` - MFAログイン画面
- `/web/service/use-mfa.ts` - MFA APIサービス
- `/web/app/account/account-page/index.tsx` - アカウントページへのMFA統合

#### 状態管理
- React Query使用（`@tanstack/react-query`）
- MFAステータスは`useQuery`でキャッシュ管理
- 設定変更後は`invalidateQueries`で更新

## 既知の問題と解決済みバグ

### 1. APIルーティング問題（解決済み）
- **問題**: MFAエンドポイントが404エラー
- **原因**: `/console/api/mfa/*`ではなく`/console/api/account/mfa/*`に配置すべきだった
- **解決**: `controllers/console/workspace/account.py`でルート登録

### 2. パスワード検証エラー（解決済み）
- **問題**: MFA無効化時に500エラー
- **原因**: 存在しない`AccountService.check_account_password`メソッドを呼び出し
- **解決**: `libs.password.compare_password`を使用

### 3. i18n翻訳エラー（解決済み）
- **問題**: 日本語で「operation.cancel」と表示される
- **原因**: 翻訳キーのネームスペース不足
- **解決**: `t('common.operation.cancel')`に修正

### 4. モーダル表示問題（解決済み）
- **問題**: 設定ドロップダウンが開かない、クリックできない
- **原因**: Dialog（z-index: 40）とModal（z-index: 70）の混在
- **解決**: MenuDialogコンポーネントの構造を修正

## テスト状況

### Backendテスト
- **ファイル**: `/api/tests/unit_tests/controllers/console/auth/test_mfa.py`
- **状態**: 14個のテストケース実装済み、実行環境に課題あり
- **注意**: Dockerコンテナ内でのモック設定が複雑

### Frontendテスト
- **ファイル**: `/web/app/components/header/account-setting/mfa-page.test.tsx`
- **状態**: テストファイル作成済み、実行環境未整備
- **必要な作業**:
  1. `npm install --legacy-peer-deps`でJest依存関係をインストール
  2. `npm test -- mfa-page.test.tsx`でテスト実行

## ローカル開発環境でのテスト実行

### Frontend単体テストの実行手順

1. **依存関係のインストール**
   ```bash
   cd web
   npm install --legacy-peer-deps
   ```

2. **テスト実行**
   ```bash
   # 特定のテストファイルを実行
   npm test -- mfa-page.test.tsx
   
   # watchモードで実行
   npm test -- --watch mfa-page.test.tsx
   ```

3. **カバレッジ確認**
   ```bash
   npm test -- --coverage mfa-page.test.tsx
   ```

### 手動テストシナリオ

1. **MFA有効化フロー**
   - アカウントページでMFAボタンをクリック
   - QRコードをGoogle Authenticatorでスキャン
   - 6桁のコードを入力
   - バックアップコードを保存

2. **MFAログインフロー**
   - ログアウト後、通常ログイン
   - MFA画面で6桁コードを入力
   - またはバックアップコードを使用

3. **MFA無効化フロー**
   - アカウントページでMFA無効化をクリック
   - アカウントパスワードを入力
   - MFAが無効化されることを確認

## 今後の改善提案

1. **バックアップコード再生成機能**
   - 現在はMFA設定時のみ生成
   - 紛失時の再生成機能が必要

2. **セッション管理の強化**
   - MFA認証後の専用セッショントークン
   - デバイス記憶機能

3. **管理者機能**
   - ユーザーのMFA強制リセット
   - 組織全体でのMFA必須設定

4. **監査ログ**
   - MFA関連イベントの記録
   - 不正アクセス試行の検知

## 重要な注意事項

1. **ビルド時間**: Webコンテナのビルドは30分以上かかる場合があります
2. **Docker再起動**: 大きな変更後は全コンテナの再起動が必要な場合があります
   ```bash
   docker-compose down && docker-compose up -d
   ```
3. **502エラー対策**: nginx-proxyの再起動が必要な場合があります
   ```bash
   cd ../nginx-proxy && docker-compose up -d
   ```

## 連絡先
実装に関する質問がある場合は、このドキュメントと併せて以下を参照してください：
- `/CLAUDE.md` - プロジェクト固有のルール
- `/api/tests/mfa_test_instructions.md` - テスト手順詳細