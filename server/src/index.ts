import * as dotenv from 'dotenv';
import * as path from 'path';
import { DEFAULT_PORT } from 'file-sync-shared';
import { RelayServer } from './relay';

// .env ファイルを読み込み
dotenv.config();

const port = parseInt(process.env.SYNC_PORT || String(DEFAULT_PORT), 10);
const dataDir = process.env.SYNC_DATA_DIR || path.join(__dirname, '..', 'data');

try {
  const server = new RelayServer(port, dataDir);

  // グレースフルシャットダウン
  const shutdown = () => {
    console.log('\n[Server] シャットダウン中...');
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (err) {
  console.error('[Server] 起動エラー:', err);
  process.exit(1);
}
