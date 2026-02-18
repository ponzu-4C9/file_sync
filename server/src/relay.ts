import WebSocket, { WebSocketServer } from 'ws';
import * as path from 'path';
import {
  ClientMessage,
  ServerMessage,
  FileUpdateMessage,
  FileRemoveMessage,
  SyncSnapshot,
  AuthResponse,
} from 'file-sync-shared';
import { validateCredentials, getAuthConfig, getAuthTimeout } from './auth';
import { FileStore } from './file-store';

interface AuthenticatedClient {
  ws: WebSocket;
  username: string;
  room: string;
}

/**
 * リレーサーバー
 * ルームごとに認証済みクライアント間でファイル変更を中継する
 */
export class RelayServer {
  private wss: WebSocketServer;
  private clients: Set<AuthenticatedClient> = new Set();
  /** ルーム名 → FileStore のマッピング */
  private roomStores: Map<string, FileStore> = new Map();
  private authConfig: ReturnType<typeof getAuthConfig>;
  private baseDataDir: string;

  constructor(port: number, dataDir: string) {
    this.authConfig = getAuthConfig();
    this.baseDataDir = dataDir;

    this.wss = new WebSocketServer({ port });
    this.wss.on('connection', (ws) => this.handleConnection(ws));

    console.log(`[Server] ポート ${port} でリッスン中...`);
    console.log(`[Server] データディレクトリ: ${dataDir}`);
  }

  /**
   * ルームのFileStoreを取得または作成
   */
  private getStore(room: string): FileStore {
    if (!room || typeof room !== 'string') {
      console.error(`[Server] getStore: 無効なルーム名: ${JSON.stringify(room)}, baseDataDir: ${JSON.stringify(this.baseDataDir)}`);
      throw new Error(`無効なルーム名: ${JSON.stringify(room)}`);
    }
    let store = this.roomStores.get(room);
    if (!store) {
      const roomDir = path.join(this.baseDataDir, room);
      store = new FileStore(roomDir);
      this.roomStores.set(room, store);
      console.log(`[Server] ルーム作成: ${room}`);
    }
    return store;
  }

  /**
   * 新規WebSocket接続を処理
   */
  private handleConnection(ws: WebSocket): void {
    console.log('[Server] 新規接続');

    let authenticated = false;
    let clientInfo: AuthenticatedClient | null = null;

    // 認証タイムアウト
    const authTimer = setTimeout(() => {
      if (!authenticated) {
        console.log('[Server] 認証タイムアウト - 切断');
        ws.close(4001, '認証タイムアウト');
      }
    }, getAuthTimeout());

    ws.on('message', (data) => {
      try {
        const message: ClientMessage = JSON.parse(data.toString());

        if (!authenticated) {
          // 未認証: 認証メッセージのみ受け付ける
          if (message.type === 'auth') {
            const isValid = validateCredentials(
              this.authConfig,
              message.username,
              message.password
            );

            if (isValid) {
              authenticated = true;
              clearTimeout(authTimer);

              const room = message.room || 'default';
              const store = this.getStore(room);

              clientInfo = { ws, username: message.username, room };
              this.clients.add(clientInfo);

              const response: AuthResponse = {
                type: 'auth-response',
                success: true,
                message: '認証成功',
                room,
                fileCount: store.getFileCount(),
              };
              ws.send(JSON.stringify(response));
              console.log(`[Server] 認証成功: ${message.username} (ルーム: ${room}, 接続数: ${this.clients.size})`);
            } else {
              const response: AuthResponse = {
                type: 'auth-response',
                success: false,
                message: 'ユーザー名またはパスワードが違います',
              };
              ws.send(JSON.stringify(response));
              console.log(`[Server] 認証失敗: ${message.username}`);
              ws.close(4003, '認証失敗');
            }
          }
          return;
        }

        // 認証済み: メッセージを処理
        this.handleClientMessage(message, clientInfo!);
      } catch (err) {
        console.error('[Server] メッセージ解析エラー:', err);
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (clientInfo) {
        this.clients.delete(clientInfo);
        console.log(`[Server] 切断: ${clientInfo.username} [${clientInfo.room}] (接続数: ${this.clients.size})`);
      }
    });

    ws.on('error', (err) => {
      console.error('[Server] WebSocketエラー:', err.message);
    });
  }

  /**
   * 認証済みクライアントからのメッセージを処理
   */
  private handleClientMessage(
    message: ClientMessage,
    sender: AuthenticatedClient
  ): void {
    const store = this.getStore(sender.room);

    switch (message.type) {
      case 'file-change':
        // ファイル保存 → 同じルームの他クライアントにブロードキャスト
        store.saveFile(message.filePath, message.content);

        const updateMsg: FileUpdateMessage = {
          type: 'file-update',
          filePath: message.filePath,
          content: message.content,
          hash: message.hash,
        };
        this.broadcastToRoom(updateMsg, sender);
        break;

      case 'file-delete':
        // ファイル削除 → 同じルームの他クライアントにブロードキャスト
        store.deleteFile(message.filePath);

        const removeMsg: FileRemoveMessage = {
          type: 'file-remove',
          filePath: message.filePath,
        };
        this.broadcastToRoom(removeMsg, sender);
        break;

      case 'sync-request':
        // 初回同期（ダウンロード）: ルーム内の全ファイルを送信
        console.log(`[Server] ダウンロード同期: ${sender.username} [${sender.room}]`);
        const files = store.getAllFiles();
        const snapshot: SyncSnapshot = {
          type: 'sync-snapshot',
          files,
        };
        sender.ws.send(JSON.stringify(snapshot));
        console.log(`[Server] ダウンロード完了: ${files.length} ファイル送信`);
        break;

      case 'sync-clear':
        // ルーム内全ファイル削除（アップロード前のクリア）
        console.log(`[Server] ルームクリア: ${sender.username} [${sender.room}]`);
        store.clearAll();
        break;

      case 'sync-upload':
        // アップロード: クライアントの全ファイルを保存 → 他クライアントにスナップショット送信
        console.log(`[Server] アップロード同期: ${sender.username} [${sender.room}] (${message.files.length} ファイル)`);
        for (const file of message.files) {
          store.saveFile(file.filePath, file.content);
        }

        // 同じルームの他クライアントにスナップショットとして配信
        const uploadSnapshot: SyncSnapshot = {
          type: 'sync-snapshot',
          files: message.files,
        };
        this.broadcastToRoom(uploadSnapshot, sender);
        console.log(`[Server] アップロード完了`);
        break;

      case 'auth':
        // 既に認証済みなので無視
        break;
    }
  }

  /**
   * 同じルームの送信者以外の全クライアントにメッセージを送信
   */
  private broadcastToRoom(message: ServerMessage, sender: AuthenticatedClient): void {
    const data = JSON.stringify(message);

    for (const client of this.clients) {
      if (
        client !== sender &&
        client.room === sender.room &&
        client.ws.readyState === WebSocket.OPEN
      ) {
        client.ws.send(data);
      }
    }
  }

  /**
   * サーバーを停止
   */
  close(): void {
    this.wss.close();
    console.log('[Server] 停止');
  }
}
