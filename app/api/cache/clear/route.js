import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const path = require('path');
    const fs = require('fs');

    const browserDataDir = path.join(process.cwd(), 'browser-data', 'Default');

    // Only clear cache directories — preserve cookies, sessions, login data, preferences
    const cacheDirs = [
      'Cache',
      'Code Cache',
      'GPUCache',
      'Service Worker/CacheStorage',
      'Service Worker/ScriptCache',
      'blob_storage',
    ];

    // Also clear top-level GPU/shader caches
    const topLevelCacheDirs = [
      'GrShaderCache',
      'GraphiteDawnCache',
      'ShaderCache',
    ];

    let freedBytes = 0;
    let clearedDirs = 0;

    function getDirSize(dirPath) {
      let size = 0;
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          if (entry.isDirectory()) {
            size += getDirSize(fullPath);
          } else {
            try { size += fs.statSync(fullPath).size; } catch(e) {}
          }
        }
      } catch(e) {}
      return size;
    }

    // Clear Default/ subdirectories
    for (const dir of cacheDirs) {
      const dirPath = path.join(browserDataDir, dir);
      if (fs.existsSync(dirPath)) {
        const size = getDirSize(dirPath);
        fs.rmSync(dirPath, { recursive: true, force: true });
        freedBytes += size;
        clearedDirs++;
      }
    }

    // Clear top-level cache directories
    const topDir = path.join(process.cwd(), 'browser-data');
    for (const dir of topLevelCacheDirs) {
      const dirPath = path.join(topDir, dir);
      if (fs.existsSync(dirPath)) {
        const size = getDirSize(dirPath);
        fs.rmSync(dirPath, { recursive: true, force: true });
        freedBytes += size;
        clearedDirs++;
      }
    }

    const freedMB = (freedBytes / 1024 / 1024).toFixed(1);

    return NextResponse.json({
      success: true,
      message: `已清理 ${clearedDirs} 个缓存目录，释放 ${freedMB} MB 空间`,
      freedMB: parseFloat(freedMB),
      clearedDirs,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const path = require('path');
    const fs = require('fs');

    const browserDataDir = path.join(process.cwd(), 'browser-data');

    function getDirSize(dirPath) {
      let size = 0;
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          if (entry.isDirectory()) {
            size += getDirSize(fullPath);
          } else {
            try { size += fs.statSync(fullPath).size; } catch(e) {}
          }
        }
      } catch(e) {}
      return size;
    }

    let totalBytes = 0;
    if (fs.existsSync(browserDataDir)) {
      totalBytes = getDirSize(browserDataDir);
    }

    const totalMB = (totalBytes / 1024 / 1024).toFixed(1);

    return NextResponse.json({
      totalMB: parseFloat(totalMB),
      totalFormatted: totalBytes >= 1024 * 1024 * 1024
        ? `${(totalBytes / 1024 / 1024 / 1024).toFixed(2)} GB`
        : `${totalMB} MB`,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
