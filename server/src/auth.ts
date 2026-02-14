import { AUTH_TIMEOUT } from 'file-sync-shared';

interface AuthConfig {
  username: string;
  password: string;
}

/**
 * 環境変数から認証情報を取得
 */
export function getAuthConfig(): AuthConfig {
  const username = process.env.SYNC_USERNAME;
  const password = process.env.SYNC_PASSWORD;

  if (!username || !password) {
    throw new Error(
      '環境変数 SYNC_USERNAME と SYNC_PASSWORD を設定してください'
    );
  }

  return { username, password };
}

/**
 * 認証情報を検証
 */
export function validateCredentials(
  config: AuthConfig,
  username: string,
  password: string
): boolean {
  return config.username === username && config.password === password;
}

/**
 * 認証タイムアウト値を返す
 */
export function getAuthTimeout(): number {
  return AUTH_TIMEOUT;
}
