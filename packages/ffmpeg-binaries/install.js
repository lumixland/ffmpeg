import { platform, arch } from "node:os";
import { createWriteStream, chmodSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";
import { createGunzip } from "node:zlib";
import * as tar from "tar";
import unzipper from "unzipper";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN_DIR = join(__dirname, "bin");
mkdirSync(BIN_DIR, { recursive: true });

const key = `${platform()}-${arch()}`;
const ffmpegFile = join(
  BIN_DIR,
  platform() === "win32" ? "ffmpeg.exe" : "ffmpeg",
);

const FALLBACKS = {
  "win32-x64":
    "https://github.com/BtbN/FFmpeg-Builds/releases/tag/latest/download/ffmpeg-master-latest-win64-gpl-shared.zip",
  "darwin-arm64": "https://evermeet.cx/ffmpeg/ffmpeg-8.0.7z",
  "linux-x64":
    "https://github.com/BtbN/FFmpeg-Builds/releases/tag/latest/download/ffmpeg-master-latest-linux64-gpl.tar.xz",
};

async function findDownloadUrl() {
  const apiUrl =
    "https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/tags/latest";
  const headers = { "User-Agent": "ffmpeg-binaries-installer" };

  try {
    const { res } = await requestWithRedirect(apiUrl, 5, headers);

    let body = "";
    for await (const chunk of res) body += chunk;
    const release = JSON.parse(body);

    const matchers = {
      "win32-x64": ["win64", "windows", "win64-gpl", "win64-shared"],
      "linux-x64": ["linux64", "linux64-gpl"],
      "darwin-arm64": ["macos64", "darwin-arm64", "mac", "osx"],
    };

    const assets = Array.isArray(release.assets) ? release.assets : [];

    for (const asset of assets) {
      const name = (asset.name || "").toLowerCase();
      const matchersForKey = matchers[key] || [];
      if (matchersForKey.some((m) => name.includes(m))) {
        if (asset.browser_download_url) return asset.browser_download_url;
      }
    }

    if (key === "win32-x64") {
      const candidate = assets.find((a) => /win.*64.*\.zip$/i.test(a.name));
      if (candidate) return candidate.browser_download_url;
    }

    if (key === "linux-x64") {
      const candidate = assets.find((a) =>
        /linux.*64.*\.(tar.xz|tar.gz|tgz)$/i.test(a.name),
      );
      if (candidate) return candidate.browser_download_url;
    }

    if (key === "darwin-arm64") {
      const candidate = assets.find((a) =>
        /darwin|mac|osx|arm64/i.test(a.name),
      );
      if (candidate) return candidate.browser_download_url;
    }

    return FALLBACKS[key];
  } catch (err) {
    return FALLBACKS[key];
  }
}

if (existsSync(ffmpegFile)) {
  console.log(`[ffmpeg-binaries] ✅ FFmpeg already installed.`);
  process.exit(0);
}

console.log(
  `[ffmpeg-binaries] Resolving download URL for ${key} (using GitHub Releases API)`,
);

findDownloadUrl()
  .then((url) => {
    if (!url) {
      console.warn(
        `[ffmpeg-binaries] ⚠️ No prebuilt FFmpeg available for ${key}.`,
      );
      process.exit(0);
    }

    console.log(
      `[ffmpeg-binaries] Downloading FFmpeg for ${key} from ${url}...`,
    );
    return downloadAndExtract(url, BIN_DIR);
  })
  .then(() => {
    try {
      chmodSync(ffmpegFile, 0o755);
    } catch (e) {
      // chmod may be a no-op on some Windows setups; ignore
    }
    console.log(`[ffmpeg-binaries] ✅ FFmpeg ready at ${ffmpegFile}`);
  })
  .catch((err) => {
    console.error("[ffmpeg-binaries] ❌ Failed to download FFmpeg:", err);
    process.exit(1);
  });

function requestWithRedirect(srcUrl, maxRedirects = 5, headers = {}) {
  const safeHeaders = Object.keys(headers).length
    ? headers
    : { "User-Agent": "ffmpeg-binaries-installer" };

  return new Promise((resolve, reject) => {
    const makeRequest = (currentUrl, redirectsLeft) => {
      const req = https.get(currentUrl, { headers: safeHeaders }, (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          if (redirectsLeft === 0) {
            reject(new Error(`Too many redirects for ${srcUrl}`));
            return;
          }
          const nextUrl = new URL(res.headers.location, currentUrl).toString();
          res.resume();
          makeRequest(nextUrl, redirectsLeft - 1);
          return;
        }

        resolve({ res, finalUrl: currentUrl });
      });

      req.on("error", reject);
    };

    makeRequest(srcUrl, maxRedirects);
  });
}

function downloadAndExtract(url, dest) {
  return new Promise((resolve, reject) => {
    requestWithRedirect(url)
      .then(({ res, finalUrl }) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${finalUrl}`));
          return;
        }

        if (
          finalUrl.endsWith(".zip") ||
          finalUrl.endsWith(".zip?dl=1") ||
          finalUrl.includes(".zip")
        ) {
          res
            .pipe(unzipper.Extract({ path: dest }))
            .on("close", async () => {
              await moveBinary(dest);
              resolve();
            })
            .on("error", reject);
        } else if (finalUrl.endsWith(".tar.gz") || finalUrl.endsWith(".tgz")) {
          res
            .pipe(createGunzip())
            .pipe(tar.x({ cwd: dest }))
            .on("close", async () => {
              await moveBinary(dest);
              resolve();
            })
            .on("error", reject);
        } else if (finalUrl.endsWith(".tar.xz") || finalUrl.endsWith(".xz")) {
          const filePath = join(dest, "ffmpeg.tar.xz");
          const fileStream = createWriteStream(filePath);
          res.pipe(fileStream);
          fileStream.on("finish", () => {
            fileStream.close();
            console.warn(
              "[ffmpeg-binaries] ⚠️ Downloaded .xz archive. Extraction of .xz is not supported by this script without an external tool. Please extract manually:",
              filePath,
            );
            resolve();
          });
        } else {
          const filePath = join(dest, "ffmpeg.tmp");
          const fileStream = createWriteStream(filePath);
          res.pipe(fileStream);
          fileStream.on("finish", () => {
            fileStream.close();
            resolve();
          });
        }
      })
      .catch(reject);
  });
}

async function moveBinary(dest) {
  const { readdirSync, renameSync } = await import("node:fs");

  const targets =
    platform() === "win32" ? ["ffmpeg.exe", "ffmpeg"] : ["ffmpeg"];

  function findRec(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isFile() && targets.includes(e.name)) return p;
      if (e.isDirectory()) {
        const found = findRec(p);
        if (found) return found;
      }
    }
    return null;
  }

  const found = findRec(dest);
  if (found) {
    try {
      renameSync(found, ffmpegFile);
    } catch (err) {
      const { createReadStream, createWriteStream } = await import("node:fs");
      await new Promise((res, rej) => {
        const r = createReadStream(found);
        const w = createWriteStream(ffmpegFile);
        r.pipe(w);
        w.on("close", res);
        w.on("error", rej);
        r.on("error", rej);
      });
    }
    return;
  }

  console.warn(
    "[ffmpeg-binaries] ⚠️ FFmpeg binary not found after extraction.",
  );
}
