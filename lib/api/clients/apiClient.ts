/**
 * APIレスポンスの共通型定義
 */
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  status: number;
}

/**
 * 汎用的なAPIクライアントクラス
 * 基本的なHTTPリクエスト処理とエラーハンドリングを提供
 */
export class ApiClient {
  private baseUrl: string;
  
  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl;
  }
  
  /**
   * GETリクエストを実行
   * @param endpoint APIエンドポイントパス
   * @param params URLクエリパラメータ
   * @returns APIレスポンス
   */
  async get<T>(endpoint: string, params?: Record<string, string>): Promise<ApiResponse<T>> {
    try {
      const url = new URL(this.baseUrl + endpoint, window.location.origin);
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          url.searchParams.append(key, value);
        });
      }
      
      const response = await fetch(url.toString());
      const data = await response.json();
      
      return {
        data: response.ok ? data : undefined,
        error: !response.ok ? data.error || 'Unknown error' : undefined,
        status: response.status
      };
    } catch (error) {
      console.error(`[ApiClient] GET request failed: ${endpoint}`, error);
      return {
        error: error instanceof Error ? error.message : 'Network error',
        status: 0
      };
    }
  }
  
  /**
   * POSTリクエストを実行
   * @param endpoint APIエンドポイントパス
   * @param body リクエストボディ
   * @returns APIレスポンス
   */
  async post<T, U>(endpoint: string, body: T): Promise<ApiResponse<U>> {
    try {
      const response = await fetch(this.baseUrl + endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      
      const data = await response.json();
      
      return {
        data: response.ok ? data : undefined,
        error: !response.ok ? data.error || 'Unknown error' : undefined,
        status: response.status
      };
    } catch (error) {
      console.error(`[ApiClient] POST request failed: ${endpoint}`, error);
      return {
        error: error instanceof Error ? error.message : 'Network error',
        status: 0
      };
    }
  }
}

// デフォルトのAPIクライアントインスタンス
export const apiClient = new ApiClient(); 