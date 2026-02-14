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

// ============================================================
// CUI ヘルパー
// ============================================================

function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function askConfirmation(question: string): Promise<boolean> {
  const rl = createReadline();
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

async function askSyncMode(): Promise<'download' | 'upload' | 'skip'> {
  const rl = createReadline();
  return new Promise((resolve) => {
    console.log(chalk.bold('\n初回同期モードを選んでください:'));
    console.log(`  ${chalk.cyan('1.')} ダウンロード (サーバー → このPC)`);
    console.log(`  ${chalk.cyan('2.')} アップロード (このPC → サーバー)`);
    console.log(`  ${chalk.cyan('3.')} スキップ (以降の変更のみ同期)`);
    rl.question(chalk.yellow('> '), (answer) => {
      rl.close();
      switch (answer.trim()) {
        case '1': resolve('download'); break;
        case '2': resolve('upload'); break;
        case '3': resolve('skip'); break;
        default:
          console.log(chalk.yellow('無効な入力です。スキップとして扱います。'));
          resolve('skip');
      }
    });
  });
}

// ============================================================
// メイン
// ============================================================

async function main(): Promise<void> {
  const syncDir = path.resolve(opts.dir);
  const roomName = path.basename(syncDir);

  console.log(chalk.bold('\n=== File Sync Client ===\n'));
  console.log(`サーバー:         ${chalk.cyan(opts.server)}`);
  console.log(`ルーム名:         ${chalk.cyan(roomName)}`);
  console.log(`同期ディレクトリ: ${chalk.cyan(syncDir)}`);
  console.log(`ユーザー:         ${chalk.cyan(opts.username)}`);

  // 同期ディレクトリの存在確認
  if (!fs.existsSync(syncDir)) {
    const create = await askConfirmation(
      chalk.yellow(`\nディレクトリ "${syncDir}" が存在しません。作成しますか？ (y/N): `)
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
    chalk.yellow(`\nルーム "${roomName}" に接続しますか？ (y/N): `)
  );
  if (!confirmed) {
    console.log(chalk.red('終了します'));
    process.exit(0);
  }

  // 接続
  const connection = new Connection(
    opts.server,
    opts.username,
    opts.password,
    roomName,
    (message: ServerMessage) => {
      syncManager.handleMessage(message);
    }
  );

  // Watcher と SyncManager を初期化
  const watcher = new FileWatcher(syncDir, (msg) => connection.send(msg));
  const syncManager = new SyncManager(syncDir, watcher, (msg) => connection.send(msg));

  let authResult;
  try {
    authResult = await connection.connect();
  } catch (err: any) {
    console.error(chalk.red(`\n接続エラー: ${err.message}`));
    process.exit(1);
  }

  // 初回同期モード選択
  const syncMode = await askSyncMode();

  if (syncMode === 'download') {
    if (authResult.fileCount > 0) {
      const ok = await askConfirmation(
        chalk.red(`\n⚠ このPCの "${syncDir}" の内容がサーバーの内容で上書きされます。本当にいいですか？ (y/N): `)
      );
      if (!ok) {
        console.log(chalk.yellow('スキップに変更しました'));
      } else {
        // ダウンロード実行
        console.log(chalk.cyan('[Client] ダウンロード同期をリクエスト中...'));
        const syncReq: SyncRequest = { type: 'sync-request' };
        connection.send(syncReq);
      }
    } else {
      console.log(chalk.yellow('サーバーにファイルがないため、スキップします'));
    }
  } else if (syncMode === 'upload') {
    const ok = await askConfirmation(
      chalk.red(`\n⚠ サーバーのルーム "${roomName}" の内容が上書きされます。本当にいいですか？ (y/N): `)
    );
    if (!ok) {
      console.log(chalk.yellow('スキップに変更しました'));
    } else {
      // アップロード実行
      syncManager.uploadAllFiles();
    }
  } else {
    console.log(chalk.cyan('初回同期をスキップしました'));
  }

  // 再接続時はリクエストだけ再送（ダウンロードモード）
  connection.setReconnectHandler(() => {
    console.log(chalk.cyan('[Client] 再接続 - 同期をリクエスト中...'));
    const syncReq: SyncRequest = { type: 'sync-request' };
    connection.send(syncReq);
  });

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
