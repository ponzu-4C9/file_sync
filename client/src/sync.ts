import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  ServerMessage,
  FileUpdateMessage,
  FileRemoveMessage,
  SyncSnapshot,
  FileEntry,
  ClientMessage,
  TEMP_FILE_SUFFIX,
} from 'file-sync-shared';
import { loadSyncIgnore, isIgnored } from 'file-sync-shared';
import { FileWatcher } from './watcher';
import chalk from 'chalk';

type SendFunction = (message: ClientMessage) => void;

/**
 * 同期マネージャー
 * サーバーからのメッセージを受信し、ローカルファイルに反映する
 * ローカルファイルをサーバーにアップロードする
 */
export class SyncManager {
  private syncDir: string;
  private watcher: FileWatcher;
  private send: SendFunction;

  constructor(syncDir: string, watcher: FileWatcher, send: SendFunction) {
    this.syncDir = path.resolve(syncDir);
    this.watcher = watcher;
    this.send = send;
  }

  /**
   * サーバーからのメッセージを処理
   */
  handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'file-update':
        this.handleFileUpdate(message);
        break;
      case 'file-remove':
        this.handleFileRemove(message);
        break;
      case 'sync-snapshot':
        this.handleSyncSnapshot(message);
        break;
      case 'auth-response':
        // 認証レスポンスはConnectionで処理済み
        break;
    }
  }

  /**
   * ローカルの全ファイルをサーバーにアップロード
   * (sync-clear → sync-upload)
   */
  uploadAllFiles(): void {
    console.log(chalk.cyan('[Sync] ローカルファイルをアップロード中...'));

    // まずサーバーのルームをクリア
    this.send({ type: 'sync-clear' });

    // ローカルの全ファイルを収集
    const ig = loadSyncIgnore(this.syncDir);
    const files: FileEntry[] = [];
    this.walkDir(this.syncDir, files, ig);

    // アップロード
    this.send({
      type: 'sync-upload',
      files,
    });

    console.log(chalk.green(`[Sync] アップロード完了: ${files.length} ファイル送信`));
  }

  /**
   * ディレクトリを再帰的に走査してファイルを収集
   */
  private walkDir(dir: string, files: FileEntry[], ig: ReturnType<typeof loadSyncIgnore>): void {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(this.syncDir, fullPath).replace(/\\/g, '/');

      // .sync-ignore チェック
      if (isIgnored(ig, relativePath)) continue;

      if (entry.isDirectory()) {
        this.walkDir(fullPath, files, ig);
      } else if (entry.isFile()) {
        try {
          const content = fs.readFileSync(fullPath);
          const hash = crypto.createHash('sha256').update(content).digest('hex');

          files.push({
            filePath: relativePath,
            content: content.toString('base64'),
            hash,
          });
        } catch {
          console.error(chalk.red(`[Sync] 読み取りエラー: ${relativePath}`));
        }
      }
    }
  }

  /**
   * ファイル更新を受信→ローカルに書き込み
   */
  private handleFileUpdate(msg: FileUpdateMessage): void {
    const filePath = path.join(this.syncDir, msg.filePath);

    // watcher に無視を指示（無限ループ防止）
    this.watcher.addIgnorePath(msg.filePath);

    this.safeWriteFile(filePath, Buffer.from(msg.content, 'base64'));
    console.log(chalk.green(`[Sync ←] ${msg.filePath}`));
  }

  /**
   * ファイル削除を受信→ローカルから削除
   */
  private handleFileRemove(msg: FileRemoveMessage): void {
    const filePath = path.join(this.syncDir, msg.filePath);

    // watcher に無視を指示
    this.watcher.addIgnorePath(msg.filePath);

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(chalk.red(`[Sync ←×] ${msg.filePath}`));

        // 空ディレクトリをクリーンアップ
        this.cleanEmptyDirs(path.dirname(filePath));
      }
    } catch (err) {
      console.error(chalk.red(`[Sync] 削除エラー: ${msg.filePath}`), err);
    }
  }

  /**
   * 初回同期スナップショットを受信→一括書き込み
   */
  private handleSyncSnapshot(msg: SyncSnapshot): void {
    console.log(chalk.cyan(`[Sync] スナップショット受信: ${msg.files.length} ファイル`));

    for (const file of msg.files) {
      const filePath = path.join(this.syncDir, file.filePath);

      // watcher に無視を指示
      this.watcher.addIgnorePath(file.filePath);

      this.safeWriteFile(filePath, Buffer.from(file.content, 'base64'));
    }

    console.log(chalk.green('[Sync] スナップショット適用完了'));
  }

  /**
   * 安全なファイル書き込み（一時ファイル→リネーム）
   */
  private safeWriteFile(filePath: string, content: Buffer): void {
    const dir = path.dirname(filePath);
    const tmpPath = filePath + TEMP_FILE_SUFFIX;

    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(tmpPath, content);
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch { /* ignore */ }

      console.error(chalk.red(`[Sync] 書き込みエラー: ${filePath}`), err);
    }
  }

  /**
   * 空ディレクトリを再帰的に削除
   */
  private cleanEmptyDirs(dir: string): void {
    if (dir === this.syncDir || !dir.startsWith(this.syncDir)) return;

    try {
      const entries = fs.readdirSync(dir);
      if (entries.length === 0) {
        fs.rmdirSync(dir);
        this.cleanEmptyDirs(path.dirname(dir));
      }
    } catch { /* ignore */ }
  }
}
