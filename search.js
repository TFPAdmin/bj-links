// --- /search.js ---
(() => {
  // Use a proper manifest file that lists your crawl seeds.
  const PAGES_MANIFEST = '/pages.json';
  const MAX_PAGES = 30;
  const MAX_RESULTS = 20;

  const qInput  = document.getElementById('siteSearchInput');
  const results = document.getElementById('siteSearchResults');

  if (!qInput || !results) return;

  let index = [];   // { text, href, page, section }
  let built = false;

  const sameOrigin = (url) => {
    try { return new URL(url, location.origin).origin === location.origin; }
    catch { return false; }
  };

  async function fetchText(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`Fetch failed: ${url}`);
    return await res.text();
  }

  function dedupe(arr, keyFn) {
    const seen = new Set();
    return arr.filter(item => {
      const k = keyFn(item);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function parseLinks(html, pageUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Items to index (visible links in your grids)
    const linkBlocks = [...doc.querySelectorAll('.link-grid a')];

    const sectionTitleOf = (el) => {
      const sec = el.closest('section');
      if (!sec) return null;
      const h = sec.querySelector('h2,h3');
      return h ? h.textContent.trim() : null;
    };

    const items = linkBlocks.map(a => {
      const href = new URL(a.getAttribute('href'), pageUrl).href;
      const text = (a.textContent || '').trim();
      const section = sectionTitleOf(a);
      return { text, href, section, page: pageUrl };
    });

    // Discover internal pages to crawl
    const discover = [...doc.querySelectorAll('a[href]')]
      .map(a => a.getAttribute('href'))
      .filter(Boolean)
      .map(h => new URL(h, pageUrl).href)
      .filter(u => sameOrigin(u))
      .filter(u => {
        const p = new URL(u).pathname;
        return p === '/' || /\.(?:html?)$/.test(p);
      });

    return { items, discover };
  }

  async function buildIndex() {
    if (built) return;

    // Seeds from manifest, with sensible fallbacks
    let seeds = [];
    try {
      const list = await fetchText(PAGES_MANIFEST).then(JSON.parse);
      seeds = Array.isArray(list) && list.length ? list : [location.pathname];
    } catch {
      seeds = [location.pathname];
    }
    // Ensure absolute, deduped
    seeds = dedupe(seeds.map(u => new URL(u, location.origin).href), u => u);

    const toVisit = [...seeds];
    const visited = new Set();

    while (toVisit.length && visited.size < MAX_PAGES) {
      const url = toVisit.shift();
      if (visited.has(url)) continue;
      visited.add(url);

      try {
        const html = await fetchText(url);
        const { items, discover } = parseLinks(html, url);
        index.push(...items);
        discover.forEach(u => {
          if (!visited.has(u) && !toVisit.includes(u)) toVisit.push(u);
        });
      } catch (e) {
        console.warn('Search crawl error:', e.message);
      }
    }

    index = dedupe(index, i => `${i.href}::${i.text}::${i.section || ''}`);
    built = true;
  }

  function normalize(s) {
    return (s || '').toLowerCase().normalize('NFKD')
      .replace(/[^\w\s:/.-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function scoreItem(item, q) {
    const t = normalize(item.text);
    const s = normalize(item.section || '');
    let score = 0;
    if (t.includes(q)) score += 5;
    if (s.includes(q)) score += 2;
    if (t.startsWith(q)) score += 3;
    if (t === q) score += 4;
    return score;
  }

  function search(qRaw) {
    const q = normalize(qRaw);
    if (!q) return [];
    return index
      .map(it => ({ it, score: scoreItem(it, q) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
      .map(x => x.it);
  }

  function renderResults(items) {
    if (!items.length) {
      results.innerHTML = `<div style="padding:.6rem .75rem;opacity:.7;">No matches</div>`;
      results.hidden = false;
      return;
    }
    const html = items.map(it => {
      const url = new URL(it.href);
      const section = it.section
        ? `<span class="result-section">${it.section} • ${url.pathname}</span>`
        : `<span class="result-section">${url.pathname}</span>`;
      return `<a href="${it.href}" target="_blank" rel="noopener">
                <strong>${it.text}</strong><br/>${section}
              </a>`;
    }).join('');
    results.innerHTML = html;
    results.hidden = false;
  }

  // Build on first focus and also prebuild after load (helps on mobile)
  qInput.addEventListener('focus', buildIndex);
  window.addEventListener('DOMContentLoaded', buildIndex);

  // Live results
  qInput.addEventListener('input', () => {
    const q = qInput.value;
    if (!q.trim()) { results.hidden = true; results.innerHTML = ''; return; }
    renderResults(search(q));
  });

  // Enter = open top result
  qInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const items = search(qInput.value);
      if (items.length) {
        window.open(items[0].href, '_blank', 'noopener,noreferrer');
        results.hidden = true;
      }
    }
  });

  // Click-away hides results
  document.addEventListener('click', (e) => {
    if (!results.contains(e.target) && e.target !== qInput) {
      results.hidden = true;
    }
  });
})();
