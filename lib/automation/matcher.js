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

// ===== Title Relevance System =====

/**
 * Detect if text is primarily CJK (Chinese/Japanese/Korean).
 * CJK characters carry individual semantic meaning; Latin letters do not.
 */
function isCJKText(text) {
  const cjkMatch = text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uac00-\ud7af\u3040-\u309f\u30a0-\u30ff]/g);
  const cleanLen = text.replace(/[\s\p{P}\d]/gu, '').length;
  return cjkMatch && cleanLen > 0 && cjkMatch.length > cleanLen * 0.3;
}

/**
 * Character-level coverage (for CJK text where each character is meaningful).
 */
function checkCharCoverage(title, dramaName) {
  if (!title || !dramaName) return 0;
  const dramaChars = [...new Set(dramaName.replace(/[\s\p{P}]/gu, '').split(''))].filter(c => c.trim().length > 0);
  if (dramaChars.length === 0) return 1;
  
  let matchCount = 0;
  for (const char of dramaChars) {
    if (title.includes(char)) matchCount++;
  }
  return matchCount / dramaChars.length;
}

// Stop words (function words with no semantic value)
const STOP_WORDS = new Set([
  'of', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'and', 'or',
  'is', 'it', 'by', 'with', 'from', 'as', 'but', 'not', 'no', 'so',
  'if', 'do', 'my', 'his', 'her', 'our', 'your', 'its', 'this', 'that',
  'de', 'du', 'le', 'la', 'les', 'un', 'une', 'des', 'et', 'est', 'en',
  'el', 'lo', 'los', 'las', 'es', 'y', 'da', 'di', 'e', 'il',
  'ma', 'ta', 'sa', 'me', 'te', 'se',
]);

// Common video/media terms (shared across unrelated titles, should not count)
const VIDEO_TERMS = new Set([
  'film', 'complet', 'video', 'vidéo', 'dubbed', 'doublé', 'doble',
  'episode', 'épisode', 'episodio', 'full', 'movie', 'series', 'serie',
  'complete', 'short', 'verse', 'part', 'season', 'ep', 'hd', '4k',
  'online', 'watch', 'streaming', 'vostfr', 'vf', 'sub', 'subtitled',
  'trailer', 'teaser', 'official', 'new', 'drama', 'chinese',
  'dailymotion', 'youtube', 'facebook', 'tiktok',
]);

const NORMALIZE_RE = /[()[\]{}"'.,!?:;—–\-\/\\…#@~`|^&*_+=<>°•·»«¿¡]/g;

function normalizeText(s) {
  return s.toLowerCase().replace(NORMALIZE_RE, ' ').replace(/\s+/g, ' ').trim();
}

/** Extract meaningful content words (not stop words, not video terms). */
function getContentWords(text) {
  return normalizeText(text).split(' ')
    .filter(w => w.length > 1 && !STOP_WORDS.has(w) && !VIDEO_TERMS.has(w));
}

/**
 * Word-level coverage (for Latin/non-CJK text).
 * Counts what % of drama's content words appear in the title.
 */
function checkWordCoverage(title, dramaName) {
  const dramaWords = getContentWords(dramaName);
  if (dramaWords.length === 0) return 1;
  
  const titleNorm = normalizeText(title);
  const titleWordSet = new Set(titleNorm.split(' ').filter(w => w.length > 0));
  
  let matchCount = 0;
  for (const word of dramaWords) {
    if (titleWordSet.has(word)) matchCount++;
  }
  return matchCount / dramaWords.length;
}

/**
 * Check if title contains a consecutive multi-word substring from dramaName.
 * Returns true if a substring of ≥3 consecutive words (with ≥2 content words) is found.
 * Content words exclude both stop words AND common video terms.
 */
function checkConsecutiveSubstring(title, dramaName) {
  if (!title || !dramaName) return false;
  
  const normalizedTitle = normalizeText(title);
  const dramaWords = normalizeText(dramaName).split(' ').filter(w => w.length > 0);
  
  if (dramaWords.length < 3) {
    const phrase = dramaWords.join(' ');
    return normalizedTitle.includes(phrase);
  }
  
  for (let windowSize = 3; windowSize <= dramaWords.length; windowSize++) {
    for (let start = 0; start <= dramaWords.length - windowSize; start++) {
      const subWords = dramaWords.slice(start, start + windowSize);
      const phrase = subWords.join(' ');
      
      if (normalizedTitle.includes(phrase)) {
        // Must contain ≥2 real content words (not stop/video terms)
        const meaningful = subWords.filter(w => w.length > 1 && !STOP_WORDS.has(w) && !VIDEO_TERMS.has(w));
        if (meaningful.length >= 2) {
          return true;
        }
      }
    }
  }
  
  return false;
}

/**
 * Combined title relevance check.
 * Uses character coverage for CJK, word coverage for Latin text.
 * Consecutive substring match is a fallback for partial title matches.
 */
function isTitleRelevant(title, dramaName) {
  if (isCJKText(dramaName)) {
    // CJK: character-level coverage ≥ 70%
    const coverage = checkCharCoverage(title, dramaName);
    if (coverage >= 0.7) return { relevant: true, coverage, method: 'char_coverage' };
  } else {
    // Latin/non-CJK: word-level coverage ≥ 50%
    const wordCov = checkWordCoverage(title, dramaName);
    if (wordCov >= 0.5) return { relevant: true, coverage: wordCov, method: 'word_coverage' };
  }
  
  // Fallback: consecutive substring match (works for both CJK and Latin)
  const hasSubstring = checkConsecutiveSubstring(title, dramaName);
  if (hasSubstring) {
    return { relevant: true, coverage: 0, substringMatch: true, method: 'substring' };
  }
  
  // Calculate coverage for the rejection message
  const coverage = isCJKText(dramaName) 
    ? checkCharCoverage(title, dramaName)
    : checkWordCoverage(title, dramaName);
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
