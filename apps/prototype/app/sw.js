// X Struc offline worker (backlog #34). Keeps this version of the page, its icons and the pinned three.js /
// OrbitControls copies, so the installed app opens with no signal on site. scripts/build-app.js writes the version and
// the file list between the BUILD markers; each deploy is a new version, which the page offers as "Reload" once it is
// downloaded (it never swaps the page under someone mid-job).
"use strict";
const BUILD = /*BUILD*/{ "version": "dev", "precache": ["./", "manifest.webmanifest"] }/*BUILD*/;
const CACHE = "xstruc-" + BUILD.version;
const FONTS = "xstruc-fonts";   // Google Fonts: kept across versions, refreshed in the background
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => {
  // all or nothing: if one file will not download the old version stays in charge and the next visit tries again
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(BUILD.precache.map(u => c.add(new Request(u, { cache: "reload" }))))));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.indexOf("xstruc-") === 0 && k !== CACHE && k !== FONTS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// the page asks for this when the user presses Reload on the "new version" bar
self.addEventListener("message", e => { if (e.data && e.data.type === "skip-waiting") self.skipWaiting(); });

const scopePath = () => new URL(self.registration.scope).pathname;

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // the app page itself (any ?panel / ?site / #site): this version's copy, the network only if the copy is missing
  if (req.mode === "navigate" && url.origin === location.origin && (url.pathname === scopePath() || url.pathname === scopePath() + "index.html")) {
    e.respondWith(caches.open(CACHE).then(c => c.match("./")).then(hit => hit || fetch(req)));
    return;
  }

  // fonts: whatever is kept now, refreshed for next time; offline with none kept, an empty stylesheet so the page
  // quietly uses its fallback fonts instead of logging a failed download
  if (FONT_HOSTS.indexOf(url.hostname) >= 0) {
    e.respondWith(caches.open(FONTS).then(c => c.match(req).then(hit => {
      const net = fetch(req).then(res => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; });
      if (hit) { e.waitUntil(net.catch(() => null)); return hit; }
      return net.catch(() => url.hostname === "fonts.googleapis.com" ? new Response("", { headers: { "Content-Type": "text/css" } }) : Response.error());
    })));
    return;
  }

  // three.js, OrbitControls, the manifest and icons: from this version's cache (Vary ignored: the CDN copies were
  // fetched by the worker, the page asks for them as plain <script> tags)
  e.respondWith(caches.open(CACHE).then(c => c.match(req, { ignoreVary: true })).then(hit => hit || fetch(req)));
});
