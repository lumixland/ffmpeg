import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { platform } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN_DIR = join(__dirname, "bin");
const binary = join(BIN_DIR, platform() === "win32" ? "ffmpeg.exe" : "ffmpeg");

export const ffmpegPath = fs.existsSync(binary) ? binary : "ffmpeg";
export default { ffmpegPath };
