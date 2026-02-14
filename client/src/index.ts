import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { Command } from 'commander';
import { DEFAULT_PORT, SyncRequest, ServerMessage } from 'file-sync-shared';
import { Connection } from './connection';
import { FileWatcher } from './watcher';
import { SyncManager } from './sync';
import chalk from 'chalk';

const program = new Command();

program
  .name('file-sync')
  .description('ファイル同期クライアント')
  .requiredOption('-s, --server <url>', 'サーバーURL (例: ws://192.168.1.100:8080)')
  .requiredOption('-d, --dir <path>', '同期ディレクトリのパス')
  .requiredOption('-u, --username <name>', 'ユーザー名')
  .requiredOption('-p, --password <pass>', 'パスワード')
  .parse(process.argv);

const opts = program.opts<{
  server: string;
  dir: string;
  username: string;
  password: string;
}>();

async function askConfirmation(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

async function main(): Promise<void> {
  const syncDir = path.resolve(opts.dir);

  console.log(chalk.bold('\n=== File Sync Client ===\n'));
  console.log(`サーバー: ${chalk.cyan(opts.server)}`);
  console.log(`同期ディレクトリ: ${chalk.cyan(syncDir)}`);
  console.log(`ユーザー: ${chalk.cyan(opts.username)}`);
  console.log('');

  // 同期ディレクトリの存在確認
  if (!fs.existsSync(syncDir)) {
    const create = await askConfirmation(
      chalk.yellow(`ディレクトリ "${syncDir}" が存在しません。作成しますか？ (y/N): `)
    );
    if (create) {
      fs.mkdirSync(syncDir, { recursive: true });
      console.log(chalk.green('ディレクトリを作成しました'));
    } else {
      console.log(chalk.red('終了します'));
      process.exit(1);
    }
  }

  // 接続確認
  const confirmed = await askConfirmation(
    chalk.yellow(`このディレクトリを "${opts.server}" と同期しますか？ (y/N): `)
  );
  if (!confirmed) {
    console.log(chalk.red('終了します'));
    process.exit(0);
  }

  // FileWatcherの初期化（まだ開始しない）
  let watcher: FileWatcher;
  let syncManager: SyncManager;

  const onMessage = (message: ServerMessage) => {
    syncManager.handleMessage(message);
  };

  const onConnected = () => {
    // 初回接続時は初回同期をリクエスト
    console.log(chalk.cyan('[Client] 初回同期をリクエスト中...'));
    const syncReq: SyncRequest = { type: 'sync-request' };
    connection.send(syncReq);
  };

  // 接続
  const connection = new Connection(
    opts.server,
    opts.username,
    opts.password,
    onMessage,
    onConnected
  );

  // Watcher と SyncManager を初期化
  watcher = new FileWatcher(syncDir, (msg) => connection.send(msg));
  syncManager = new SyncManager(syncDir, watcher);

  try {
    await connection.connect();
  } catch (err: any) {
    console.error(chalk.red(`\n接続エラー: ${err.message}`));
    process.exit(1);
  }

  // ファイル監視開始
  watcher.start();

  console.log(chalk.green('\n✓ 同期稼働中。Ctrl+C で停止します。\n'));

  // グレースフルシャットダウン
  const shutdown = async () => {
    console.log(chalk.yellow('\nシャットダウン中...'));
    await watcher.stop();
    connection.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(chalk.red('エラー:'), err);
  process.exit(1);
});
