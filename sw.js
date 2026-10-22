// オフライン用。ファイルを更新したら VERSION の数字を上げる。
// 通信できるときは常に最新を取りにいき、できないときだけ保存分を使う（更新が反映されやすい）。
const VERSION = "v30";
const CACHE = "tekisei-" + VERSION;
const FILES = ["./", "index.html", "problems.js", "buddy.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"].concat(["c_balance_1.webp", "c_balance_1_happy.webp", "c_balance_1_sleep.webp", "c_balance_2.webp", "c_balance_2_happy.webp", "c_balance_2_sleep.webp", "c_balance_3.webp", "c_balance_3_happy.webp", "c_balance_3_sleep.webp", "c_dad.webp","reward_papa.webp","boss_1.webp","boss_2.webp","boss_3.webp","boss_4.webp","c_gp.webp","c_gp_cut.webp","c_mama.webp","c_mama_cut.webp","skill_math.webp","skill_science.webp","skill_japanese.webp","skill_society.webp","skill_math_science.webp","fx_fight.webp","bgm_battle.mp3", "c_japanese_1.webp", "c_japanese_1_happy.webp", "c_japanese_1_sleep.webp", "c_japanese_2.webp", "c_japanese_2_happy.webp", "c_japanese_2_sleep.webp", "c_japanese_3.webp", "c_japanese_3_happy.webp", "c_japanese_3_sleep.webp", "c_japanese_society_1.webp", "c_japanese_society_1_happy.webp", "c_japanese_society_1_sleep.webp", "c_japanese_society_2.webp", "c_japanese_society_2_happy.webp", "c_japanese_society_2_sleep.webp", "c_japanese_society_3.webp", "c_japanese_society_3_happy.webp", "c_japanese_society_3_sleep.webp", "c_math_1.webp", "c_math_1_happy.webp", "c_math_1_sleep.webp", "c_math_2.webp", "c_math_2_happy.webp", "c_math_2_sleep.webp", "c_math_3.webp", "c_math_3_happy.webp", "c_math_3_sleep.webp", "c_math_japanese_1.webp", "c_math_japanese_1_happy.webp", "c_math_japanese_1_sleep.webp", "c_math_japanese_2.webp", "c_math_japanese_2_happy.webp", "c_math_japanese_2_sleep.webp", "c_math_japanese_3.webp", "c_math_japanese_3_happy.webp", "c_math_japanese_3_sleep.webp", "c_math_science_1.webp", "c_math_science_1_happy.webp", "c_math_science_1_sleep.webp", "c_math_science_2.webp", "c_math_science_2_happy.webp", "c_math_science_2_sleep.webp", "c_math_science_3.webp", "c_math_science_3_happy.webp", "c_math_science_3_sleep.webp", "c_math_society_1.webp", "c_math_society_1_happy.webp", "c_math_society_1_sleep.webp", "c_math_society_2.webp", "c_math_society_2_happy.webp", "c_math_society_2_sleep.webp", "c_math_society_3.webp", "c_math_society_3_happy.webp", "c_math_society_3_sleep.webp", "c_science_1.webp", "c_science_1_happy.webp", "c_science_1_sleep.webp", "c_science_2.webp", "c_science_2_happy.webp", "c_science_2_sleep.webp", "c_science_3.webp", "c_science_3_happy.webp", "c_science_3_sleep.webp", "c_science_japanese_1.webp", "c_science_japanese_1_happy.webp", "c_science_japanese_1_sleep.webp", "c_science_japanese_2.webp", "c_science_japanese_2_happy.webp", "c_science_japanese_2_sleep.webp", "c_science_japanese_3.webp", "c_science_japanese_3_happy.webp", "c_science_japanese_3_sleep.webp", "c_science_society_1.webp", "c_science_society_1_happy.webp", "c_science_society_1_sleep.webp", "c_science_society_2.webp", "c_science_society_2_happy.webp", "c_science_society_2_sleep.webp", "c_science_society_3.webp", "c_science_society_3_happy.webp", "c_science_society_3_sleep.webp", "c_society_1.webp", "c_society_1_happy.webp", "c_society_1_sleep.webp", "c_society_2.webp", "c_society_2_happy.webp", "c_society_2_sleep.webp", "c_society_3.webp", "c_society_3_happy.webp", "c_society_3_sleep.webp"]);

const FILES2 = ["bg_god.webp", "boss_5.webp", "boss_6.webp", "boss_7.webp", "bgm_god.mp3", "c_math_3_nb.webp", "c_science_3_nb.webp", "c_japanese_3_nb.webp", "c_society_3_nb.webp", "c_math_japanese_3_nb.webp", "c_math_society_3_nb.webp", "c_science_japanese_3_nb.webp", "c_science_society_3_nb.webp", "c_japanese_society_3_nb.webp", "c_balance_3_nb.webp", "skill_math_japanese.webp", "skill_math_society.webp", "skill_science_japanese.webp", "skill_science_society.webp", "skill_japanese_society.webp", "skill_balance.webp"];
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(FILES.concat(FILES2).map(f => fetch(new Request(f, { cache: "reload" })).then(r => { if (r.ok) return c.put(f, r); }))))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (e.request.headers.has("range")) return;   // 音声（BGM）の分割リクエストは、ブラウザにそのまま任せる（iPadで鳴らない問題の対策）
  e.respondWith(
    fetch(e.request, { cache: "no-cache" }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match("index.html")))
  );
});
