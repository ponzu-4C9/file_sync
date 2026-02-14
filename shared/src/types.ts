// ============================================================
// File Sync - 共通型定義
// ============================================================

/** ファイルエントリ（初回同期用） */
export interface FileEntry {
  /** sd内の相対パス（例: "app/page.tsx"） */
  filePath: string;
  /** ファイル内容（Base64エンコード） */
  content: string;
  /** SHA-256ハッシュ（重複送信防止） */
  hash: string;
}

// ============================================================
// クライアント → サーバー メッセージ
// ============================================================

/** 認証リクエスト */
export interface AuthRequest {
  type: 'auth';
  username: string;
  password: string;
}

/** ファイル変更通知 */
export interface FileChangeMessage {
  type: 'file-change';
  filePath: string;
  content: string;
  hash: string;
}

/** ファイル削除通知 */
export interface FileDeleteMessage {
  type: 'file-delete';
  filePath: string;
}

/** 初回同期リクエスト */
export interface SyncRequest {
  type: 'sync-request';
}

/** クライアント→サーバーの全メッセージ型 */
export type ClientMessage =
  | AuthRequest
  | FileChangeMessage
  | FileDeleteMessage
  | SyncRequest;

// ============================================================
// サーバー → クライアント メッセージ
// ============================================================

/** 認証レスポンス */
export interface AuthResponse {
  type: 'auth-response';
  success: boolean;
  message?: string;
}

/** ファイル更新通知（他クライアントから） */
export interface FileUpdateMessage {
  type: 'file-update';
  filePath: string;
  content: string;
  hash: string;
}

/** ファイル削除通知（他クライアントから） */
export interface FileRemoveMessage {
  type: 'file-remove';
  filePath: string;
}

/** 初回同期スナップショット */
export interface SyncSnapshot {
  type: 'sync-snapshot';
  files: FileEntry[];
}

/** サーバー→クライアントの全メッセージ型 */
export type ServerMessage =
  | AuthResponse
  | FileUpdateMessage
  | FileRemoveMessage
  | SyncSnapshot;

/** 全メッセージ型 */
export type Message = ClientMessage | ServerMessage;
