const xlsx = require('xlsx');
const path = require('path');

let whitelistCache = null;

function loadWhitelist() {
  if (whitelistCache) return whitelistCache;
  try {
    const filePath = path.join(process.cwd(), 'public', 'whitelist.xlsx');
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);
    
    whitelistCache = new Set();
    data.forEach(row => {
      const name = row['达人账号名'];
      if (name && typeof name === 'string') {
        whitelistCache.add(name.trim().toLowerCase());
      }
    });
    console.log(`[Matcher] Loaded whitelist with ${whitelistCache.size} accounts.`);
  } catch (err) {
    console.error('[Matcher] Failed to load whitelist:', err);
    whitelistCache = new Set(); // Fallback empty
  }
  return whitelistCache;
}

// Title coverage calculation (character-level, works well for Chinese)
function checkTitleCoverage(title, dramaName) {
  if (!title || !dramaName) return 0;
  // Get all unique chinese characters/words from dramaName (excluding punctuation/spaces)
  const dramaChars = [...new Set(dramaName.replace(/[\s\p{P}]/gu, '').split(''))].filter(c => c.trim().length > 0);
  if (dramaChars.length === 0) return 1;
  
  let matchCount = 0;
  for (const char of dramaChars) {
    if (title.includes(char)) {
      matchCount++;
    }
  }
  return matchCount / dramaChars.length;
}

// Stop words to ignore when counting "content words" in English substring matching
const STOP_WORDS = new Set(['of', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'is', 'it', 'by', 'with', 'from', 'as', 'but', 'not', 'no', 'so', 'if', 'do']);

/**
 * Check if title contains a consecutive multi-word substring from dramaName.
 * Returns true if a substring of ≥3 consecutive words (with ≥2 content words) is found.
 */
function checkConsecutiveSubstring(title, dramaName) {
  if (!title || !dramaName) return false;
  
  // Normalize: lowercase, strip punctuation at word boundaries
  const normalize = (s) => s.toLowerCase().replace(/[()\[\]{}"'.,!?:;—–\-\/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  
  const normalizedTitle = normalize(title);
  const dramaWords = normalize(dramaName).split(' ').filter(w => w.length > 0);
  
  if (dramaWords.length < 3) {
    // For very short drama names (< 3 words), check if all words appear consecutively
    const phrase = dramaWords.join(' ');
    return normalizedTitle.includes(phrase);
  }
  
  // Sliding window: check every consecutive subsequence of length 3..N
  for (let windowSize = 3; windowSize <= dramaWords.length; windowSize++) {
    for (let start = 0; start <= dramaWords.length - windowSize; start++) {
      const subWords = dramaWords.slice(start, start + windowSize);
      const phrase = subWords.join(' ');
      
      if (normalizedTitle.includes(phrase)) {
        // Count content words (non-stop-words)
        const contentWords = subWords.filter(w => !STOP_WORDS.has(w));
        if (contentWords.length >= 2) {
          return true;
        }
      }
    }
  }
  
  return false;
}

/**
 * Combined title relevance check.
 * Returns true if title is considered relevant to dramaName.
 */
function isTitleRelevant(title, dramaName) {
  // Method 1: Character coverage (original, good for Chinese)
  const coverage = checkTitleCoverage(title, dramaName);
  if (coverage >= 0.7) return { relevant: true, coverage };
  
  // Method 2: Consecutive substring match (good for English)
  const hasSubstring = checkConsecutiveSubstring(title, dramaName);
  if (hasSubstring) return { relevant: true, coverage, substringMatch: true };
  
  return { relevant: false, coverage };
}

// Extract domain
function getDomain(urlStr) {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, '');
  } catch {
    return urlStr;
  }
}

/**
 * Match a single search result against defined rules.
 * @param {Object} result - The search result object (url, title, snippet)
 * @param {string} dramaName - The target drama name
 * @param {Object} browserContext - Playwright browser context
 * @param {boolean} fastMode - If true, skips non-Dailymotion domains
 * @returns {Promise<Object>} - { match_status, match_reason }
 */
async function matchResult(result, dramaName, browserContext, fastMode = false) {
  loadWhitelist();
  
  const title = result.title || '';
  const url = result.url || '';
  const domain = getDomain(url);
  
  // Rule 1: Title Relevance (character coverage OR consecutive substring match)
  const relevance = isTitleRelevant(title, dramaName);
  if (!relevance.relevant) {
    return {
      match_status: 'safe',
      match_reason: `标题相关度过低 (${Math.round(relevance.coverage * 100)}%)，直接排除`
    };
  }

  const socialMediaDomains = ['facebook.com', 'tiktok.com', 'youtube.com', 'instagram.com'];
  const isSocialMedia = socialMediaDomains.some(d => domain.includes(d));

  if (fastMode && !domain.includes('dailymotion.com')) {
    return {
      match_status: 'safe',
      match_reason: `极速模式，跳过非 Dailymotion 域名检测`
    };
  }

  // Rule 2 & 3 require browser navigation
  if (browserContext) {
    // Rule 2: Dailymotion
    if (domain.includes('dailymotion.com')) {
      let page;
      try {
        page = await browserContext.newPage();
        await page.goto(url, { waitUntil: 'commit', timeout: 12000 }).catch(() => {});
        
        let isPrivateOrDeleted = false;
        let isPlaying = false;
        const maxAttempts = 10; // 每次间隔 300ms，最高等待约 3 秒
        
        for (let i = 0; i < maxAttempts; i++) {
          for (const frame of page.frames()) {
            try {
              const res = await frame.evaluate(() => {
                const text = document.body ? document.body.innerText.replace(/\s+/g, '') : '';
                const isError = 
                  text.includes('私人视频') || 
                  text.includes('发布者已将此视频标记为私有') || 
                  text.includes('视频不可用') || 
                  text.includes('此视频在你所在的地区不可用') || 
                  text.includes('视频已被删除') || 
                  text.includes('此视频不再可用');
                  
                const videoEl = document.querySelector('video');
                // state >= 1 means metadata loaded (video stream is established)
                const isReady = !!videoEl && videoEl.readyState >= 1;
                
                return { isError, isReady };
              });
              
              if (res.isError) isPrivateOrDeleted = true;
              if (res.isReady) isPlaying = true;
            } catch(e) {}
          }
          
          if (isPrivateOrDeleted || isPlaying) {
            break; // 能提前定性就立刻结束等待
          }
          await page.waitForTimeout(300);
        }
          
        if (isPrivateOrDeleted) {
          await page.close();
          return { match_status: 'safe', match_reason: 'Dailymotion视频已失效(私人/下架/地域限制)' };
        } else {
          await page.close();
          // 如果没有匹配到报错文本，推测可以播放
          return { match_status: 'piracy', match_reason: 'Dailymotion视频存活，确认为盗版' };
        }
      } catch (e) {
        if (page) await page.close().catch(() => {});
        return { match_status: 'suspicious', match_reason: 'Dailymotion网页抓取异常，转待定' };
      }
    }
    
    // Rule 3: Social Media (Facebook, TikTok, YouTube, Instagram) - Static inspection
    // Fast & Reliable string search on title and snippet
    if (isSocialMedia && !domain.includes('dailymotion.com')) {
      const searchSpace = `${title} ${result.snippet || ''} ${url}`.toLowerCase();
      
      let matchedWhitelistAccount = null;
      for (const account of whitelistCache) {
        const accLower = account.toLowerCase();
        if (searchSpace.includes(accLower)) {
          matchedWhitelistAccount = account;
          break;
        }
      }
      
      if (matchedWhitelistAccount) {
        return { match_status: 'safe', match_reason: `社媒域名，但标题/摘要命中白名单账号: ${matchedWhitelistAccount}` };
      } else {
        return { match_status: 'suspicious', match_reason: `四大社媒网址，但标题/摘要未命中白名单` };
      }
    }
  } else {
    // If no browser context is provided, fallback for social media static check
    if (isSocialMedia && !domain.includes('dailymotion.com')) {
      const searchSpace = `${title} ${result.snippet || ''} ${url}`.toLowerCase();
      
      let matchedWhitelistAccount = null;
      for (const account of whitelistCache) {
        const accLower = account.toLowerCase();
        if (searchSpace.includes(accLower)) {
          matchedWhitelistAccount = account;
          break;
        }
      }
      
      if (matchedWhitelistAccount) {
        return { match_status: 'safe', match_reason: `社媒域名，命中白名单: ${matchedWhitelistAccount}` };
      } else {
        return { match_status: 'suspicious', match_reason: `四大社媒网址，未命中白名单` };
      }
    }
  }

  // Rule 4: Fallback
  return { match_status: 'suspicious', match_reason: `非白名单普通外部域名，转疑似盗版人工判定` };
}

module.exports = {
  matchResult,
  loadWhitelist
};
