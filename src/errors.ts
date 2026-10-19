/**
 * - `options`: コンストラクタに渡した設定が不正
 * - `source`: データの取得・解析に失敗
 * - `adapter`: アダプタの指定が不正、または変換中のエラー
 * - `style`: スタイル選択ルール（式）が不正
 * - `worker`: Worker の起動・通信に失敗
 * - `webgl`: シェーダのコンパイルなど WebGL のエラー
 */
export type BuildingWindowErrorCode = 'options' | 'source' | 'adapter' | 'style' | 'worker' | 'webgl';

export class BuildingWindowLayerError extends Error {
  override readonly name = 'BuildingWindowLayerError';

  constructor(
    readonly code: BuildingWindowErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
