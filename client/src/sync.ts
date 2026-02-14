import * as fs from 'fs';
import * as path from 'path';
import { ServerMessage, FileUpdateMessage, FileRemoveMessage, SyncSnapshot, TEMP_FILE_SUFFIX } from 'file-sync-shared';
import { FileWatcher } from './watcher';
import chalk from 'chalk';

/**
 * 同期マネージャー
 * サーバーからのメッセージを受信し、ローカルファイルに反映する
 */
export class SyncManager {
  private syncDir: string;
  private watcher: FileWatcher;

  constructor(syncDir: string, watcher: FileWatcher) {
    this.syncDir = path.resolve(syncDir);
    this.watcher = watcher;
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
    console.log(chalk.cyan(`[Sync] 初回同期: ${msg.files.length} ファイル受信`));

    for (const file of msg.files) {
      const filePath = path.join(this.syncDir, file.filePath);

      // watcher に無視を指示
      this.watcher.addIgnorePath(file.filePath);

      this.safeWriteFile(filePath, Buffer.from(file.content, 'base64'));
    }

    console.log(chalk.green('[Sync] 初回同期完了'));
  }

  /**
   * 安全なファイル書き込み（一時ファイル→リネーム）
   * ファイルロック対策
   */
  private safeWriteFile(filePath: string, content: Buffer): void {
    const dir = path.dirname(filePath);
    const tmpPath = filePath + TEMP_FILE_SUFFIX;

    try {
      // ディレクトリが存在しなければ作成
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 一時ファイルに書き込み → リネーム（アトミック操作）
      fs.writeFileSync(tmpPath, content);
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      // 一時ファイルが残っていたら削除
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
