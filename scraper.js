const puppeteer = require('puppeteer-core');
const { createObjectCsvWriter } = require('csv-writer');
const fs = require('fs');
const path = require('path');

// ─── CONFIG ────────────────────────────────────────────────────────────────
// Where Chrome is installed. The usual locations are checked automatically;
// if yours is somewhere else, put its path here instead of null.
const CHROME_PATH_OVERRIDE = null;
const CHROME_CANDIDATES = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
};
const CHROME_PATH = CHROME_PATH_OVERRIDE ||
  (CHROME_CANDIDATES[process.platform] || []).find(p => fs.existsSync(p));

// Where Chrome keeps your WhatsApp Web login, so you only scan the QR code once.
const CHROME_PROFILE_DIR = path.join(__dirname, 'chrome-profile');

// Exact name of the WhatsApp channel to scrape (as shown in your chat list).
// You can also pass it when you run the script: node scraper.js "Polizei Berlin"
const CHANNEL_NAME = process.argv[2] || 'Polizei Berlin';

// Where results go. Each channel gets its own file, e.g. polizei_berlin_reactions.csv
const SLUG = CHANNEL_NAME.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '') || 'channel';
const OUTPUT_FILE = `./${SLUG}_reactions.csv`;
const IDS_FILE    = `./${SLUG}_scraped_ids.json`;
const SCROLL_PAUSE = 7000;   // ms to wait after each upward scroll (increase if posts are missed)
const CLICK_PAUSE  = 2500;   // ms to wait for the reaction panel to open
const NO_NEW_LIMIT = 15;     // consecutive empty scrolls before assuming start of history
// ───────────────────────────────────────────────────────────────────────────

const csvWriter = createObjectCsvWriter({
  path: OUTPUT_FILE,
  header: [
    { id: 'date',            title: 'date' },
    { id: 'time',            title: 'time' },
    { id: 'message',         title: 'message' },
    { id: 'total_reactions', title: 'total_reactions' },
    { id: 'quick_summary',   title: 'quick_summary' },
    { id: 'full_breakdown',  title: 'full_breakdown' },
  ],
  append: fs.existsSync(OUTPUT_FILE),
});

let scrapedIds = new Set();
if (fs.existsSync(IDS_FILE)) {
  JSON.parse(fs.readFileSync(IDS_FILE)).forEach(id => scrapedIds.add(id));
  console.log(`Resuming — ${scrapedIds.size} posts already done`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseAriaLabel(label) {
  if (!label) return { total: 0, summary: '' };
  const totalMatch = label.match(/(\d+)\s+in total/);
  const total = totalMatch ? parseInt(totalMatch[1]) : 0;
  const summary = label
    .replace('View reactions', '')
    .replace(/\d+ in total/, '')
    .replace('Reactions', '')
    .replace(/\./g, '')
    .trim();
  return { total, summary };
}

async function scrapeReactionPanel(page) {
  try {
    await page.waitForSelector('[data-testid="newsletter-reaction-details-pane"]', { timeout: 3000 });
    const rows = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="newsletter-reaction-details-pane"]');
      if (!pane) return [];
      const buttons = pane.querySelectorAll('[role="toolbar"] button');
      const results = [];
      buttons.forEach(btn => {
        const img = btn.querySelector('img');
        const spans = btn.querySelectorAll('span');
        let count = '';
        spans.forEach(s => {
          if (/^\d+$/.test(s.innerText?.trim())) count = s.innerText.trim();
        });
        if (img && img.alt && count) results.push(`${img.alt}:${count}`);
      });
      return results;
    });
    if (rows.length > 0) return rows.join('|');
    return '';
  } catch {
    return '';
  }
}

async function closePanel(page) {
  try { await page.keyboard.press('Escape'); await sleep(500); } catch {}
}

async function clickAndScrapeReactions(page, postId) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await sleep(300);

    // Scroll the post into view so it isn't virtualized away before we click
    await page.evaluate((id) => {
      const el = document.querySelector(`[data-id="${id}"]`);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' });
    }, postId);
    await sleep(400);

    const clicked = await page.evaluate((id) => {
      const el = document.querySelector(`[data-id="${id}"]`);
      const btn = el?.querySelector('[data-testid="reaction-bubble"]');
      if (btn) { btn.click(); return true; }
      return false;
    }, postId);

    if (!clicked) {
      console.log(`  Reaction button not found for post ${postId}`);
      return '';
    }

    await sleep(CLICK_PAUSE);
    const breakdown = await scrapeReactionPanel(page);

    if (breakdown) {
      await closePanel(page);
      await sleep(500);
      return breakdown;
    }

    console.log(`  Retrying reaction click (attempt ${attempt}/3)...`);
    await sleep(1000);
  }

  await closePanel(page);
  return '';
}

async function scrollUp(page) {
  const loadedEarlier = await page.evaluate(() => {
    const btn = document.querySelector('[title="Load earlier messages…"]');
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (loadedEarlier) {
    console.log('  Clicked "Load earlier messages" button');
    await sleep(3000);
  }

  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="conversation-panel-messages"]');
      if (panel) panel.scrollTop = 0;
    });
    await sleep(1500);
  }
  await sleep(SCROLL_PAUSE);
}

async function main() {
  if (!CHROME_PATH) {
    console.error('Could not find Chrome. Set CHROME_PATH_OVERRIDE at the top of scraper.js to where it is installed.');
    process.exit(1);
  }
  console.log('Launching Chrome...');
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: CHROME_PATH,
    args: [
      `--user-data-dir=${CHROME_PROFILE_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  console.log('Opening WhatsApp Web...');
  await page.goto('https://web.whatsapp.com/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-list"]', { timeout: 60000 });
  console.log('Loaded!');

  try {
    await page.waitForSelector(`[title="${CHANNEL_NAME}"]`, { timeout: 10000 });
    await page.click(`[title="${CHANNEL_NAME}"]`);
  } catch {
    console.log('Searching for channel...');
    const search = await page.$('[data-testid="chat-list-search"]') ||
                   await page.$('[data-testid="search"]');
    await search.click();
    await sleep(500);
    await page.keyboard.type(CHANNEL_NAME);
    await sleep(2000);
    await page.waitForSelector(`[title="${CHANNEL_NAME}"]`, { timeout: 10000 });
    await page.click(`[title="${CHANNEL_NAME}"]`);
  }

  await sleep(3000);
  console.log('Channel opened! Starting scrape...\n');

  let totalSaved = 0;
  let batch = [];
  let reachedStart = false;
  let scrolls = 0;
  let noNewCount = 0;

  while (!reachedStart) {
    scrolls++;

    const visible = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('[data-id]').forEach(el => {
        const virtEl = el.querySelector('[data-virtualized]');
        if (!virtEl || virtEl.getAttribute('data-virtualized') !== 'false') return;

        const id = el.getAttribute('data-id');
        const copyable = el.querySelector('[data-pre-plain-text]');
        const prePlain = copyable?.getAttribute('data-pre-plain-text') || '';
        const timeMatch = prePlain.match(/\[(.+?),\s*(.+?)\]/);
        const time = timeMatch ? timeMatch[1] : '';
        const date = timeMatch ? timeMatch[2].trim() : '';

        let message = '';

        // 1. Image alt (most channel posts are images with captions)
        el.querySelectorAll('img[alt]').forEach(img => {
          const alt = img.getAttribute('alt')?.trim();
          if (alt && alt.length > 10) message = alt;
        });

        // 2. Copyable text span
        if (!message) {
          const span = el.querySelector('.copyable-text span.selectable-text');
          message = span?.innerText?.trim() || '';
        }

        // 3. msg-text testid
        if (!message) {
          const msgText = el.querySelector('[data-testid="msg-text"]');
          message = msgText?.innerText?.trim() || '';
        }

        // 4. pre-plain-text element innerText
        if (!message) {
          const prePlainEl = el.querySelector('[data-pre-plain-text]');
          message = prePlainEl?.innerText?.trim() || '';
        }

        // Fallback timestamp selectors for video/document/poll post types
        let resolvedTime = time;
        let resolvedDate = date;
        if (!resolvedTime) {
          const metaEl = el.querySelector('[data-testid="msg-meta"] [data-testid="msg-time"], [data-pre-plain-text]');
          const plainText = metaEl?.getAttribute('data-pre-plain-text') || '';
          const m = plainText.match(/\[(.+?),\s*(.+?)\]/);
          if (m) { resolvedTime = m[1]; resolvedDate = m[2].trim(); }
        }
        if (!resolvedTime) {
          const timeEl = el.querySelector('[data-testid="msg-time"] span, .copyable-text span[dir]');
          resolvedTime = timeEl?.innerText?.trim() || '';
        }

        const reactionBtn = el.querySelector('[data-testid="reaction-bubble"]');
        const ariaLabel = reactionBtn?.getAttribute('aria-label') || null;

        results.push({ id, time: resolvedTime, date: resolvedDate, message, ariaLabel, hasReactions: !!reactionBtn });
      });
      return results;
    });

    // Mark system notification elements (no content) as seen so they don't re-appear
    visible
      .filter(p => p.id && !p.date && !p.time && !p.message && !p.hasReactions)
      .forEach(p => scrapedIds.add(p.id));

    const newPosts = visible.filter(p =>
      p.id &&
      !scrapedIds.has(p.id) &&
      (p.date || p.time || p.message || p.hasReactions)
    );
    console.log(`Scroll ${scrolls}: ${visible.length} loaded, ${newPosts.length} new`);

    if (newPosts.length === 0) {
      noNewCount++;
      console.log(`  (no new posts — ${noNewCount}/${NO_NEW_LIMIT} before stopping)`);
      if (noNewCount >= NO_NEW_LIMIT) {
        console.log('Reached the start of the channel history.');
        reachedStart = true;
        break;
      }
    } else {
      noNewCount = 0;
    }

    for (const post of newPosts) {
      scrapedIds.add(post.id);
      const { total, summary } = parseAriaLabel(post.ariaLabel);

      let fullBreakdown = '';
      if (post.hasReactions) {
        fullBreakdown = await clickAndScrapeReactions(page, post.id);
      }

      // Fall back to summing breakdown counts if aria-label regex missed the total
      let resolvedTotal = total;
      if (!resolvedTotal && fullBreakdown) {
        resolvedTotal = fullBreakdown.split('|').reduce((sum, part) => {
          const n = parseInt(part.split(':')[1] || '0', 10);
          return sum + (isNaN(n) ? 0 : n);
        }, 0);
      }

      batch.push({
        date: post.date,
        time: post.time,
        message: post.message.replace(/\n/g, ' ').substring(0, 500),
        total_reactions: resolvedTotal,
        quick_summary: summary,
        full_breakdown: fullBreakdown,
      });
      totalSaved++;

      if (batch.length >= 20) {
        await csvWriter.writeRecords(batch);
        fs.writeFileSync(IDS_FILE, JSON.stringify([...scrapedIds]));
        console.log(`  ✓ Saved ${totalSaved} posts total`);
        batch = [];
      }

      await sleep(400);
    }

    await scrollUp(page);
  }

  if (batch.length > 0) {
    await csvWriter.writeRecords(batch);
    fs.writeFileSync(IDS_FILE, JSON.stringify([...scrapedIds]));
  }

  console.log(`\n✅ Done! ${totalSaved} posts saved to ${OUTPUT_FILE}`);
  await browser.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
