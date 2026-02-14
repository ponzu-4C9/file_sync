# File Sync

複数のWindows PC間でディレクトリをリアルタイム同期するCUIアプリケーション。

## アーキテクチャ

```
PC1 ──WebSocket──→ Ubuntu Server (Docker) ←──WebSocket── PC2
C:\dev\my-project       ルーム: my-project       D:\work\my-project
```

- **ルーム**: フォルダ名がルーム名になる。同じルーム名のPC同士でファイルが同期される
- **サーバー**: Dockerコンテナとして動作。ルームごとにファイルの最新版を保持
- **クライアント**: ファイル変更を監視し、WebSocketで送受信

---

## サーバーセットアップ（Ubuntu）

### 前提条件

- Docker & Docker Compose がインストール済み

### 手順

```bash
git clone https://github.com/ponzu-4C9/file_sync.git
cd file_sync
```

`docker-compose.yml` のユーザー名・パスワードを変更:

```yaml
environment:
  - SYNC_USERNAME=your_username
  - SYNC_PASSWORD=your_password
```

起動:

```bash
docker compose up -d --build
```

ファイアウォールでポートを開放:

```bash
sudo ufw allow 49522/tcp
```

---

## クライアントセットアップ（Windows PC）

### 前提条件

- [Node.js 20+](https://nodejs.org/) がインストール済み
- Git がインストール済み

### 手順

```powershell
git clone https://github.com/ponzu-4C9/file_sync.git
cd file_sync
npm install
npm run build:shared
npm run build:client
```

### 起動

```powershell
node client\dist\index.js -s ws://<サーバーIP>:49522 -d "<同期ディレクトリ>" -u <ユーザー名> -p <パスワード>
```

例:

```powershell
node client\dist\index.js -s ws://192.168.3.50:49522 -d "C:\dev\my-project" -u admin -p changeme
```

### 起動を簡単にする（バッチファイル）

`start-sync.bat` をデスクトップ等に作成:

```bat
@echo off
cd /d "C:\path\to\file_sync"
node client\dist\index.js -s ws://192.168.3.50:49522 -d "C:\dev\my-project" -u admin -p changeme
pause
```

---

## 初回同期モード

クライアント起動時に選択:

| モード | 動作 |
|--------|------|
| 1. ダウンロード | サーバー → このPC |
| 2. アップロード | このPC → サーバー（サーバー上書き） |
| 3. スキップ | 以降の変更のみ同期 |

---

## .sync-ignore

同期ディレクトリ内に `.sync-ignore` ファイルを置くと、指定パターンのファイルを除外できます（`.gitignore` と同じ書式）。

テンプレート: `.sync-ignore.example` を参考にしてください。

---

## コマンド一覧

| コマンド | 説明 |
|---------|------|
| `npm run build` | 全パッケージビルド |
| `npm run build:shared` | shared のみビルド |
| `npm run build:client` | client のみビルド |
| `npm run build:server` | server のみビルド |
| `docker compose up -d --build` | サーバー起動 |
| `docker compose down` | サーバー停止 |
| `docker compose logs` | サーバーログ確認 |
