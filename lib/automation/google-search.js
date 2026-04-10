const { getBrowserContext } = require('./backend-query');

/**
 * Search Google for a drama name and collect results from the first 5 pages
 * @param {string} query - The drama name to search
 * @param {Function} onProgress - Callback for progress updates
 * @returns {Array} Array of { url, title, snippet, pageNumber }
 */
async function searchGoogle(query, onProgress) {
  const context = await getBrowserContext();
  const page = await context.newPage();
  const allResults = [];

  try {
    // Navigate to Google
    await page.goto('https://www.google.com', { waitUntil: 'networkidle', timeout: 30000 });

    // Accept cookies if dialog appears
    const acceptBtn = page.locator('button:has-text("Accept all"), button:has-text("接受全部")');
    if (await acceptBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await acceptBtn.click();
      await page.waitForTimeout(1000);
    }

    // Type search query
    const searchInput = page.locator('input[name="q"], textarea[name="q"]').first();
    await searchInput.click();
    await searchInput.fill(query);
    await searchInput.press('Enter');

    // Wait for results to load
    await page.waitForSelector('#search', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Check for CAPTCHA
    if (await isCaptchaPresent(page)) {
      if (onProgress) onProgress({ type: 'captcha', message: '请在浏览器中完成验证码' });
      // Wait for user to solve CAPTCHA (up to 2 minutes)
      await waitForCaptchaResolution(page, 120000);
    }

    // Collect results from up to 5 pages
    for (let pageNum = 1; pageNum <= 5; pageNum++) {
      if (onProgress) onProgress({ type: 'page', page: pageNum });

      const results = await extractSearchResults(page, pageNum);
      allResults.push(...results);

      if (pageNum < 5) {
        // Try to go to next page
        const nextButton = page.locator('a#pnnext, a[aria-label="Next"], a:has-text("Next"), a:has-text("下一页")').first();
        const hasNext = await nextButton.isVisible({ timeout: 3000 }).catch(() => false);

        if (!hasNext) {
          if (onProgress) onProgress({ type: 'info', message: `仅有 ${pageNum} 页结果` });
          break;
        }

        // Added slightly more delay with human-like variability to assist stealth plugin
        const delay = 1500 + Math.random() * 1000;
        await page.waitForTimeout(delay);

        await nextButton.click();
        // Wait briefly for the next page to start loading
        await page.waitForTimeout(1500);

        // Check for CAPTCHA again
        if (await isCaptchaPresent(page)) {
          if (onProgress) onProgress({ type: 'captcha', message: '请在浏览器中完成验证码' });
          await waitForCaptchaResolution(page, 120000);
        }
      }
    }
  } catch (error) {
    console.error('Google search error:', error.message);
    if (onProgress) onProgress({ type: 'error', message: error.message });
  } finally {
    await page.close();
  }

  return allResults;
}

async function extractSearchResults(page, pageNumber) {
  const results = [];

  try {
    // Scroll down with random amounts to ensure dynamic results load
    for (let s = 0; s < 3; s++) {
      await page.evaluate((amount) => window.scrollBy(0, amount), 400 + Math.random() * 600);
      await page.waitForTimeout(300 + Math.random() * 200);
    }
    
    // Use evaluate to extract results directly from the DOM, which is more robust
    // against layout changes than relying solely on locators
    const extractedResults = await page.evaluate((pageNum) => {
      const pageResults = [];
      const seenUrls = new Set();
      
      // Look for standard search results, video results, and rich snippets
      const searchBlocks = document.querySelectorAll('div.g, div[data-sokoban-container], div[jscontroller][data-ved], video, iframe');
      
      // Fallback: look for all links that might be search results
      const allLinks = document.querySelectorAll('a[href^="http"]');
      const containerCandidates = new Set();
      
      for (const link of allLinks) {
        // Exclude Google's own links (search, maps, policies, etc.)
        const url = link.href;
        if (url.includes('google.com') || url.includes('google.cn')) continue;
        
        // Find a suitable container for the link (usually a div that holds title + snippet)
        let container = link.parentElement;
        while (container && container.tagName !== 'DIV' && container.tagName !== 'LI') {
          container = container.parentElement;
          if (container === document.body) break; // Reached too high
        }
        
        if (container && container !== document.body) {
          containerCandidates.add({ link, container, url });
        }
      }
      
      // Process found containers
      for (const { link, container, url } of containerCandidates) {
        if (seenUrls.has(url)) continue;
        
        // Try to find title near the link (often an h3 or inside the link itself)
        let title = '';
        const h3 = container.querySelector('h3');
        if (h3) {
          title = h3.innerText.trim();
        } else {
          // Sometimes the title is a span inside the link with a specific class or just the link text
          title = link.innerText.trim();
          
          // Clean up multiline link texts (often happens with rich results)
          if (title.includes('\\n')) {
             title = title.split('\\n')[0].trim();
          }
        }
        
        // Try to find a snippet
        let snippet = '';
        // Snippets are usually in sibling divs or span, often multi-line
        const textElements = container.querySelectorAll('div, span');
        for (const el of textElements) {
           const text = el.innerText.trim();
           // A good snippet is usually a decently long text block that is not the title
           if (text.length > 20 && text !== title && !title.includes(text) && !text.includes('Translate this page')) {
               snippet = text;
               break; // Found a likely snippet
           }
        }
        
        if (title && url) {
            seenUrls.add(url);
            pageResults.push({
                url,
                title,
                snippet,
                pageNumber: pageNum
            });
        }
      }
      return pageResults;
    }, pageNumber);
    
    // Map them back and filter out bad URLs
    for(const res of extractedResults) {
        // Basic filtering to ensure we don't grab garbage links
        if(res.url && res.title && res.url.startsWith('http') && !res.url.includes('google.com')) {
           results.push(res);
        }
    }
    
    console.log(`[Google Search] Extracted ${results.length} results from page ${pageNumber}`);

  } catch (e) {
    console.error(`[Google Search] Error extracting results on page ${pageNumber}:`, e);
  }

  return results;
}

async function isCaptchaPresent(page) {
  const captchaIndicators = [
    'iframe[src*="recaptcha"]',
    '#captcha-form',
    'text=unusual traffic',
    'text=异常流量',
  ];

  for (const selector of captchaIndicators) {
    if (await page.locator(selector).isVisible({ timeout: 1000 }).catch(() => false)) {
      return true;
    }
  }
  return false;
}

async function waitForCaptchaResolution(page, timeout) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    await page.waitForTimeout(3000);
    if (!(await isCaptchaPresent(page))) {
      return true;
    }
  }
  throw new Error('CAPTCHA timeout - user did not solve within time limit');
}

module.exports = {
  searchGoogle,
};
