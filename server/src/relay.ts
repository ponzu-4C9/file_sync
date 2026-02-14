import WebSocket, { WebSocketServer } from 'ws';
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
}

/**
 * リレーサーバー
 * 認証済みクライアント間でファイル変更を中継し、最新版をfile-storeに保持する
 */
export class RelayServer {
  private wss: WebSocketServer;
  private clients: Set<AuthenticatedClient> = new Set();
  private fileStore: FileStore;
  private authConfig: ReturnType<typeof getAuthConfig>;

  constructor(port: number, dataDir: string) {
    this.authConfig = getAuthConfig();
    this.fileStore = new FileStore(dataDir);

    this.wss = new WebSocketServer({ port });
    this.wss.on('connection', (ws) => this.handleConnection(ws));

    console.log(`[Server] ポート ${port} でリッスン中...`);
    console.log(`[Server] データディレクトリ: ${dataDir}`);
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

              clientInfo = { ws, username: message.username };
              this.clients.add(clientInfo);

              const response: AuthResponse = {
                type: 'auth-response',
                success: true,
                message: '認証成功',
              };
              ws.send(JSON.stringify(response));
              console.log(`[Server] 認証成功: ${message.username} (接続数: ${this.clients.size})`);
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
        console.log(`[Server] 切断: ${clientInfo.username} (接続数: ${this.clients.size})`);
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
    switch (message.type) {
      case 'file-change':
        // ファイル保存 → 他クライアントにブロードキャスト
        this.fileStore.saveFile(message.filePath, message.content);

        const updateMsg: FileUpdateMessage = {
          type: 'file-update',
          filePath: message.filePath,
          content: message.content,
          hash: message.hash,
        };
        this.broadcast(updateMsg, sender);
        break;

      case 'file-delete':
        // ファイル削除 → 他クライアントにブロードキャスト
        this.fileStore.deleteFile(message.filePath);

        const removeMsg: FileRemoveMessage = {
          type: 'file-remove',
          filePath: message.filePath,
        };
        this.broadcast(removeMsg, sender);
        break;

      case 'sync-request':
        // 初回同期: 全ファイルを送信
        console.log(`[Server] 初回同期リクエスト: ${sender.username}`);
        const files = this.fileStore.getAllFiles();
        const snapshot: SyncSnapshot = {
          type: 'sync-snapshot',
          files,
        };
        sender.ws.send(JSON.stringify(snapshot));
        console.log(`[Server] 初回同期完了: ${files.length} ファイル送信`);
        break;

      case 'auth':
        // 既に認証済みなので無視
        break;
    }
  }

  /**
   * 送信者以外の全クライアントにメッセージを送信
   */
  private broadcast(message: ServerMessage, sender: AuthenticatedClient): void {
    const data = JSON.stringify(message);

    for (const client of this.clients) {
      if (client !== sender && client.ws.readyState === WebSocket.OPEN) {
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
