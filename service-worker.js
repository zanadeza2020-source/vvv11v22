/**
 * MedTerm v6 - Service Worker
 * يدعم: العمل بدون إنترنت + كشف التحديثات + تتبع تحميل قاعدة البيانات
 */

const APP_VERSION = "6.1.0";
const CACHE_NAME  = `medterm-v${APP_VERSION}`;

// كل ملفات التطبيق التي يجب تخزينها مؤقتاً
const CHAPTER_COUNT = 28;
const chapterFiles  = Array.from({ length: CHAPTER_COUNT }, (_, i) => `./database/chapter${i + 1}.json`);

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

const ALL_ASSETS = [...CORE_ASSETS, ...chapterFiles];

// ──────────────────────────────────────────────
//  INSTALL  →  تخزين كل الملفات (مع تتبع التقدم)
// ──────────────────────────────────────────────
self.addEventListener("install", (event) => {
  console.log(`[SW] Installing MedTerm ${APP_VERSION}`);

  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // 1. تخزين الملفات الأساسية أولاً
      await cache.addAll(CORE_ASSETS).catch(err =>
        console.warn("[SW] Core assets error:", err)
      );

      // تخزين الفصول واحداً واحداً مع إرسال تقدم للعميل
      let loaded = 0;
      await Promise.allSettled(
        chapterFiles.map(async (path) => {
          try {
            const res = await fetch(path, { cache: "no-cache" });
            if (res.ok) await cache.put(path, res);
          } catch (_) {}
          loaded++;
          // إرسال نسبة التحميل لكل النوافذ المفتوحة
          const pct = Math.round((loaded / CHAPTER_COUNT) * 100);
          self.clients.matchAll().then(clients =>
            clients.forEach(c => c.postMessage({ type: "CACHE_PROGRESS", loaded, total: CHAPTER_COUNT, pct }))
          );
        })
      );

      console.log(`[SW] All assets cached (${CHAPTER_COUNT} chapters)`);
      // إخبار العميل باكتمال التخزين
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: "CACHE_COMPLETE", version: APP_VERSION }))
      );
    })()
  );

  // لا نستخدم skipWaiting() هنا — نتركه للمستخدم يقرر عبر زر "تحديث الآن"
});

// ──────────────────────────────────────────────
//  ACTIVATE  →  حذف الكاشات القديمة + إشعار تحديث
// ──────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  console.log(`[SW] Activated MedTerm ${APP_VERSION}`);

  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => {
            console.log(`[SW] Deleting old cache: ${k}`);
            return caches.delete(k);
          })
      );
      await self.clients.claim();

      // إخبار العملاء بوجود تحديث جديد — المستخدم يختار متى يطبقه
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: "UPDATE_AVAILABLE", version: APP_VERSION }))
      );
    })()
  );
});

// ──────────────────────────────────────────────
//  FETCH  →  Cache-First للبيانات، Network-First للـ HTML
// ──────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // تجاهل طلبات غير HTTP (chrome-extension وغيرها)
  if (!url.protocol.startsWith("http")) return;

  // ── قواعد بيانات الفصول: Cache-First (offline دائماً) ──
  if (url.pathname.includes("/database/")) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, clone));
          }
          return res;
        }).catch(() => new Response(JSON.stringify({ terms: [] }), {
          headers: { "Content-Type": "application/json" }
        }));
      })
    );
    return;
  }

  // ── HTML والـ Manifest: Network-First مع Fallback ──
  if (req.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname.endsWith(".webmanifest")) {
    event.respondWith(
      fetch(req).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone));
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // ── كل شيء آخر: Cache-First ──
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone));
        }
        return res;
      }).catch(() => new Response("", { status: 503 }));
    })
  );
});

// ──────────────────────────────────────────────
//  MESSAGE  →  استقبال رسائل من الصفحة
// ──────────────────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "CHECK_VERSION") {
    event.source.postMessage({ type: "VERSION_INFO", version: APP_VERSION });
  }
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
