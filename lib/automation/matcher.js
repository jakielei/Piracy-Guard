const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

let whitelistCache = null;

// Force-clear cache on module load so code changes always take effect
whitelistCache = null;

function loadWhitelist() {
  // Only use cache if it was successfully loaded with actual entries
  if (whitelistCache && whitelistCache.size > 0) return whitelistCache;
  try {
    const filePath = path.join(process.cwd(), 'public', 'whitelist.xlsx');
    // Use fs.readFileSync + xlsx.read instead of xlsx.readFile to handle
    // paths with CJK characters and spaces (which xlsx.readFile cannot access in Turbopack)
    const fileBuffer = fs.readFileSync(filePath);
    const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    // range: 1 skips the merged title row (Row 0) — actual column headers are in Row 1
    const data = xlsx.utils.sheet_to_json(sheet, { range: 1 });
    
    whitelistCache = new Set();
    data.forEach(row => {
      const name = row['达人账号名'];
      if (name && typeof name === 'string') {
        whitelistCache.add(name.trim().toLowerCase());
      }
    });
    console.log(`[Matcher] Loaded whitelist with ${whitelistCache.size} accounts.`);
    
    // Sanity check: if still empty, something is wrong
    if (whitelistCache.size === 0) {
      console.error('[Matcher] WARNING: Whitelist loaded 0 accounts! Check Excel column headers.');
    }
  } catch (err) {
    console.error('[Matcher] Failed to load whitelist:', err);
    whitelistCache = new Set(); // Fallback empty — still iterable
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
  // Applies to ALL domains — irrelevant titles are directly excluded
  const relevance = isTitleRelevant(title, dramaName);
  if (!relevance.relevant) {
    return {
      match_status: 'safe',
      match_reason: `标题相关度过低 (${Math.round(relevance.coverage * 100)}%)，直接排除`
    };
  }

  const socialMediaDomains = ['facebook.com', 'tiktok.com', 'youtube.com', 'instagram.com', 'x.com', 'twitter.com'];
  const isSocialMedia = socialMediaDomains.some(d => domain.includes(d));

  // Rule 2: Social Media — account-based whitelist matching
  if (isSocialMedia) {
    return matchSocialMedia(result, domain);
  }

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
  }

  // Rule 3: Fallback
  return { match_status: 'suspicious', match_reason: `非白名单普通外部域名，转疑似盗版人工判定` };
}

/**
 * Extract account name from Google search result's siteName field.
 * e.g. "YouTube · Enchanted Playhouse" → "Enchanted Playhouse"
 * e.g. "Instagram · dramabox_espanol" → "dramabox_espanol"
 * e.g. "Facebook · Drama Chino" → "Drama Chino"
 * @param {string} siteName - The siteName text from Google search result
 * @returns {string|null} - The extracted account name, or null if not found
 */
function extractSocialAccountName(siteName) {
  if (!siteName) return null;
  
  // Split by " · " (middle dot with spaces) — this is how Google separates platform name and account
  const separators = [' · ', ' · ', ' ‧ ', ' • '];
  for (const sep of separators) {
    const idx = siteName.indexOf(sep);
    if (idx !== -1) {
      const beforeSep = siteName.substring(0, idx).trim();
      let accountPart = siteName.substring(idx + sep.length).trim();
      
      // Verify the part before separator looks like a platform name
      const platforms = ['YouTube', 'TikTok', 'Instagram', 'Facebook', 'X', 'Twitter'];
      const isPlatform = platforms.some(p => beforeSep.toLowerCase() === p.toLowerCase());
      
      if (isPlatform && accountPart.length > 0) {
        // Clean off any trailing metadata (view counts, dates, etc.)
        // e.g. "Enchanted Playhouse 45.7万+ 次观看 · 2个月前" → "Enchanted Playhouse"
        accountPart = accountPart.replace(/\s+\d[\d.,]*\s*[万千亿kKmMbB+]*.*$/, '').trim();
        if (accountPart.length > 0) {
          return accountPart;
        }
      }
    }
  }
  
  return null;
}

/**
 * Extract account name from any text (snippet, title, etc.) by looking for
 * "PlatformName · AccountName" patterns using regex.
 * This is more robust than siteName extraction because snippet text reliably
 * contains patterns like "YouTube · Enchanted Playhouse 45.7万+ 次观看 · 2个月前"
 * @param {string} text - The text to search in (usually snippet)
 * @param {string} domain - The domain to determine which platform to look for
 * @returns {string|null} - The extracted account name, or null if not found
 */
function extractAccountFromText(text, domain) {
  if (!text) return null;
  
  // Map domain to possible platform name strings
  const platformMap = {
    'youtube.com': ['YouTube'],
    'tiktok.com': ['TikTok'],
    'instagram.com': ['Instagram'],
    'facebook.com': ['Facebook'],
    'x.com': ['X'],
    'twitter.com': ['X', 'Twitter'],
  };
  
  let platformNames = null;
  for (const [d, names] of Object.entries(platformMap)) {
    if (domain.includes(d)) {
      platformNames = names;
      break;
    }
  }
  if (!platformNames) return null;
  
  // Try each platform name variant
  for (const platformName of platformNames) {
    // Build regex: PlatformName followed by separator (· • ‧) followed by account name
    // Account name ends before a digit pattern (view count) or end of string
    const escapedName = platformName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedName + '\\s*[·•‧]\\s*(.+?)(?:\\s+\\d|$)', 'i');
    const match = text.match(regex);
    
    if (match && match[1]) {
      const accountName = match[1].trim();
      if (accountName.length > 0) {
        return accountName;
      }
    }
  }
  
  return null;
}

/**
 * Check if the social media result is a special page that should be auto-passed:
 * - TikTok "Discover" page (tag/hashtag browsing, not a specific uploader)
 * - YouTube "playlist" page (aggregated playlist, not a specific uploader)
 * @param {string} displayUrl - The display URL breadcrumb from Google search result
 * @param {string} url - The actual URL
 * @param {string} domain - The domain
 * @returns {string|null} - Description if special page, or null
 */
function isSocialMediaSpecialPage(displayUrl, url, domain) {
  const displayLower = (displayUrl || '').toLowerCase();
  const urlLower = (url || '').toLowerCase();
  
  // TikTok discover page: url or displayUrl contains "discover" or "tag"
  if (domain.includes('tiktok.com')) {
    if (displayLower.includes('discover') || urlLower.includes('/discover') || urlLower.includes('/tag/')) {
      return 'TikTok Discover页（标签/发现页），非特定用户上传';
    }
  }
  
  // YouTube playlist page: url or displayUrl contains "playlist"
  if (domain.includes('youtube.com')) {
    if (displayLower.includes('playlist') || urlLower.includes('playlist')) {
      return 'YouTube Playlist页（播放列表），非特定用户上传';
    }
  }
  
  return null;
}

/**
 * Match a social media result by extracting the account name and comparing against whitelist.
 * Extraction priority: 1) snippet regex, 2) siteName field, 3) old title+snippet full search
 * @param {Object} result - The search result object
 * @param {string} domain - The domain
 * @returns {Object} - { match_status, match_reason }
 */
function matchSocialMedia(result, domain) {
  const siteName = result.siteName || result.site_name || '';
  const displayUrl = result.displayUrl || result.display_url || '';
  const url = result.url || '';
  const title = result.title || '';
  const snippet = result.snippet || '';
  
  // Step 1: Check for special pages (TikTok discover, YouTube playlist)
  const specialPage = isSocialMediaSpecialPage(displayUrl, url, domain);
  if (specialPage) {
    return { match_status: 'safe', match_reason: specialPage };
  }
  
  // Step 2: Extract account name — try multiple methods
  // Method A: Parse snippet text for "Platform · AccountName" pattern (most reliable)
  let accountName = extractAccountFromText(snippet, domain);
  let extractionMethod = 'snippet';
  
  // Method B: Parse siteName field (extracted from DOM)
  if (!accountName) {
    accountName = extractSocialAccountName(siteName);
    extractionMethod = 'siteName';
  }
  
  // Method C: Parse title text for "Platform · AccountName" pattern
  if (!accountName) {
    accountName = extractAccountFromText(title, domain);
    extractionMethod = 'title';
  }
  
  if (accountName) {
    // Step 3: Compare account name against whitelist (case-insensitive)
    const accountLower = accountName.toLowerCase().trim();
    
    for (const whitelistAccount of whitelistCache) {
      if (accountLower === whitelistAccount) {
        return { match_status: 'safe', match_reason: `社媒账号命中白名单: ${accountName} (匹配: ${whitelistAccount})` };
      }
    }
    
    return { match_status: 'suspicious', match_reason: `五大社媒账号 [${accountName}] 未命中白名单 (来源:${extractionMethod})` };
  }
  
  // Step 4: Fallback - if no account name extracted from any source, search title+snippet+url
  const searchSpace = `${title} ${snippet} ${url}`.toLowerCase();
  
  let matchedWhitelistAccount = null;
  for (const account of whitelistCache) {
    const accLower = account.toLowerCase();
    if (searchSpace.includes(accLower)) {
      matchedWhitelistAccount = account;
      break;
    }
  }
  
  if (matchedWhitelistAccount) {
    return { match_status: 'safe', match_reason: `社媒域名，标题/摘要命中白名单账号: ${matchedWhitelistAccount}` };
  } else {
    return { match_status: 'suspicious', match_reason: `五大社媒网址，未能提取账号名且标题/摘要未命中白名单` };
  }
}

module.exports = {
  matchResult,
  loadWhitelist
};
