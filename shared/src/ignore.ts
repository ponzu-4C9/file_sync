import ignore, { Ignore } from 'ignore';
import * as fs from 'fs';
import * as path from 'path';
import { SYNC_IGNORE_FILE } from './constants';

/**
 * .sync-ignore ファイルを読み込み、ignoreインスタンスを作成する
 */
export function loadSyncIgnore(syncDir: string): Ignore {
  const ig = ignore();

  // デフォルトで常に除外するパターン
  ig.add([
    '.git/',
    '.sync-ignore',
    '*.sync-tmp',
  ]);

  const ignoreFilePath = path.join(syncDir, SYNC_IGNORE_FILE);

  if (fs.existsSync(ignoreFilePath)) {
    const content = fs.readFileSync(ignoreFilePath, 'utf-8');
    const lines = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    ig.add(lines);
  }

  return ig;
}

/**
 * 指定パスが除外対象かどうかを判定
 * @param ig ignoreインスタンス
 * @param relativePath sd内の相対パス
 */
export function isIgnored(ig: Ignore, relativePath: string): boolean {
  // パスをforwardスラッシュに正規化
  const normalized = relativePath.replace(/\\/g, '/');
  return ig.ignores(normalized);
}
