// ================================================================
// ASTUBE - App Functions
// ================================================================

// ── Page Navigation Loader ───────────────────────────────────────
(function() {
  // Inject loader bar + overlay into every page
  const loader  = document.createElement('div'); loader.id  = 'nav-loader';
  const overlay = document.createElement('div'); overlay.id = 'page-overlay';
  document.body.appendChild(loader);
  document.body.appendChild(overlay);

  // Show loader on any link/button navigation
  function showLoader() {
    loader.classList.add('active');
    overlay.classList.add('show');
  }
  function hideLoader() {
    loader.classList.remove('active');
    loader.classList.add('done');
    overlay.classList.remove('show');
    setTimeout(() => loader.classList.remove('done'), 400);
  }

  // Intercept all <a> clicks that go to another page
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript') ||
        href.startsWith('mailto') || a.target === '_blank') return;
    showLoader();
  });

  // Intercept location.href assignments via patched setter
  const _origAssign = window.location.assign.bind(window.location);
  // Show loader when page starts unloading
  window.addEventListener('beforeunload', showLoader);

  // Hide loader when page is fully loaded
  window.addEventListener('load', hideLoader);
  // Also hide on pageshow (back/forward cache)
  window.addEventListener('pageshow', hideLoader);
})();

// ── Videos ──────────────────────────────────────────────────────

async function loadAllVideos() {
  try {
    const snap = await db.ref('videos').once('value');
    if (!snap.exists()) return [];
    const raw = snap.val();
    const arr = Object.entries(raw)
      .filter(([, v]) => v && typeof v === 'object')
      .map(([id, v]) => ({ id, ...v }));
    arr.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    return arr;
  } catch(e) { console.error('[ASTUBE] loadAllVideos error:', e); return []; }
}

async function getVideo(id) {
  try {
    const snap = await db.ref(`videos/${id}`).once('value');
    return snap.exists() ? { id, ...snap.val() } : null;
  } catch(e) { return null; }
}

async function incrementViews(id) {
  try { await db.ref(`videos/${id}/views`).transaction(v => (v || 0) + 1); } catch(e) {}
}

// ── History ──────────────────────────────────────────────────────

async function addToHistory(videoId) {
  const user = auth.currentUser;
  if (!user) return;
  try { await db.ref(`users/${user.uid}/history/${videoId}`).set(Date.now()); } catch(e) {}
}

async function getUserHistory(uid) {
  try {
    const snap = await db.ref(`users/${uid}/history`).orderByValue().once('value');
    if (!snap.exists()) return [];
    const arr = [];
    snap.forEach(c => arr.push({ videoId: c.key, watchedAt: c.val() }));
    return arr.reverse();
  } catch(e) { return []; }
}

async function removeFromHistory(videoId) {
  const user = auth.currentUser;
  if (!user) return;
  try { await db.ref(`users/${user.uid}/history/${videoId}`).remove(); } catch(e) {}
}

async function clearHistory() {
  const user = auth.currentUser;
  if (!user) return;
  try { await db.ref(`users/${user.uid}/history`).remove(); } catch(e) {}
}

// ── Users ────────────────────────────────────────────────────────

// Get full user record from DB
async function getUserData(uid) {
  try {
    const snap = await db.ref(`users/${uid}`).once('value');
    return snap.exists() ? snap.val() : null;
  } catch(e) { return null; }
}

// Called on every login/signup.
// IMPORTANT: never overwrites photoUrl — that is managed only by profile page.
async function createUserRecord(user) {
  try {
    const snap = await db.ref(`users/${user.uid}`).once('value');
    if (!snap.exists()) {
      // Brand new user — seed record
      await db.ref(`users/${user.uid}`).set({
        name:      user.displayName || 'ASTUBEr',
        email:     user.email       || '',
        photoUrl:  user.photoURL    || '',   // seeded from Google on first login; user can change later
        createdAt: Date.now()
      });
    }
    // Existing user — do NOT touch photoUrl (user may have set a custom one)
    // We also don't overwrite name so custom names survive re-login
  } catch(e) { console.error('createUserRecord error:', e); }
}

// ── Backend calls ─────────────────────────────────────────────────

// Frontend URL cache — avoids repeat backend calls for same video in same session
function _feCacheKey(ytId, itag) { return `astube_url_${ytId}_${itag}`; }
function _feGetUrl(ytId, itag) {
  try {
    const raw = sessionStorage.getItem(_feCacheKey(ytId, itag));
    if (!raw) return null;
    const { url, ts } = JSON.parse(raw);
    if (Date.now() - ts > 3 * 60 * 60 * 1000) { // 3h TTL
      sessionStorage.removeItem(_feCacheKey(ytId, itag)); return null;
    }
    return url;
  } catch(e) { return null; }
}
function _feSetUrl(ytId, itag, url) {
  try { sessionStorage.setItem(_feCacheKey(ytId, itag), JSON.stringify({ url, ts: Date.now() })); } catch(e) {}
}

async function getVideoUrl(ytId, itag = '18') {
  if (!window.BACKEND_URL) throw new Error('Backend offline');

  // 1. Frontend cache — instant, zero network
  const cached = _feGetUrl(ytId, itag);
  if (cached) return { url: cached, cached: true, ytId, itag };

  // 2. Backend call
  const res = await fetch(`${window.BACKEND_URL}/get-url?ytId=${ytId}&itag=${itag}`);
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || 'Failed to get video URL');
  }
  const data = await res.json();
  if (data.url) _feSetUrl(ytId, itag, data.url);
  return data;
}

async function getVideoFormats(ytId) {
  if (!window.BACKEND_URL) throw new Error('Backend offline');
  const res = await fetch(`${window.BACKEND_URL}/get-formats?ytId=${ytId}`);
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || 'Failed to get formats');
  }
  return res.json();
}

async function getVideoInfo(ytId) {
  if (!window.BACKEND_URL) throw new Error('Backend offline');
  const res = await fetch(`${window.BACKEND_URL}/get-info?ytId=${ytId}`);
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || 'Failed to get video info');
  }
  return res.json();
}

// ── Likes ────────────────────────────────────────────────────────

async function getLikeCount(videoId) {
  try {
    const snap = await db.ref(`likes/${videoId}`).once('value');
    return snap.exists() ? Object.keys(snap.val()).length : 0;
  } catch(e) { return 0; }
}

async function hasLiked(videoId, uid) {
  try {
    const snap = await db.ref(`likes/${videoId}/${uid}`).once('value');
    return snap.exists();
  } catch(e) { return false; }
}

// Returns { nowLiked, newCount } in one operation
async function toggleLike(videoId, uid) {
  const liked = await hasLiked(videoId, uid);
  if (liked) {
    await db.ref(`likes/${videoId}/${uid}`).remove();
  } else {
    await db.ref(`likes/${videoId}/${uid}`).set(Date.now());
  }
  // Read fresh count after write
  const snap = await db.ref(`likes/${videoId}`).once('value');
  return { nowLiked: !liked, newCount: snap.numChildren() };
}

// Get all like counts for a list of video ids in parallel
async function getBatchLikeCounts(videoIds) {
  const results = {};
  await Promise.all(videoIds.map(async id => {
    results[id] = await getLikeCount(id);
  }));
  return results;
}
