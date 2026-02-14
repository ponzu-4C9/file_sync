import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { FileEntry } from 'file-sync-shared';

/**
 * サーバー側ファイルストア
 * 最新版のファイルを保持し、オフラインクライアントの再接続時に提供する
 */
export class FileStore {
  private readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    // データディレクトリが存在しなければ作成
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * ファイルを保存（Last Write Wins: 常に上書き）
   */
  saveFile(filePath: string, content: string): void {
    const fullPath = this.resolveFilePath(filePath);
    const dir = path.dirname(fullPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, Buffer.from(content, 'base64'));
    console.log(`[FileStore] 保存: ${filePath}`);
  }

  /**
   * ファイルを削除
   */
  deleteFile(filePath: string): void {
    const fullPath = this.resolveFilePath(filePath);

    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      console.log(`[FileStore] 削除: ${filePath}`);

      // 空のディレクトリを削除
      this.cleanEmptyDirs(path.dirname(fullPath));
    }
  }

  /**
   * 全ファイルを取得（初回同期用）
   */
  getAllFiles(): FileEntry[] {
    const files: FileEntry[] = [];
    this.walkDir(this.dataDir, files);
    return files;
  }

  /**
   * ルーム内の全ファイルを削除
   */
  clearAll(): void {
    this.deleteDirContents(this.dataDir);
    console.log('[FileStore] ルーム内全ファイル削除');
  }

  /**
   * ルーム内のファイル数を取得
   */
  getFileCount(): number {
    const files: FileEntry[] = [];
    this.walkDir(this.dataDir, files);
    return files.length;
  }

  /**
   * ディレクトリの中身を再帰的に削除（ディレクトリ自体は残す）
   */
  private deleteDirContents(dir: string): void {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this.deleteDirContents(fullPath);
        fs.rmdirSync(fullPath);
      } else {
        fs.unlinkSync(fullPath);
      }
    }
  }

  /**
   * ディレクトリを再帰的に走査
   */
  private walkDir(dir: string, files: FileEntry[]): void {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        this.walkDir(fullPath, files);
      } else if (entry.isFile()) {
        const relativePath = path.relative(this.dataDir, fullPath).replace(/\\/g, '/');
        const content = fs.readFileSync(fullPath);
        const hash = crypto.createHash('sha256').update(content).digest('hex');

        files.push({
          filePath: relativePath,
          content: content.toString('base64'),
          hash,
        });
      }
    }
  }

  /**
   * 空のディレクトリを再帰的にクリーンアップ
   */
  private cleanEmptyDirs(dir: string): void {
    if (dir === this.dataDir) return;

    try {
      const entries = fs.readdirSync(dir);
      if (entries.length === 0) {
        fs.rmdirSync(dir);
        this.cleanEmptyDirs(path.dirname(dir));
      }
    } catch {
      // ディレクトリアクセスエラーは無視
    }
  }

  /**
   * 相対パスを絶対パスに解決（パストラバーサル防止）
   */
  private resolveFilePath(filePath: string): string {
    const normalized = path.normalize(filePath);
    const fullPath = path.join(this.dataDir, normalized);

    // パストラバーサル防止
    if (!fullPath.startsWith(this.dataDir)) {
      throw new Error(`不正なパス: ${filePath}`);
    }

    return fullPath;
  }
}
