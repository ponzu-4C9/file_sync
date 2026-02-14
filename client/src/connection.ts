import WebSocket from 'ws';
import {
  ClientMessage,
  ServerMessage,
  AuthResponse,
  RECONNECT_INITIAL_DELAY,
  RECONNECT_MAX_DELAY,
} from 'file-sync-shared';
import chalk from 'chalk';

type MessageHandler = (message: ServerMessage) => void;

export interface AuthResult {
  room: string;
  fileCount: number;
}

/**
 * WebSocket接続管理
 * 認証フロー・自動再接続を担当
 */
export class Connection {
  private ws: WebSocket | null = null;
  private serverUrl: string;
  private username: string;
  private password: string;
  private room: string;
  private onMessage: MessageHandler;
  private onReconnected: (() => void) | null = null;
  private reconnectDelay: number = RECONNECT_INITIAL_DELAY;
  private isClosing: boolean = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    serverUrl: string,
    username: string,
    password: string,
    room: string,
    onMessage: MessageHandler
  ) {
    this.serverUrl = serverUrl;
    this.username = username;
    this.password = password;
    this.room = room;
    this.onMessage = onMessage;
  }

  /**
   * 再接続時のコールバックを設定
   */
  setReconnectHandler(handler: () => void): void {
    this.onReconnected = handler;
  }

  /**
   * サーバーに接続開始。認証成功時にルーム情報を返す
   */
  connect(): Promise<AuthResult> {
    return new Promise((resolve, reject) => {
      console.log(chalk.yellow(`[Client] ${this.serverUrl} に接続中...`));

      this.ws = new WebSocket(this.serverUrl);

      this.ws.on('open', () => {
        console.log(chalk.green('[Client] 接続完了 - 認証中...'));
        this.reconnectDelay = RECONNECT_INITIAL_DELAY;

        // 認証メッセージを送信（ルーム名を含む）
        const authMsg: ClientMessage = {
          type: 'auth',
          username: this.username,
          password: this.password,
          room: this.room,
        };
        this.ws!.send(JSON.stringify(authMsg));
      });

      let authResolved = false;

      this.ws.on('message', (data) => {
        try {
          const message: ServerMessage = JSON.parse(data.toString());

          // 認証レスポンスの処理
          if (message.type === 'auth-response' && !authResolved) {
            authResolved = true;
            const authResp = message as AuthResponse;

            if (authResp.success) {
              console.log(chalk.green(`[Client] 認証成功 (ルーム: ${authResp.room}, サーバー上のファイル数: ${authResp.fileCount})`));
              resolve({
                room: authResp.room || this.room,
                fileCount: authResp.fileCount || 0,
              });
            } else {
              console.error(chalk.red(`[Client] 認証失敗: ${authResp.message}`));
              this.isClosing = true;
              this.ws?.close();
              reject(new Error(authResp.message || '認証失敗'));
            }
            return;
          }

          // 通常メッセージの処理
          this.onMessage(message);
        } catch (err) {
          console.error(chalk.red('[Client] メッセージ解析エラー:'), err);
        }
      });

      this.ws.on('close', (code, reason) => {
        if (!authResolved) {
          authResolved = true;
          reject(new Error('接続が閉じられました'));
        }

        if (!this.isClosing) {
          console.log(chalk.yellow(`[Client] 切断 (code: ${code}) - ${this.reconnectDelay / 1000}秒後に再接続...`));
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (err) => {
        if (!authResolved) {
          authResolved = true;
          reject(err);
        }
        console.error(chalk.red('[Client] 接続エラー:'), err.message);
      });
    });
  }

  /**
   * メッセージを送信
   */
  send(message: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * 再接続スケジュール（指数バックオフ）
   */
  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
        // 再接続成功時
        if (this.onReconnected) {
          this.onReconnected();
        }
      } catch {
        this.reconnectDelay = Math.min(
          this.reconnectDelay * 2,
          RECONNECT_MAX_DELAY
        );
      }
    }, this.reconnectDelay);
  }

  /**
   * 接続を閉じる
   */
  close(): void {
    this.isClosing = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    if (this.ws) {
      this.ws.close();
    }
  }
}
