import * as chokidar from 'chokidar';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Ignore } from 'ignore';
import { FileChangeMessage, FileDeleteMessage, ClientMessage } from 'file-sync-shared';
import { loadSyncIgnore, isIgnored } from 'file-sync-shared';
import chalk from 'chalk';

type SendFunction = (message: ClientMessage) => void;

/**
 * ファイル監視マネージャー
 * chokidarでsd内の変更を検知し、サーバーに送信
 */
export class FileWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private syncDir: string;
  private send: SendFunction;
  private ig: Ignore;

  /**
   * 自己書き込み無視用フラグ
   * サーバーからの書き込みを自分の変更として検知しないようにする
   */
  private ignorePaths: Set<string> = new Set();

  constructor(syncDir: string, send: SendFunction) {
    this.syncDir = path.resolve(syncDir);
    this.send = send;
    this.ig = loadSyncIgnore(this.syncDir);
  }

  /**
   * 指定パスを一時的に無視リストに追加
   * （サーバーからの書き込み時に使用）
   */
  addIgnorePath(filePath: string): void {
    const absPath = path.resolve(this.syncDir, filePath);
    this.ignorePaths.add(absPath);
    setTimeout(() => {
      this.ignorePaths.delete(absPath);
    }, 2000);
  }

  /**
   * ファイル監視を開始
   */
  start(): void {
    console.log(chalk.cyan(`[Watcher] 監視開始: ${this.syncDir}`));

    this.watcher = chokidar.watch(this.syncDir, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
      // .sync-ignore のパターンは ignored オプションでは直接使えないので
      // イベントハンドラー内でフィルタリングする
    });

    this.watcher.on('add', (filePath) => this.handleChange(filePath));
    this.watcher.on('change', (filePath) => this.handleChange(filePath));
    this.watcher.on('unlink', (filePath) => this.handleDelete(filePath));

    this.watcher.on('error', (err) => {
      console.error(chalk.red('[Watcher] エラー:'), err.message);
    });
  }

  /**
   * ファイルの追加・変更を処理
   */
  private handleChange(filePath: string): void {
    const absPath = path.resolve(filePath);

    // 自己書き込みを無視
    if (this.ignorePaths.has(absPath)) {
      return;
    }

    const relativePath = path.relative(this.syncDir, absPath).replace(/\\/g, '/');

    // .sync-ignore チェック
    if (isIgnored(this.ig, relativePath)) {
      return;
    }

    try {
      const content = fs.readFileSync(absPath);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      const base64Content = content.toString('base64');

      const msg: FileChangeMessage = {
        type: 'file-change',
        filePath: relativePath,
        content: base64Content,
        hash,
      };

      this.send(msg);
      console.log(chalk.blue(`[Sync →] ${relativePath}`));
    } catch (err) {
      // ファイルが既に削除されている場合など
      console.error(chalk.red(`[Watcher] 読み取りエラー: ${relativePath}`));
    }
  }

  /**
   * ファイル削除を処理
   */
  private handleDelete(filePath: string): void {
    const absPath = path.resolve(filePath);

    // 自己書き込みを無視
    if (this.ignorePaths.has(absPath)) {
      return;
    }

    const relativePath = path.relative(this.syncDir, absPath).replace(/\\/g, '/');

    // .sync-ignore チェック
    if (isIgnored(this.ig, relativePath)) {
      return;
    }

    const msg: FileDeleteMessage = {
      type: 'file-delete',
      filePath: relativePath,
    };

    this.send(msg);
    console.log(chalk.red(`[Sync ×] ${relativePath}`));
  }

  /**
   * .sync-ignore を再読み込み
   */
  reloadIgnore(): void {
    this.ig = loadSyncIgnore(this.syncDir);
    console.log(chalk.cyan('[Watcher] .sync-ignore を再読み込み'));
  }

  /**
   * 監視を停止
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      console.log(chalk.cyan('[Watcher] 監視停止'));
    }
  }
}
