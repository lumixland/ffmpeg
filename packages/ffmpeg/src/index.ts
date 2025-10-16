/**
 * Public entry points for the package.
 *
 * This module re-exports the main functions/types from smaller modules so
 * consumers can import from the package root.
 */
import * as _converters from "./converters.js";
import { resolveFFmpegBinary as _resolveFFmpegBinary } from "./ffmpeg.js";

const ffmpeg = {
  ..._converters,
  resolveFFmpegBinary: _resolveFFmpegBinary,
};

export default ffmpeg;
export { ConvertOptions } from "./types.js";
export type { ConvertResult } from "./types.js";
export * from "./converters.js";
export const { resolveFFmpegBinary } = ffmpeg;
