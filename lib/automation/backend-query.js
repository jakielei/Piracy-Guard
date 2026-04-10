const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const path = require('path');

const BROWSER_DATA_DIR = path.join(process.cwd(), 'browser-data');
const BACKEND_URL = 'https://hwadmin.ikyuedu.com/glory-admin/content/';
const BACKEND_DOMAIN = 'hwadmin.ikyuedu.com';
const LOGIN_WAIT_TIMEOUT = 5 * 60 * 1000;
const LOGIN_POLL_INTERVAL = 2000;

// The iframe URL pattern for the 原始片库 page
const ORIGINAL_LIBRARY_PATH = '/glory-admin/content/shortPlay/new/index';

let browserContext = null;

async function getBrowserContext() {
  if (!browserContext) {
    browserContext = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
      headless: false,
      viewport: { width: 1400, height: 900 },
      args: ['--disable-blink-features=AutomationControlled'],
    });
  }
  return browserContext;
}

async function closeBrowser() {
  if (browserContext) {
    await browserContext.close();
    browserContext = null;
  }
}

/**
 * Find the content iframe that contains the 原始片库 search form.
 * The admin panel uses an iframe-based layout where menu clicks load content
 * into an iframe element.
 */
async function getContentFrame(page) {
  // Look for iframe in the page
  const frames = page.frames();
  for (const frame of frames) {
    const url = frame.url();
    if (url.includes(ORIGINAL_LIBRARY_PATH)) {
      console.log('[getContentFrame] Found content iframe:', url);
      return frame;
    }
  }

  // Try using frameLocator for iframes that might have a specific class/id
  // Common patterns: iframe.J_iframe, iframe#content-main, iframe[name="iframe0"]
  const iframeSelectors = [
    'iframe.J_iframe',
    'iframe[name*="iframe"]',
    'iframe[src*="shortPlay"]',
    '#content-main iframe',
    '.content-main iframe',
    'iframe',
  ];

  for (const selector of iframeSelectors) {
    try {
      const iframeCount = await page.locator(selector).count();
      for (let i = 0; i < iframeCount; i++) {
        const iframeElement = page.locator(selector).nth(i);
        const src = await iframeElement.getAttribute('src').catch(() => '');
        if (src && src.includes(ORIGINAL_LIBRARY_PATH)) {
          const contentFrame = page.frameLocator(selector).nth(i);
          console.log(`[getContentFrame] Found iframe via selector "${selector}", src: ${src}`);
          // Return a frame-like object that works with locators
          return { frameLocator: contentFrame, src };
        }
      }
    } catch (e) {
      // Continue to next selector
    }
  }

  return null;
}

/**
 * Navigate through sidebar menus and ensure we land on 原始片库 page.
 * After clicking, the content loads in an iframe.
 */
async function navigateToOriginalLibrary(page, onStatus) {
  if (onStatus) {
    onStatus({ type: 'navigating', message: '正在导航到原始片库...' });
  }

  // Step 1: Click "海外内容中台" to expand it
  try {
    const overseasMenu = page.locator('text=海外内容中台').first();
    if (await overseasMenu.isVisible().catch(() => false)) {
      await overseasMenu.click();
      await page.waitForTimeout(800);
    }
  } catch (e) {
    // Menu might already be expanded
  }

  // Step 2: Click "内容管理" to expand it
  try {
    const contentMenu = page.locator('text=内容管理').first();
    if (await contentMenu.isVisible().catch(() => false)) {
      await contentMenu.click();
      await page.waitForTimeout(800);
    }
  } catch (e) {
    // Menu might already be expanded
  }

  // Step 3: Click "原始片库"
  try {
    const originalLibrary = page.locator('a:has-text("原始片库"), span:has-text("原始片库")').first();
    if (await originalLibrary.isVisible().catch(() => false)) {
      await originalLibrary.click();
      await page.waitForTimeout(3000); // Wait for iframe to load
    }
  } catch (e) {
    console.error('Failed to click 原始片库:', e.message);
  }

  if (onStatus) {
    onStatus({ type: 'navigated', message: '✅ 已点击原始片库，等待加载...' });
  }
}

/**
 * Get a working frame for the 原始片库 content.
 * Returns a Playwright FrameLocator that can be used to interact with elements.
 */
async function getWorkingFrame(page) {
  // First try to find existing content frame
  const frames = page.frames();
  for (const frame of frames) {
    const url = frame.url();
    if (url.includes(ORIGINAL_LIBRARY_PATH)) {
      return frame;
    }
  }
  return null;
}

/**
 * Ensure we're logged in and on the backend page with the 原始片库 iframe loaded.
 * Returns the iframe Frame object for interacting with the search form.
 */
async function ensureOnBackendPage(page, onStatus) {
  // Check if we already have the right iframe loaded
  let frame = await getWorkingFrame(page);
  if (frame) {
    // Verify the frame has a search button
    const hasSearch = await frame.locator('button:has-text("搜索"), .btn-primary:has-text("搜索"), a:has-text("搜索")').first().isVisible().catch(() => false);
    if (hasSearch) {
      return frame;
    }
  }

  const currentUrl = page.url();

  // If not on the backend domain, navigate there
  if (!currentUrl.includes(BACKEND_DOMAIN)) {
    await page.goto(BACKEND_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);
  }

  const startTime = Date.now();

  while (Date.now() - startTime < LOGIN_WAIT_TIMEOUT) {
    const url = page.url();

    // Not on the backend domain — probably redirected to login page
    if (!url.includes(BACKEND_DOMAIN)) {
      if (onStatus) {
        onStatus({ type: 'login_required', message: '⚠️ 检测到未登录，请在弹出的浏览器窗口中完成登录。系统将自动等待...' });
      }
      await page.waitForTimeout(LOGIN_POLL_INTERVAL);
      continue;
    }

    // On the backend domain — check if iframe is already loaded
    frame = await getWorkingFrame(page);
    if (frame) {
      const hasSearch = await frame.locator('button:has-text("搜索"), .btn-primary:has-text("搜索"), a:has-text("搜索")').first().isVisible().catch(() => false);
      if (hasSearch) {
        if (onStatus) {
          onStatus({ type: 'login_success', message: '✅ 已进入原始片库，开始查询' });
        }
        return frame;
      }
    }

    // Check if sidebar is visible (we're logged in but need to navigate)
    const hasSidebar = await page.locator('text=海外内容中台').isVisible().catch(() => false);
    if (hasSidebar) {
      if (onStatus) {
        onStatus({ type: 'login_success', message: '✅ 登录成功，正在导航到原始片库...' });
      }
      await navigateToOriginalLibrary(page, onStatus);

      // After navigation, wait and check for the iframe
      for (let attempt = 0; attempt < 10; attempt++) {
        await page.waitForTimeout(1000);
        frame = await getWorkingFrame(page);
        if (frame) {
          const hasSearch = await frame.locator('button:has-text("搜索"), .btn-primary:has-text("搜索"), a:has-text("搜索")').first().isVisible().catch(() => false);
          if (hasSearch) {
            if (onStatus) {
              onStatus({ type: 'navigated', message: '✅ 已进入原始片库页面' });
            }
            return frame;
          }
        }
      }

      // If we still couldn't find it, try direct URL approach
      // Navigate the iframe directly by finding it and setting its src
      try {
        const iframeUrl = `https://${BACKEND_DOMAIN}${ORIGINAL_LIBRARY_PATH}`;
        console.log('[ensureOnBackendPage] Trying direct iframe URL:', iframeUrl);

        // Try navigating directly to the iframe URL
        const iframes = page.locator('iframe');
        const iframeCount = await iframes.count();
        if (iframeCount > 0) {
          // Get the iframe src to check
          for (let i = 0; i < iframeCount; i++) {
            const src = await iframes.nth(i).getAttribute('src').catch(() => '');
            console.log(`[ensureOnBackendPage] Found iframe ${i}: src="${src}"`);
          }
        }
      } catch (e) {
        console.error('[ensureOnBackendPage] Direct URL approach failed:', e.message);
      }
    }

    await page.waitForTimeout(LOGIN_POLL_INTERVAL);
  }

  throw new Error('LOGIN_WAIT_TIMEOUT');
}

async function queryBackendForDrama(dramaId, onStatus) {
  const context = await getBrowserContext();
  let page = context.pages()[0];
  if (!page) {
    page = await context.newPage();
  }

  // ensureOnBackendPage now returns the iframe Frame object
  const frame = await ensureOnBackendPage(page, onStatus);

  // Click "清空搜索" first to reset any previous search filters
  try {
    const clearBtn = frame.locator('button:has-text("清空搜索"), a:has-text("清空搜索"), .btn-warning').first();
    if (await clearBtn.isVisible().catch(() => false)) {
      await clearBtn.click();
      await page.waitForTimeout(1000);
    }
  } catch (e) {
    // No clear button found, continue
  }

  // Find and fill the 短剧ID input
  // The input is the first text input in the search form area, next to the "短剧ID" label
  const idInput = await findDramaIdInput(frame);
  await idInput.click({ clickCount: 3 }); // triple-click to select all
  await page.waitForTimeout(200);
  await idInput.fill(dramaId);
  await page.waitForTimeout(300);

  // Click the search button
  const searchBtn = frame.locator('button:has-text("搜索"), .btn-primary:has-text("搜索"), a:has-text("搜索")').first();
  await searchBtn.click();

  // Wait for results to load
  await page.waitForTimeout(3000);

  // Check for no results
  const noResults = await frame.locator('text=没有找到记录').isVisible().catch(() => false);
  const noResults2 = await frame.locator('text=显示 0 到 0').isVisible().catch(() => false);
  const emptyTable = await frame.locator('text=暂无数据').isVisible().catch(() => false);
  if (noResults || noResults2 || emptyTable) {
    return { found: false };
  }

  // Wait for table results
  const firstRow = frame.locator('table tbody tr').first();
  try {
    await firstRow.waitFor({ timeout: 10000 });
  } catch (e) {
    return { found: false };
  }

  const cells = firstRow.locator('td');
  const cellCount = await cells.count();

  console.log(`[Backend Query] Drama ${dramaId}: found ${cellCount} columns in result row`);

  let name = '';
  let chineseName = '';
  let cpName = '';
  let isSelfMade = null;

  // Column mapping based on table header:
  // 0:序号 1:短剧ID 2:短剧名称 3:原版短剧ID 4:短剧别名 5:语言 6:cp名称
  // 7:主角名称 8:上架状态 9:质量评级 10:首次收费集数 11:总集数 12:自制引入
  // 13:最新上架时间 14:版权状态 15:父子类型 16:备注 17:操作

  if (cellCount > 2) {
    name = await cells.nth(2).innerText().catch(() => '');
    name = name.trim();
  }
  if (cellCount > 4) {
    chineseName = await cells.nth(4).innerText().catch(() => '');
    chineseName = chineseName.trim();
  }
  if (cellCount > 6) {
    cpName = await cells.nth(6).innerText().catch(() => '');
    cpName = cpName.trim();
  }
  if (cellCount > 12) {
    const selfMadeText = await cells.nth(12).innerText().catch(() => '');
    isSelfMade = selfMadeText.trim() === '自制';
    console.log(`[Backend Query] Drama ${dramaId}: selfMade="${selfMadeText.trim()}", isSelfMade=${isSelfMade}`);
  }

  let contentType = null;

  if (isSelfMade) {
    try {
      const editBtn = firstRow.locator('a:has-text("编辑"), button:has-text("编辑")').first();
      await editBtn.click();
      await page.waitForTimeout(3000); // Wait for edit page to load in iframe

      // Wait for edit page to load in iframe. We retry a few times to handle slow network.
      let editFrame = null;
      console.log('[Content Type] Waiting for edit frame to load and show "标记"...');
      
      for (let attempt = 0; attempt < 8; attempt++) {
        const frames = page.frames();
        // Reverse iterate to prefer recently added frames
        for (let i = frames.length - 1; i >= 0; i--) {
          const f = frames[i];
          const url = f.url();
          if (url.includes(BACKEND_DOMAIN) && url !== page.url() && !url.includes('about:blank')) {
            // Check if this frame actually contains the "标记" tab
            const hasMark = await f.evaluate(() => {
              return document.body ? document.body.innerText.includes('标记') : false;
            }).catch(() => false);

            if (hasMark) {
              editFrame = f;
              break;
            }
          }
        }
        if (editFrame) break;
        await page.waitForTimeout(1000);
      }

      if (!editFrame) {
        // Fallback: use the original frame or just the last valid content frame
        editFrame = frame;
        console.log('[Content Type] Could not specifically identify edit frame containing "标记", trying fallback frame');
      } else {
        console.log('[Content Type] Found correct edit frame:', editFrame.url());
      }

      // Use Playwright to securely click the 标记 tab
      try {
        console.log('[Content Type] Attempting to click 标记 tab...');
        // Match exact text to avoid matching "已选标记" etc.
        const markTab = editFrame.getByText('标记', { exact: true }).first();
        await markTab.click({ force: true, timeout: 5000 });
        console.log('[Content Type] Successfully clicked 标记 tab');
        
        // Wait for the tab animation/network to render the inner checkboxes
        await page.waitForTimeout(2000);

        // Determine content type by inspecting the actual checkbox states
        contentType = await editFrame.evaluate(() => {
          let types = [];
          
          // Find every element that contains exactly our target texts
          const els = document.querySelectorAll('*');
          for (const el of els) {
             const exactText = (el.textContent || '').trim();
             // Only examine leaf-ish nodes
             if (el.children.length > 5) continue; 
             
             if (exactText === '国内翻译' || exactText === '海外原创' || exactText === '海外短剧自制' || exactText === '海外自制') {
                let isChecked = false;
                
                // 1. Check if the element or its immediate children have a standard checked input
                if (el.querySelector('input[type="checkbox"]:checked, input[type="radio"]:checked')) isChecked = true;
                if (el.tagName === 'INPUT' && el.checked) isChecked = true;
                
                // 2. Traverse up to 4 parents to find UI framework 'checked' classes
                let curr = el;
                for (let i = 0; i < 4; i++) {
                   if (!curr) break;
                   const className = typeof curr.className === 'string' ? curr.className : '';
                   if (className.includes('checked') || className.includes('is-checked') || className.includes('layui-form-checked') || className.includes('ant-checkbox-checked')) {
                       isChecked = true;
                       break;
                   }
                   curr = curr.parentElement;
                }
                
                // 3. Search children for 'checked' icons or classes
                if (!isChecked) {
                   if (el.querySelector('.is-checked, .checked, .layui-form-checked, .layui-icon-ok, .ant-checkbox-checked')) {
                       isChecked = true;
                   }
                }
                
                if (isChecked) {
                   if (exactText === '国内翻译') types.push('国内翻译');
                   if (exactText === '海外原创' || exactText === '海外短剧自制' || exactText === '海外自制') types.push('海外自制');
                }
             }
          }

          // Deduplicate and join
          const uniqueTypes = [...new Set(types)];
          return uniqueTypes.length > 0 ? uniqueTypes.join(',') : null;
        }).catch((err) => {
          console.error('[Content Type] Evaluate error:', err);
          return null;
        });

        console.log(`[Content Type] Drama ${dramaId}: extracted type = ${contentType}`);
      } catch (e) {
        console.error('[Content Type] Failed to find or click 标记 tab:', e.message);
      }

      // Go back to the search list.
      console.log('[Content Type] Closing edit popup / returning to list');
      
      // Safely attempt to close the layui modal popup if it exists
      const closeLayuiModal = async (context) => {
         await context.evaluate(() => {
            const closeBtns = document.querySelectorAll('.layui-layer-close, .close-tab');
            closeBtns.forEach(b => b.click());
            if (window.layer && window.layer.closeAll) window.layer.closeAll();
         }).catch(() => {});
      };

      await closeLayuiModal(page);
      await closeLayuiModal(frame);
      await page.waitForTimeout(1500);

      // Verify we're back on the search page with proper frame and form
      let recovered = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        const checkFrame = await getWorkingFrame(page);
        if (checkFrame) {
          const hasSearch = await checkFrame.locator('button:has-text("搜索"), .btn-primary:has-text("搜索"), a:has-text("搜索")').first().isVisible().catch(() => false);
          if (hasSearch) {
            recovered = true;
            console.log('[Content Type] Successfully verified search list is active');
            break;
          }
        }
        await page.waitForTimeout(1000);
      }

      // If closing layui modal didn't work (maybe it's a top-level tab), try sidebar click
      if (!recovered) {
        console.log('[Content Type] Modal close failed, trying to switch via sidebar menu');
        await navigateToOriginalLibrary(page, null);
        await page.waitForTimeout(2000);
      }
      
    } catch (e) {
      console.error('Error checking content type:', e.message);
      // Soft recover if possible, avoid page.goto
      await navigateToOriginalLibrary(page, null);
      for (let attempt = 0; attempt < 10; attempt++) {
        await page.waitForTimeout(1000);
        const newFrame = await getWorkingFrame(page);
        if (newFrame) break;
      }
    }
  }

  return {
    found: true,
    name,
    chineseName,
    cpName,
    isSelfMade,
    contentType,
  };
}

/**
 * Find the 短剧ID input field within the given frame.
 */
async function findDramaIdInput(frame) {
  // Strategy 1: Use evaluate to find input near "短剧ID" text in the frame DOM
  try {
    const inputHandle = await frame.evaluateHandle(() => {
      // Find elements containing "短剧ID" text
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        const directText = Array.from(el.childNodes)
          .filter(n => n.nodeType === Node.TEXT_NODE)
          .map(n => n.textContent.trim())
          .join('');

        if (directText.includes('短剧ID')) {
          // Look for input in same container
          const parent = el.parentElement;
          if (parent) {
            const input = parent.querySelector('input');
            if (input) return input;
            const next = el.nextElementSibling;
            if (next && next.tagName === 'INPUT') return next;
            if (next) {
              const sibInput = next.querySelector('input');
              if (sibInput) return sibInput;
            }
          }
          const grandParent = el.parentElement?.parentElement;
          if (grandParent) {
            const input = grandParent.querySelector('input');
            if (input) return input;
          }
        }
      }

      // Fallback: first visible text input in the page (should be 短剧ID)
      const inputs = document.querySelectorAll('input');
      for (const input of inputs) {
        const type = input.type || 'text';
        if (['text', 'search', 'number', ''].includes(type)) {
          const rect = input.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return input;
          }
        }
      }
      return null;
    });

    if (inputHandle) {
      const element = inputHandle.asElement();
      if (element) {
        console.log('[findDramaIdInput] Found input via evaluate');
        return element;
      }
    }
  } catch (e) {
    console.error('[findDramaIdInput] evaluate strategy failed:', e.message);
  }

  // Strategy 2: Use Playwright locators on the frame
  try {
    const firstInput = frame.locator('input[type="text"], input:not([type])').first();
    if (await firstInput.isVisible().catch(() => false)) {
      console.log('[findDramaIdInput] Found input via locator fallback');
      return firstInput;
    }
  } catch (e) {
    console.error('[findDramaIdInput] locator strategy failed:', e.message);
  }

  throw new Error('Cannot find 短剧ID input field');
}

module.exports = {
  getBrowserContext,
  closeBrowser,
  queryBackendForDrama,
};
