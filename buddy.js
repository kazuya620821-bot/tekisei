// ルミン（育成キャラ）機能 v2。設定値は BUDDY_CFG にまとめてある（あとから調整できる）。
// タマゴ → 経験値100でかえる（4科目の経験値の割合で型が決まる）→ 成体 → 究極進化
// index.html の db / persist / P / today / byId / esc などを使う（読み込みは index.html の本体より前）。
window.BUDDY_CFG = {
  // ---- 眠る・お父さん ----
  sleepWarnDays: 3,        // この日数あいたら「ねむそう」
  sleepDays: 4,            // この日数あいたら「眠る」
  dormPerDay: 10,          // 休眠値＝あいた日数×この値（上限100）
  dadLimit: 70,            // 休眠値がこれ以上で、かつ4科目の習熟度より高いと「お父さん」が出る
  // ---- 経験値 ----
  xpBase: 10, xpPerStar: 3,   // はじめて完了した問題：10＋難度×3
  xpRepeat: 2,                // 同じ問題をもう一度（1日1回まで）
  xpSelfScore: 3,             // 自己採点を記録したとき
  xpParentMax: 10,            // 親の採点が入ったとき：得点率×10（切り捨て）
  xpExact: 3,                 // 自己採点と親の採点が近い（±10％以内）ときの「ぴったり」ボーナス
  xpMock: 20,                 // 模擬を最後までやったとき（その模擬の科目に等分）
  // ---- 成長 ----
  hatchXp: 100,               // 経験値がこれに達するとタマゴがかえる
  tie: 5,                     // 型の判定：経験値の割合（％）の差がこの値以内なら「同じくらい」
  mid:   {xp: 300, top1: 40},               // 成体：経験値300＋どれかの科目の習熟度が40以上
  final: {xp: 600, count: 2, min: 40,       // 究極進化：経験値600＋2科目の習熟度が40以上
          mockPct: 80, needBoth: true}      //          ＋45分模擬（Ⅰ・Ⅱ）の合計が80％以上
};

(function () {
  const C = window.BUDDY_CFG;
  const SUBJ = ["math", "science", "japanese", "society"];
  const SUBJN = {math: "算数", science: "理科", japanese: "国語", society: "社会"};
  const TYPES = {
    math:     {n: "ジオネ",     l: "算数型"},
    science:  {n: "ミラフィ",   l: "理科型"},
    japanese: {n: "リリベル",   l: "国語型"},
    society:  {n: "コンフィー", l: "社会型"},
    math_science:     {n: "セレスティ", l: "算数×理科型"},
    math_japanese:    {n: "メルティア", l: "算数×国語型"},
    math_society:     {n: "ルークス",   l: "算数×社会型"},
    science_japanese: {n: "リーフェ",   l: "理科×国語型"},
    science_society:  {n: "テラーノ",   l: "理科×社会型"},
    japanese_society: {n: "メロディア", l: "国語×社会型"},
    balance:  {n: "ルミナリス", l: "バランス型"}
  };
  const HINT = {balance: "3科目以上が同じくらい"};
  const TYPE_ORDER = ["math", "science", "japanese", "society", "math_science", "math_japanese", "math_society", "science_japanese", "science_society", "japanese_society", "balance"];
  const STAGE_NAMES = ["タマゴ", "幼体", "成体", "究極進化"];
  const DAD_IMG = "c_dad.webp";
  // まだ出会っていないキャラは、本物の画像を読みこまず、同じ形のかげ絵で表示する（長押しで見えてしまうのを防ぐ）
  const BLANK = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="30" r="18"/><path d="M18 92c0-26 14-40 32-40s32 14 32 40z"/></svg>');
  const SUBJ_OVERRIDE = {};   // 例：{"II-W1-01": "society"}  問題ごとに科目を変えたいとき

  const LSK = () => window.LS || "tekisei_v1";
  const dkey = s => { const m = String(s).split("/"); return m.length === 3 ? new Date(+m[0], +m[1] - 1, +m[2]) : null; };
  const daysBetween = (a, b) => Math.round((b - a) / 86400000);
  const todayStr = () => today();
  const zero = () => ({math: 0, science: 0, japanese: 0, society: 0});

  function subjOf(p) {
    if (!p) return "math";
    if (SUBJ_OVERRIDE[p.id]) return SUBJ_OVERRIDE[p.id];
    const c = String(p.pat || "")[0];
    if (p.sub === "I") return c === "S" ? "science" : "math";
    return c === "C" ? "society" : "japanese";
  }

  /* ---------- データ ---------- */
  function init() {
    if (!db.buddy) {
      try { const raw = localStorage.getItem(LSK()); if (raw) localStorage.setItem(LSK() + "_bak_before_buddy", raw); } catch (e) {}
      db.buddy = {v: 2, lap: 1, xp: 0, xpSub: zero(), stage: 0, typeLock: null, born: todayStr(), lastStudy: null, days: [], xpLog: {}, codex: {}, maxStage: {}, dadFound: false, evo: []};
      persist();
    }
    const b = db.buddy;
    if (b.v !== 2) migrate(b);
    b.days = b.days || []; b.xpLog = b.xpLog || {}; b.codex = b.codex || {}; b.evo = b.evo || []; b.maxStage = b.maxStage || {}; b.friends = b.friends || []; b.forms = b.forms || {};
    b.xpSub = b.xpSub || zero();
    return b;
  }
  // v1（成長段階が0〜4）→ v2（タマゴ→…）への移行。経験値は引き継ぐ
  function migrate(b) {
    try { const raw = localStorage.getItem(LSK()); if (raw && !localStorage.getItem(LSK() + "_bak_before_v2")) localStorage.setItem(LSK() + "_bak_before_v2", raw); } catch (e) {}
    const xs = zero(); let sum = 0;
    Object.keys(b.xpLog || {}).forEach(k => {
      const m = k.match(/^\d+:(.+)$/); if (!m) return;
      const p = byId(m[1]); if (!p) return;
      const log = b.xpLog[k]; let g = 0;
      if (log.first) g += C.xpBase + C.xpPerStar * (p.star || 1);
      if (log.rep) g += C.xpRepeat;
      if (log.self) g += C.xpSelfScore;
      xs[subjOf(p)] += g; sum += g;
    });
    const total = b.xp || 0;
    if (total > sum) {                       // 親の採点ぶんなど、科目が分からない経験値は、今の割合で配る
      const rest = total - sum;
      if (sum > 0) SUBJ.forEach(s => { xs[s] += Math.round(rest * xs[s] / sum); });
      else xs.math += rest;
    }
    b.xpSub = xs; b.xp = SUBJ.reduce((a, s) => a + xs[s], 0);
    b.stage = 0; b.typeLock = null; b.codex = {}; b.maxStage = {}; b.evo = b.evo || [];
    b.v = 2; persist();
  }
  const B = () => init();
  const lap = () => (db.buddy && db.buddy.lap) || 1;

  // 科目別の習熟度（0〜100）。現在の周回の、問題ごとの最新の得点率の平均×（解いた数/3 で最大1）
  function proficiency() {
    const L = lap(), latest = {};
    (db.results || []).forEach(r => { if ((r.lap || 1) === L) latest[r.pid] = r; });
    const acc = {}; SUBJ.forEach(s => acc[s] = {sum: 0, n: 0});
    Object.keys(latest).forEach(pid => {
      const p = byId(pid); if (!p) return;
      const r = latest[pid]; if (!r.max) return;
      const a = acc[subjOf(p)]; a.sum += r.score / r.max * 100; a.n++;
    });
    const out = {};
    SUBJ.forEach(s => { const a = acc[s]; out[s] = a.n ? Math.round(a.sum / a.n * Math.min(1, a.n / 3)) : 0; });
    return out;
  }

  // 型の決め方：4科目の経験値の割合で、上位の科目が「同じくらい」かを見る
  //  1科目だけ高い→単科目型／2科目が同じくらい→複合型／3科目以上が同じくらい→バランス型
  function decideType(xs) {
    const total = SUBJ.reduce((a, s) => a + xs[s], 0);
    if (total <= 0) return null;
    const arr = SUBJ.map(s => [s, xs[s] / total * 100]).sort((a, b) => b[1] - a[1]);
    const top = arr[0][1];
    const near = arr.filter(x => x[1] >= top - C.tie).map(x => x[0]);
    if (near.length >= 3) return "balance";
    if (near.length === 2) return SUBJ.filter(s => near.includes(s)).join("_");
    return near[0];
  }

  function mockOk(L) {
    const f = C.final, ms = (db.mocks || []).filter(m => (m.lap || 1) === L);
    const last = s => { const a = ms.filter(m => m.sub === s); return a[a.length - 1]; };
    const a = last("I"), c = last("II");
    if (f.needBoth) { if (!a || !c) return false; return (a.score + c.score) / Math.max(1, a.max + c.max) * 100 >= f.mockPct; }
    const x = [a, c].filter(Boolean); if (!x.length) return false;
    return x.reduce((s, m) => s + m.score, 0) / Math.max(1, x.reduce((s, m) => s + m.max, 0)) * 100 >= f.mockPct;
  }

  // 進化の判定。変化があれば内容を返す
  function evaluate() {
    const b = B(), prof = proficiency(), evs = [], v = SUBJ.map(s => prof[s]).sort((x, y) => y - x);
    if (b.stage === 0 && b.xp >= C.hatchXp) {
      const t = decideType(b.xpSub) || "balance";
      b.stage = 1; b.typeLock = t; b.codex[t] = b.codex[t] || todayStr(); b.maxStage[t] = 1; b.forms = b.forms || {}; b.forms[t + "_1"] = b.forms[t + "_1"] || todayStr();
      evs.push({kind: "hatch", type: t}); b.evo.push({date: todayStr(), stage: 1, type: t});
    }
    if (b.stage === 1 && b.xp >= C.mid.xp && v[0] >= C.mid.top1) {
      const from = b.typeLock, t = decideType(b.xpSub) || from; b.typeLock = t;
      b.stage = 2; b.codex[t] = b.codex[t] || todayStr(); b.maxStage[t] = Math.max(b.maxStage[t] || 0, 2); b.forms = b.forms || {}; b.forms[t + "_2"] = b.forms[t + "_2"] || todayStr();
      evs.push({kind: "stage", stage: 2, from: from, type: t}); b.evo.push({date: todayStr(), stage: 2, type: t, from: from});
    }
    if (b.stage === 2 && b.xp >= C.final.xp && v.filter(x => x >= C.final.min).length >= C.final.count && mockOk(lap())) {
      const from = b.typeLock, t = decideType(b.xpSub) || from; b.typeLock = t;
      b.stage = 3; b.codex[t] = b.codex[t] || todayStr(); b.maxStage[t] = Math.max(b.maxStage[t] || 0, 3); b.forms = b.forms || {}; b.forms[t + "_3"] = b.forms[t + "_3"] || todayStr();
      evs.push({kind: "stage", stage: 3, from: from, type: t}); b.evo.push({date: todayStr(), stage: 3, type: t, from: from});
    }
    checkSpecials(evs);
    if (evs.length) persist();
    return evs;
  }

  /* ---------- 状態（通常・嬉しい・眠る・お父さん）---------- */
  let happyUntil = 0;
  function status() {
    const b = B(), prof = proficiency();
    const base = dkey(b.lastStudy || b.born) || new Date();
    const n = new Date(); n.setHours(0, 0, 0, 0);
    const days = Math.max(0, daysBetween(base, n));
    const dorm = Math.min(100, days * C.dormPerDay);
    const maxProf = Math.max.apply(null, SUBJ.map(s => prof[s]));
    const dad = dorm >= C.dadLimit && dorm > maxProf;
    if (dad && !b.dadFound) { b.dadFound = true; b.dadDate = todayStr(); persist(); }
    const sleeping = !dad && days >= C.sleepDays;
    const sleepy = !dad && !sleeping && days >= C.sleepWarnDays;
    const happy = Date.now() < happyUntil;
    return {days, dorm, dad, sleeping, sleepy, happy: happy && !dad, prof, state: dad ? "dad" : sleeping ? "sleep" : happy ? "happy" : "normal"};
  }

  function form() {
    const b = B();
    return {stage: b.stage, type: b.typeLock, lean: b.stage === 0 ? decideType(b.xpSub) : null};
  }
  const stageNo = f => Math.max(1, Math.min(3, f.stage));
  function spriteSrc(f, state) {
    if (state === "dad") return DAD_IMG;
    const suf = state === "happy" ? "_happy" : state === "sleep" ? "_sleep" : "";
    return "c_" + f.type + "_" + stageNo(f) + suf + ".webp";
  }
  // 戦闘用：背景なしの切り抜き画像（究極進化のみ用意。ない場合は ふつうの画像に戻る）
  const meSrc = f => f.stage >= 3 ? "c_" + f.type + "_3_nb.webp" : spriteSrc(f, "normal");
  const fixImg = (im, alt) => { im.onerror = () => { im.onerror = null; im.src = alt; }; };
  function nameOf(f, state) {
    if (state === "dad") return "お父さん";
    if (f.stage === 0) return "タマゴ";
    return TYPES[f.type].n;
  }
  function subName(f, state) {
    if (state === "dad") return "ねむそうなお父さん";
    if (f.stage === 0) return "卵の中で、何かが育っているよ";
    return TYPES[f.type].l + "　" + STAGE_NAMES[f.stage];
  }

  const LINES = {
    normal: ["一緒にがんばろうね！", "キミならできるよ！", "今日は どれから やる？", "1問だけでも、ちゃんと前に進むよ！"],
    egg: ["卵の中から、とくとく…音がするよ。", "いろいろな科目を解くと、どんな子が生まれるかな？", "もうすぐ 会えるかもしれないね！"],
    happy: ["やったー！", "がんばったね！", "いいね、その調子！", "ありがとう！力が わいてきたよ！"],
    sleepy: ["ふわぁ…ちょっと ねむいな。1問だけ 一緒に やってみる？"],
    sleep: ["むにゃ…1問やれば、すぐ起きるよ。", "ぐぅ…いつでも待ってるよ。"],
    dad: ["あれ……？ 今日はお勉強しないの？", "ちょっと休憩……のつもりだったんだけどなぁ。", "そろそろ一緒に勉強しようか！"]
  };
  const pick = a => a[Math.floor(Math.random() * a.length)];
  function lineFor(st, f) {
    const k = st.state === "dad" ? "dad" : st.state === "sleep" ? "sleep" : st.sleepy ? "sleepy" : st.state === "happy" ? "happy" : (f.stage === 0 ? "egg" : "normal");
    return pick(LINES[k]);
  }

  /* ---------- 経験値 ---------- */
  function addXp(bySubj) {
    const b = B(); let t = 0;
    SUBJ.forEach(s => { const g = bySubj[s] || 0; b.xpSub[s] = (b.xpSub[s] || 0) + g; t += g; });
    b.xp = SUBJ.reduce((a, s) => a + b.xpSub[s], 0);
    return t;
  }

  /* ---------- 連続スタンプ（ログインボーナス）---------- */
  const STREAK_MILESTONES = {3: 3, 5: 5, 7: 10, 10: 10, 14: 15, 21: 20, 30: 30};
  const STREAK_MSG = {
    3: ["3日続いたね！", "いい調子。この流れ、大切にしよう。"],
    5: ["5日連続！がんばってるねー！", "毎日の積み重ねが、一番の力になるよ。"],
    7: ["1週間連続！", "7日続けられたのは、りっぱな力だよ。"],
    10: ["10日連続！", "もう、勉強が生活の一部になってきたね。"],
    14: ["2週間連続！", "続ける力は、入試でもきっと味方になるよ。"],
    21: ["3週間連続！", "すごい。ここまで続いた人は、なかなかいないよ。"],
    30: ["30日連続！", "ひと月続けた自分を、ほこりに思っていいよ。"]
  };
  const wkKey = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.getFullYear() + "/" + (x.getMonth() + 1) + "/" + x.getDate(); };
  // 勉強した日から、連続日数を数える。1週間に1回だけ、1日お休みしても切れない（お休みチケット・自動）
  function streakInfo() {
    const b = B(), now = new Date(); now.setHours(0, 0, 0, 0);
    const ds = Array.from(new Set(b.days)).map(dkey).filter(Boolean).sort((x, y) => x - y);
    const used = {}; let cur = 0, best = 0, start = null, prev = null;
    ds.forEach(d => {
      if (!prev) { cur = 1; start = d; }
      else {
        const gap = daysBetween(prev, d);
        if (gap === 1) cur++;
        else if (gap === 2) { const m = new Date(prev); m.setDate(m.getDate() + 1); const k = wkKey(m); if (!used[k]) { used[k] = m.getTime(); cur++; } else { cur = 1; start = d; } }
        else { cur = 1; start = d; }
      }
      best = Math.max(best, cur); prev = d;
    });
    let alive = false, ticketToday = false;
    if (prev) {
      const gap = daysBetween(prev, now);
      if (gap <= 1) alive = true;
      else if (gap === 2) { const m = new Date(prev); m.setDate(m.getDate() + 1); if (!used[wkKey(m)]) { alive = true; ticketToday = true; } }
    }
    const thisWk = wkKey(now);
    const usedThisWeek = Object.keys(used).some(k => k === thisWk);
    return {cur: alive ? cur : 0, best, start: start ? start.getFullYear() + "/" + (start.getMonth() + 1) + "/" + start.getDate() : "", alive, ticketLeft: !usedThisWeek, ticketToday, used, last: prev};
  }
  function weekStamps() {
    const b = B(), info = streakInfo(), now = new Date(); now.setHours(0, 0, 0, 0);
    const mon = new Date(now); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    const set = new Set(b.days), usedDays = new Set(Object.values(info.used).map(t => { const d = new Date(t); return d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate(); }));
    const nm = ["月", "火", "水", "木", "金", "土", "日"], out = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon); d.setDate(mon.getDate() + i);
      const k = d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate();
      const kk = d.getFullYear() + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + String(d.getDate()).padStart(2, "0");
      out.push({n: nm[i], done: set.has(k) || set.has(kk), rest: usedDays.has(k), today: d.getTime() === now.getTime(), future: d > now});
    }
    return out;
  }
  function markStudy() {
    const b = B(), t = todayStr();
    b.lastStudy = t; if (!b.days.includes(t)) b.days.push(t);
    if (b.days.length > 400) b.days = b.days.slice(-400);
  }

  // 問題を完了した（答えを保存した／自己採点を記録した）
  function complete(pids, o) {
    o = o || {};
    const b = B(), t = todayStr(), by = zero(); let gain = 0, mockSubs = [];
    pids.forEach(pid => {
      const p = byId(pid); if (!p) return;
      const s = subjOf(p), k = lap() + ":" + pid, log = b.xpLog[k] || (b.xpLog[k] = {});
      let g = 0;
      if (!log.first) { log.first = t; g += C.xpBase + C.xpPerStar * (p.star || 1); }
      else if (log.rep !== t) { log.rep = t; g += C.xpRepeat; }
      if (o.self && !log.self) { log.self = t; g += C.xpSelfScore; }
      by[s] += g; mockSubs.push(s);
    });
    if (o.mock && mockSubs.length) mockSubs.forEach(s => { by[s] += C.xpMock / mockSubs.length; });
    markStudy();
    // 連続の節目ボーナス：その日に取り組んだ科目に等分して配る（型の割合をかたよらせないため）
    let sk = null; const si = streakInfo(); b.streakAwards = b.streakAwards || {};
    if (si.alive && STREAK_MILESTONES[si.cur] && !b.streakAwards[si.start + ":" + si.cur]) {
      b.streakAwards[si.start + ":" + si.cur] = t;
      const bonus = STREAK_MILESTONES[si.cur], tgt = SUBJ.filter(x => by[x] > 0), list = tgt.length ? tgt : SUBJ;
      list.forEach(x => { by[x] += bonus / list.length; });
      sk = {n: si.cur, bonus: bonus};
    }
    gain = addXp(by);
    persist();
    afterEvent(gain, "completed", sk);
    return gain;
  }
  // 親の採点が入った。list: [{sid, pid, score, max, self:{score,max}|null}]
  function graded(list) {
    const b = B(), by = zero();
    list.forEach(g => {
      const k = "g:" + (g.sid || g.pid);
      if (b.xpLog[k]) return;
      b.xpLog[k] = {done: todayStr()};
      if (!g.max) return;
      let x = Math.floor(C.xpParentMax * g.score / g.max);
      if (g.self && g.self.max) { const d = Math.abs(g.score / g.max - g.self.score / g.self.max) * 100; if (d <= 10) x += C.xpExact; }
      by[subjOf(byId(g.pid))] += x;
    });
    const gain = addXp(by); persist();
    let sc = 0, mx = 0; list.forEach(g => { if (g.max) { sc += g.score; mx += g.max; } });
    const rw = gain > 0 && mx > 0 ? {score: sc, max: mx, pct: sc / mx * 100} : null;
    afterEvent(gain, "graded", null, rw);
    return gain;
  }

  function afterEvent(gain, kind, sk, rw) {
    happyUntil = Date.now() + 6000;
    const evs = evaluate();
    const showEvo = () => { if (evs.length) setTimeout(() => evoOverlay(evs), 400); };
    const showStreak = () => { if (sk) streakOverlay(sk, showEvo); else showEvo(); };
    if (rw) { setTimeout(() => rewardOverlay(rw, gain, showStreak), 500); return; }
    toast(gain, kind);
    if (sk) setTimeout(() => streakOverlay(sk, showEvo), 700); else showEvo();
  }
  function streakOverlay(sk, done) {
    const m = STREAK_MSG[sk.n] || [sk.n + "日連続！", "すごいね。"];
    const o = document.createElement("div"); o.className = "bd-evo"; document.body.appendChild(o);
    o.innerHTML = `<div class="box"><div class="bd-stamp">${sk.n}<small>日</small></div><h2>${esc(m[0])}</h2><p>${esc(m[1])}</p><p class="bd-sub">ボーナス経験値 +${sk.bonus}</p><button class="primary" id="bdOk">やったー！</button></div>`;
    o.querySelector("#bdOk").onclick = () => { o.remove(); if (done) done(); };
  }

  /* ---------- ごほうび（親の採点が入ったとき）---------- */
  const REWARD = [
    {min: 80, head: ["全部 確かめた力、光ってるよ", "考えぬいた分だけ、ちゃんと点になったね", "今の力、かなり本物だよ"], msg: ["難しい問題にも、あきらめずに向きあえたね。この調子で、次も進もう。", "できた問題は、人に説明できるくらいまで理解を深めると、もっと強くなるよ。"], title: "すばらしい！"},
    {min: 60, head: ["あと一歩のところまで来たよ", "できたところが、ちゃんと増えてるよ", "おしい問題が、伸びしろだよ"], msg: ["できた点を、まず自分でほめよう。間違えた問題をもう一度やると、ぐんと伸びるよ。", "考え方が合っていた問題も多いよ。間違えた問題を、もう一度試してみよう。"], title: "いい調子！", review: true},
    {min: 30, head: ["今日も 机に向かえたのが すごい", "やってみたことが、一番大事だよ", "難しい問題は、伸びるチャンス"], msg: ["どこでつまずいたかが分かれば、次は必ず強くなるよ。一つだけ、ふり返ってみよう。", "点数より、取り組んだことがえらいよ。間違えた問題は、ゆっくり見直せば大丈夫。"], title: "やってみたね！", review: true},
    {min: 0, head: ["やれやれ、パパを頼りなさい"], msg: ["どこでつまずいたか、一緒に見てみよう。一人で悩まなくて大丈夫だよ。"], title: "パパの出番！", review: true, papa: true}
  ];
  function rewardOf(pct) { return REWARD.find(r => pct >= r.min) || REWARD[REWARD.length - 1]; }
  /* ごほうび画像：この端末(IndexedDB)だけに保存。公開リポジトリには入れない */
  const RKEYS = [["rw_80", "80％以上"], ["rw_60", "60〜79％"], ["rw_30", "30〜59％"], ["rw_0", "29％以下（パパ）"]];
  function idb() { return new Promise((ok, ng) => { const q = indexedDB.open("tekisei_img", 1); q.onupgradeneeded = () => q.result.createObjectStore("img"); q.onsuccess = () => ok(q.result); q.onerror = () => ng(q.error); }); }
  function idbGet(k) { return idb().then(d => new Promise(ok => { const q = d.transaction("img").objectStore("img").get(k); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); })).catch(() => null); }
  function idbSet(k, v) { return idb().then(d => new Promise((ok, ng) => { const t = d.transaction("img", "readwrite"); if (v) t.objectStore("img").put(v, k); else t.objectStore("img").delete(k); t.oncomplete = ok; t.onerror = () => ng(t.error); })); }
  function shrink(file) { return new Promise((ok, ng) => { const u = URL.createObjectURL(file), i = new Image(); i.onload = () => { const m = 900, k = Math.min(1, m / Math.max(i.width, i.height)), c = document.createElement("canvas"); c.width = Math.round(i.width * k); c.height = Math.round(i.height * k); c.getContext("2d").drawImage(i, 0, 0, c.width, c.height); URL.revokeObjectURL(u); c.toBlob(b => b ? ok(b) : ng(new Error("x")), "image/jpeg", 0.88); }; i.onerror = () => ng(new Error("img")); i.src = u; }); }
  function rkey(r) { return r.min >= 80 ? "rw_80" : r.min >= 60 ? "rw_60" : r.min >= 30 ? "rw_30" : "rw_0"; }
  function rewardSettings() {
    const host = document.getElementById("rwSet"); if (!host) return;
    host.innerHTML = RKEYS.map(([k, n]) => `<div class="bd-rwrow" data-k="${k}"><div class="th">?</div><div><b>${n}</b><br><label class="rwb">選ぶ<input type="file" accept="image/*" hidden></label> <button class="ghost rwx">もどす</button></div></div>`).join("");
    host.querySelectorAll(".bd-rwrow").forEach(row => {
      const k = row.dataset.k, th = row.querySelector(".th");
      const show = () => idbGet(k).then(b => { th.innerHTML = b ? `<img src="${URL.createObjectURL(b)}" alt="">` : (k === "rw_0" ? `<img src="reward_papa.webp" alt="">` : "なし"); });
      show();
      row.querySelector("input").onchange = e => { const f = e.target.files[0]; if (!f) return; shrink(f).then(b => idbSet(k, b)).then(show).catch(() => alert("画像を読みこめませんでした")); };
      row.querySelector(".rwx").onclick = () => idbSet(k, null).then(show);
    });
  }
  const pickR = a => a[Math.floor(Math.random() * a.length)];
  function rewardOverlay(rw, gain, done) {
    const r = rewardOf(rw.pct), f = form(), st = status();
    const pic = r.papa
      ? `<div class="bd-wrap big"><img class="bd-img" alt="" src="reward_papa.webp" onerror="this.onerror=null;this.src='${DAD_IMG}'"></div>`
      : sprite(true, f, {state: "happy"});
    const k = rkey(r);
    const o = document.createElement("div"); o.className = "bd-evo"; document.body.appendChild(o);
    const si = streakInfo();
    o.innerHTML = `<div class="box"><div class="bd-sub">親の採点が入りました</div>${pic}
      <div class="bd-rscore"><b>${Math.round(rw.score)}</b>点 <span>／ ${Math.round(rw.max)}点（${Math.round(rw.pct)}％）</span>　<em>${esc(r.title)}</em></div>
      <div class="bd-rmsg"><b>${esc(pickR(r.head))}</b><p>${esc(pickR(r.msg))}</p><div class="bd-from">おうえん：適性検査トレーニング</div></div>
      <div class="bd-rxp">経験値 +${Math.round(gain)}${si.cur ? "　／　連続 " + si.cur + "日め" : ""}</div>
      <div class="row" style="justify-content:center;gap:10px;margin-top:12px">${r.review ? '<button id="bdRv">間違えた問題を見る</button>' : ""}<button class="primary" id="bdOk">次へ</button></div></div>`;
    idbGet(k).then(b => { if (!b) return; const w = o.querySelector(".bd-wrap, .bd-big, svg"); const el = document.createElement("div"); el.className = "bd-photo"; el.innerHTML = '<img alt="">'; el.firstChild.src = URL.createObjectURL(b); const old = o.querySelector(".bd-wrap"); if (old) old.replaceWith(el); else o.querySelector(".box").insertBefore(el, o.querySelector(".bd-rscore")); });
    const close = go => { o.remove(); if (go) location.hash = "#review"; if (done) done(); };
    o.querySelector("#bdOk").onclick = () => close(false);
    const rv = o.querySelector("#bdRv"); if (rv) rv.onclick = () => close(true);
  }

  /* ---------- 表示 ---------- */
  const css = document.createElement("style");
  css.textContent = `
  .bd-card{display:flex;gap:14px;align-items:center;padding:14px 16px;cursor:pointer;text-align:left;width:100%;font:inherit;color:var(--ink)}
  .bd-wrap{position:relative;flex:none;width:156px;height:130px;display:flex;align-items:center;justify-content:center}
  .bd-wrap.big{width:300px;height:250px;max-width:100%;margin-left:auto;margin-right:auto}
  .bd-wrap.egg{width:104px;height:130px}
  .bd-wrap.big.egg{width:190px;height:240px}
  .bd-img{max-width:100%;max-height:100%;object-fit:contain;border-radius:16px;box-shadow:0 3px 10px rgba(0,0,0,.18);animation:bdIdle 3.4s ease-in-out infinite}
  .bd-wrap.happy .bd-img,.bd-wrap.happy svg{animation:bdHop .7s ease-in-out infinite}
  .bd-wrap.sleep .bd-img,.bd-wrap.dad .bd-img,.bd-wrap.sleep svg{animation:bdBreath 4s ease-in-out infinite}
  .bd-wrap svg{width:100%;height:100%;overflow:visible;animation:bdWobble 3s ease-in-out infinite;transform-origin:50% 100%}
  .bd-wrap.shake svg{animation:bdShake .5s ease-in-out infinite}
  @keyframes bdIdle{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
  @keyframes bdHop{0%,100%{transform:translateY(0)}40%{transform:translateY(-10px)}}
  @keyframes bdBreath{0%,100%{transform:scale(1,1)}50%{transform:scale(1.015,.985)}}
  @keyframes bdWobble{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(2deg)}}
  @keyframes bdShake{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(7deg)}}
  .bd-info{flex:1;min-width:0}
  .bd-name{font-size:18px;font-weight:800}
  .bd-sub{font-size:13px;color:var(--sub);margin-top:2px}
  .bd-say{margin-top:8px;padding:8px 12px;border-radius:14px;background:var(--main2);font-size:15px}
  .bar{height:10px;border-radius:6px;background:var(--line);overflow:hidden}
  .bar>i{display:block;height:100%;background:var(--main);border-radius:6px}
  .bar.sx>i{background:#e08a1e}
  .bd-row{display:flex;align-items:center;gap:10px;margin:6px 0;font-size:15px}
  .bd-row b{width:3em}
  .bd-row .bar{flex:1}
  .bd-row span{width:4.2em;text-align:right;color:var(--sub)}
  .bd-big{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center}
  .bd-evo{position:fixed;inset:0;z-index:60;background:rgba(10,15,30,.78);display:flex;align-items:center;justify-content:center;padding:20px}
  .bd-evo .box{background:var(--card);border-radius:22px;padding:22px 24px;max-width:460px;width:100%;text-align:center}
  .bd-stamp{width:96px;height:96px;margin:0 auto 8px;border-radius:50%;background:#e08e1e;color:#fff;font-size:44px;font-weight:800;display:flex;align-items:baseline;justify-content:center;padding-top:20px;box-sizing:border-box;box-shadow:0 4px 14px rgba(0,0,0,.25)}.bd-stamp small{font-size:18px;margin-left:2px}
  .bd-rscore{margin:10px 0 6px;font-size:15px}.bd-rscore b{font-size:34px;color:var(--pri,#1d4f91)}.bd-rscore span{color:var(--sub)}.bd-rscore em{font-style:normal;font-weight:800}
  .bd-rmsg{text-align:left;background:var(--bg,#f5f7fb);border-left:6px solid #e08e1e;border-radius:14px;padding:12px 14px}.bd-rmsg b{display:block;font-size:18px;margin-bottom:4px}.bd-rmsg p{margin:0;font-size:14px;line-height:1.6}.bd-from{margin-top:6px;font-size:11px;color:var(--sub);text-align:right}
  .bd-photo{display:flex;justify-content:center;margin:6px 0}.bd-photo img{max-height:300px;max-width:100%;border-radius:16px;box-shadow:0 3px 10px rgba(0,0,0,.25)}
  .bd-rwrow{display:flex;gap:12px;align-items:center;margin:8px 0}.bd-rwrow .th{width:64px;height:84px;border-radius:10px;background:var(--line);display:flex;align-items:center;justify-content:center;overflow:hidden;color:var(--sub);font-size:12px;flex:none}.bd-rwrow .th img{width:100%;height:100%;object-fit:cover}.rwb{display:inline-block;padding:6px 14px;border:1px solid var(--line);border-radius:10px;font-weight:700;cursor:pointer}
  .bd-rxp{margin-top:10px;background:#e8eefb;border-radius:12px;padding:8px 12px;font-size:14px}
  .bd-week{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;text-align:center}.bd-week div{border-radius:12px;padding:8px 0;background:#e8ecf3;font-size:13px;color:#68738a}.bd-week .d{background:#e08e1e;color:#fff;font-weight:800}.bd-week .r{background:#cfe0f5;color:#1d4f91}.bd-week .t{outline:2px solid #1d4f91}
  .bd-evo h2{margin:0 0 6px;font-size:22px}
  .bd-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:55;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:8px 16px 8px 8px;display:flex;align-items:center;gap:10px;box-shadow:0 6px 24px rgba(0,0,0,.25);font-weight:700;animation:bdIn .35s ease-out}
  .bd-toast img{width:64px;height:52px;object-fit:cover;border-radius:10px}
  .bd-toast .eg{width:40px;height:50px}
  @keyframes bdIn{from{opacity:0;transform:translate(-50%,16px)}to{opacity:1;transform:translate(-50%,0)}}
  .cx{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
  .cx .it{text-align:center;padding:10px 8px}
  .cx .it img{width:100%;height:110px;object-fit:cover;border-radius:12px}
  .cx .it.lock img{filter:brightness(0) opacity(.3)}
  .cx2{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:12px}
  .cx2 .it{text-align:center;padding:10px 8px}
  .cx2 .it img,.cx2 .it .eg{display:block;margin:0 auto;height:110px;width:auto;max-width:100%;object-fit:cover;border-radius:12px}
  .cx2 .it .eg svg{height:110px;width:auto}
  .cx2 .it.lock img{filter:brightness(0) opacity(.3)}
  .cx2 .it small{display:block;color:var(--sub);font-size:12px}
  .cxrow{margin-bottom:10px}
  .cxh{margin-bottom:6px}.cxh small{color:var(--sub);margin-left:8px;font-size:12px}
  .cxs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  .bd-friends{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;text-align:center}
  .bd-friends img{width:100%;height:80px;object-fit:contain;background:#eef1f6;border-radius:10px}
  .bd-friends b{display:block;font-size:13px}.bd-friends small{color:var(--sub);font-size:11px}
  .cxs .sl{text-align:center}.cxs .sl img{width:100%;height:96px;object-fit:contain;background:#eef1f6;border-radius:10px}
  .cxs .sl.lock img{filter:brightness(0) opacity(.3)}
  .cxs small{display:block;font-size:11px;color:var(--sub)}
  .cx .it small{display:block;color:var(--sub);margin-top:2px;font-size:12px}
  @media (prefers-reduced-motion: reduce){.bd-img,.bd-wrap svg{animation:none!important}}
  `;
  document.head.appendChild(css);

  // タマゴ（オリジナルのかんたんな絵）。progress=0〜1 でひびが入る
  function eggSVG(progress, state, cls) {
    const crack1 = progress >= 0.5 ? '<path d="M82 62 l10 14 l-12 10 l12 12" fill="none" stroke="#8a7aa8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' : "";
    const crack2 = progress >= 0.8 ? '<path d="M126 52 l-9 14 l13 8 l-10 14 M70 112 l14 6 l-6 12" fill="none" stroke="#8a7aa8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' : "";
    let face = '<ellipse cx="78" cy="136" rx="11" ry="7" fill="#ffc2d1" opacity=".7"/><ellipse cx="124" cy="136" rx="11" ry="7" fill="#ffc2d1" opacity=".7"/>';
    if (state === "happy") face += '<path d="M72 124 q7 -9 14 0 M116 124 q7 -9 14 0" fill="none" stroke="#5b4a78" stroke-width="3.5" stroke-linecap="round"/><path d="M90 142 q11 12 22 0" fill="#ff8fa3" stroke="#5b4a78" stroke-width="3" stroke-linecap="round"/>';
    else if (state === "sleep") face += '<path d="M72 126 q7 7 14 0 M116 126 q7 7 14 0" fill="none" stroke="#5b4a78" stroke-width="3.5" stroke-linecap="round"/><path d="M92 144 q9 5 18 0" fill="none" stroke="#5b4a78" stroke-width="3" stroke-linecap="round"/><text x="150" y="60" font-size="22" font-weight="800" fill="#7a6fd0">Z</text><text x="166" y="42" font-size="16" font-weight="800" fill="#7a6fd0">z</text>';
    else face += '<circle cx="79" cy="124" r="5" fill="#5b4a78"/><circle cx="123" cy="124" r="5" fill="#5b4a78"/><circle cx="81" cy="122" r="1.7" fill="#fff"/><circle cx="125" cy="122" r="1.7" fill="#fff"/><path d="M95 141 q6 6 12 0" fill="none" stroke="#5b4a78" stroke-width="3" stroke-linecap="round"/>';
    const dim = state === "sleep" ? ' opacity=".88"' : "";
    return `<svg viewBox="0 0 202 244" role="img" aria-label="タマゴ" class="${cls || ""}"><defs><linearGradient id="egG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff8e6"/><stop offset=".55" stop-color="#ffe9f3"/><stop offset="1" stop-color="#dcd2ff"/></linearGradient></defs>
    <ellipse cx="101" cy="228" rx="52" ry="9" fill="rgba(0,0,0,.14)"/>
    <g${dim}><path d="M101 14 C152 14 184 108 184 152 C184 202 148 228 101 228 C54 228 18 202 18 152 C18 108 50 14 101 14 Z" fill="url(#egG)" stroke="#b9a8e6" stroke-width="3"/>
    <circle cx="62" cy="76" r="9" fill="#bfe6ff" opacity=".85"/><circle cx="142" cy="92" r="7" fill="#ffd9a8" opacity=".9"/><circle cx="46" cy="170" r="8" fill="#ffc9dd" opacity=".9"/><circle cx="154" cy="178" r="10" fill="#c9f0d4" opacity=".9"/><circle cx="101" cy="196" r="6" fill="#e1d4ff"/>
    <path d="M60 56 q10 -26 34 -34" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".85"/>
    <path d="M150 38 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 z" fill="#ffd45c"/>
    ${face}${crack1}${crack2}</g></svg>`;
  }

  function sprite(big, f, st, extra) {
    const eggy = f.stage === 0 && st.state !== "dad";
    const cls = "bd-wrap" + (big ? " big" : "") + (eggy ? " egg" : "") + " " + st.state + (extra ? " " + extra : "");
    if (eggy) return `<div class="${cls}">${eggSVG(eggProgress(), st.state === "sleep" ? "sleep" : st.state === "happy" ? "happy" : "normal")}</div>`;
    return `<div class="${cls}"><img class="bd-img" alt="${esc(nameOf(f, st.state))}" src="${spriteSrc(f, st.state)}"></div>`;
  }
  const eggProgress = () => Math.min(1, B().xp / C.hatchXp);

  // 次の進化まで
  function nextInfo(f, prof) {
    const b = B(), need = [];
    if (f.stage === 0) {
      const left = Math.max(0, C.hatchXp - b.xp);
      return {frac: eggProgress(), need: [left > 0 ? "あと経験値 " + left + " でかえるよ" : "もうすぐかえるよ"], label: "幼体"};
    }
    const v = SUBJ.map(s => prof[s]).sort((a, c) => c - a);
    if (f.stage === 1) {
      const m = C.mid; if (b.xp < m.xp) need.push("あと経験値 " + (m.xp - b.xp));
      if (v[0] < m.top1) need.push("どれかの科目の習熟度を " + m.top1 + " 以上に");
      return {frac: Math.min(1, (b.xp - C.hatchXp) / (m.xp - C.hatchXp)), need, label: "成体"};
    }
    if (f.stage === 2) {
      const m = C.final; if (b.xp < m.xp) need.push("あと経験値 " + (m.xp - b.xp));
      if (v.filter(x => x >= m.min).length < m.count) need.push(m.count + "科目の習熟度を " + m.min + " 以上に");
      if (!mockOk(lap())) need.push("45分模擬（Ⅰ・Ⅱ）で合計 " + m.mockPct + "％以上");
      return {frac: Math.min(1, (b.xp - C.mid.xp) / (m.xp - C.mid.xp)), need, label: "究極進化"};
    }
    return null;
  }

  let curLine = null, curLineKey = "";
  function line(st, f) { const k = st.state + (st.sleepy ? "s" : "") + f.stage; if (k !== curLineKey) { curLineKey = k; curLine = lineFor(st, f); } return curLine; }

  function card() {
    const f = form(), st = status(), nx = nextInfo(f, st.prof);
    let prog = "";
    if (st.state !== "dad") {
      if (nx) prog = `<div class="bar" style="margin-top:8px"><i style="width:${Math.round(nx.frac * 100)}%"></i></div><div class="bd-sub">${nx.need.length ? "次：" + esc(nx.need.join("／")) : "もうすぐ成長するよ！"}</div>`;
      else prog = `<div class="bd-sub" style="margin-top:8px">究極進化まで育ったよ！旅立ちもできるよ。</div>`;
    }
    return `<button class="card bd-card" data-go="#buddy">${sprite(false, f, st)}<div class="bd-info">
      <div class="bd-name">${esc(nameOf(f, st.state))}</div><div class="bd-sub">${esc(subName(f, st.state))}　経験値 ${B().xp}${streakInfo().cur >= 2 ? "　連続 " + streakInfo().cur + "日" : ""}</div>
      <div class="bd-say">${esc(line(st, f))}</div>${prog}</div></button>`;
  }

  function weekCount() {
    const b = B(), n = new Date(); n.setHours(0, 0, 0, 0); let c = 0;
    b.days.forEach(d => { const x = dkey(d); if (x && daysBetween(x, n) <= 6 && daysBetween(x, n) >= 0) c++; });
    return c;
  }

  function helperCards() {
    const fr = (B().friends || []).map(x => ({n: TYPES[x.type].n, img: "c_" + x.type + "_3.webp", sub: x.date + "　旅立ち"}));
    const sp = SPECIALS.filter(x => specialsOf()[x.id]).map(x => ({n: x.n, img: x.img, sub: x.skill}));
    const all = fr.concat(sp); if (!all.length) return "";
    return `<h2>お助けキャラ（${all.length}）</h2><div class="card"><div class="bd-friends">${all.map(x => `<div><img src="${x.img}" alt="" draggable="false"><b>${esc(x.n)}</b><small>${esc(x.sub)}</small></div>`).join("")}</div><p class="note" style="margin:8px 0 0">BOSSとの戦いで、かけつけて力を貸してくれるよ。</p></div>`;
  }
  // 旅立ち：究極進化したキャラは「お助けキャラ」として残り、新しいタマゴ（次の周）がはじまる。記録・図鑑は消えない
  function depart() {
    const b = B(); if (b.stage < 3 || !b.typeLock) return false;
    b.friends = b.friends || [];
    b.friends.push({type: b.typeLock, date: todayStr(), lap: b.lap || 1, xp: Math.round(b.xp), xpSub: Object.assign({}, b.xpSub)});
    b.lap = (b.lap || 1) + 1;
    b.xp = 0; b.xpSub = zero(); b.stage = 0; b.typeLock = null; b.born = todayStr(); b.lastStudy = todayStr();
    persist(); return true;
  }
  function page() {
    const f = form(), st = status(), b = B(), nx = nextInfo(f, st.prof);
    title(nameOf(f, st.state)); setHdr(""); showFab(false);
    const mx = Math.max(1, Math.max.apply(null, SUBJ.map(s => b.xpSub[s] || 0)));
    const tot = Math.max(1, b.xp);
    const xrows = SUBJ.map(s => `<div class="bd-row"><b>${SUBJN[s]}</b><div class="bar sx"><i style="width:${Math.round((b.xpSub[s] || 0) / mx * 100)}%"></i></div><span>${Math.round(b.xpSub[s] || 0)}（${Math.round((b.xpSub[s] || 0) / tot * 100)}%）</span></div>`).join("");
    const prow = SUBJ.map(s => `<div class="bd-row"><b>${SUBJN[s]}</b><div class="bar"><i style="width:${st.prof[s]}%"></i></div><span>${st.prof[s]}</span></div>`).join("");
    const evo = b.evo.slice(-6).reverse().map(e => `<li>${esc(e.date)}　${e.stage === 1 ? "卵から " + TYPES[e.type].l + "（" + TYPES[e.type].n + "）がかえった" : TYPES[e.type].n + "が" + STAGE_NAMES[e.stage] + "になった"}</li>`).join("");
    const lean = f.stage === 0 ? decideType(b.xpSub) : null;
    const typeMsg = f.stage === 0
      ? (lean ? "今のところ「" + esc(TYPES[lean].l) + "」になりそう。経験値" + C.hatchXp + "でかえるまで、変わるかもしれないよ。" : "まだ、どんな子が生まれるか分からないよ。いろいろな科目を解いてみよう。")
      : (esc(TYPES[f.type].l + "（" + TYPES[f.type].n + "）の姿です。") + (f.stage < 3 && decideType(b.xpSub) && decideType(b.xpSub) !== f.type ? "　次の進化では「" + esc(TYPES[decideType(b.xpSub)].l) + "」になりそう。進化まで、変わるかもしれないよ。" : (f.stage < 3 ? "　次の進化でも、この調子なら同じ型だよ。" : "")));
    $("#app").innerHTML = `
    <div class="card bd-big">${sprite(true, f, st)}
      <div class="bd-name">${esc(nameOf(f, st.state))}</div><div class="bd-sub">${esc(subName(f, st.state))}</div>
      <div class="bd-say">${esc(line(st, f))}</div></div>
    <h2>連続スタンプ</h2>
    <div class="card"><div class="bd-week">${weekStamps().map(x => `<div class="${x.done ? "d" : x.rest ? "r" : ""} ${x.today ? "t" : ""}">${x.n}<br>${x.done ? "✔" : x.rest ? "休" : "・"}</div>`).join("")}</div><div class="bd-sub" style="margin-top:8px">今 <b>${streakInfo().cur}</b> 日連続　／　最高 ${streakInfo().best} 日　／　お休みチケット：${streakInfo().ticketLeft ? "今週は 1回使えるよ" : "今週は 使ったよ"}</div><p class="note" style="margin:6px 0 0">問題を1つ記録した日に、スタンプがつきます。3・5・7・10・14・21・30日で、ボーナス経験値。1日休んでも、週に1回は 続きます。とぎれても、経験値は へりません。</p></div>
    <h2>経験値</h2>
    <div class="card"><div>${b.xp} <span class="muted">経験値</span>　<span class="muted">今週 ${weekCount()}日 がんばったよ</span></div>
      ${nx ? `<div class="bar" style="margin:8px 0"><i style="width:${Math.round(nx.frac * 100)}%"></i></div><div class="bd-sub">次は「${esc(nx.label)}」　${nx.need.length ? esc(nx.need.join("／")) : "条件はそろっているよ。1問やると成長するかも！"}</div>` : `<div class="bd-sub" style="margin-top:6px">究極進化まで育ちました。</div>`}</div>
    ${f.stage === 3 ? `<h2>旅立ちのとき</h2><div class="card"><p style="margin:0 0 8px">${esc(TYPES[f.type].n)}は、りっぱに育ちました。旅立つと、${esc(TYPES[f.type].n)}は「お助けキャラ」として、BOSSとの戦いで力を貸してくれます。そして新しいタマゴが始まります。</p><p class="note" style="margin:0 0 10px">記録・図鑑・解いた問題の履歴は消えません。新しい周では、同じ問題をもう一度やると、また経験値がもらえます。</p><button class="primary" id="bdDepart">旅立たせて、新しいタマゴをむかえる</button></div>` : ""}
    ${helperCards()}
    <h2>科目ごとの経験値</h2>
    <div class="card">${xrows}<p class="note" style="margin:6px 0 0">解いた問題の科目に経験値がたまります。卵がかえるときと、進化するときに、この割合で型が決まります。</p>
      <div class="bd-sub" style="font-size:15px;color:var(--ink);margin-top:8px">${typeMsg}</div></div>
    <h2>科目ごとの習熟度（100点満点）</h2>
    <div class="card">${prow}<p class="note" style="margin:6px 0 0">解いた問題の得点率から決まります。親の採点が入ると、そちらが使われます。進化の条件に使います。</p></div>
    ${evo ? `<h2>これまでの成長</h2><div class="card"><ul style="margin:0;padding-left:20px">${evo}</ul></div>` : ""}
    ${titlesHTML()}
    <div class="row" style="margin-top:14px"><button class="primary" data-go="#boss">BOSSに挑戦</button><button data-go="#codex">図鑑を見る</button></div>
    <div id="rwBox"></div>
    <div id="rwTap" style="text-align:center;margin:26px 0 8px;font-size:11px;color:var(--sub);opacity:.45;user-select:none;-webkit-user-select:none">適性検査トレーニング</div>`;
    (function () {
      const box = document.getElementById("rwBox"), tap = document.getElementById("rwTap"); let n = 0, t0 = 0;
      const open = () => { box.innerHTML = `<h2>ごほうび画像の設定（保護者用）</h2><div class="card"><p class="note" style="margin:0 0 6px">点数ごとに出す画像を、この端末の写真から選べます（この端末の中だけに保存され、ネットには出ません）。選ばない場合は、キャラクターが出ます。</p><div id="rwSet"></div><div class="row" style="margin-top:10px"><button id="rwHide">この設定をかくす</button></div></div><h2>開発者モード（保護者用）</h2><div class="card"><p class="note" style="margin:0 0 8px">ONにすると、BOSS・神と条件に関係なく戦えます（演出の確認用）。記録は残りません。アプリを開き直すとOFFに戻ります。</p><button id="devTg" class="primary"></button></div>`; rewardSettings(); const dt = document.getElementById("devTg"); const dl = () => { dt.textContent = "開発者モード：" + (devMode ? "ON（BOSS画面に出ます）" : "OFF"); }; dl(); dt.onclick = () => { devMode = !devMode; dl(); }; document.getElementById("rwHide").onclick = () => { box.innerHTML = ""; }; box.scrollIntoView({behavior: "smooth", block: "center"}); };
      tap.onclick = () => { const now = Date.now(); if (now - t0 > 3000) n = 0; t0 = now; if (++n >= 5) { n = 0; open(); } };
    })();
    const dp = document.getElementById("bdDepart");
    if (dp) dp.onclick = () => { if (confirm(TYPES[f.type].n + "を旅立たせて、新しいタマゴをむかえますか？\n（" + TYPES[f.type].n + "は「お助けキャラ」として残ります）")) { if (depart()) { toast(0); location.hash = "#buddy"; route(); } } };
  }

  function hintOf(k) {
    if (HINT[k]) return HINT[k];
    const p = k.split("_").map(s => SUBJN[s]);
    return p.length === 1 ? p[0] + "の経験値が他より多い" : p.join("と") + "の経験値が同じくらい多い";
  }
  function foundForms(b) {
    const f = Object.assign({}, b.forms || {});
    (b.evo || []).forEach(e => { if (e.type && e.stage) f[e.type + "_" + e.stage] = f[e.type + "_" + e.stage] || e.date; });
    if (b.stage >= 1 && b.typeLock) f[b.typeLock + "_" + b.stage] = f[b.typeLock + "_" + b.stage] || "now";
    return f;
  }
  function codex() {
    title("図鑑"); setHdr(""); showFab(false);
    const b = B(), fm = foundForms(b);
    const total = TYPE_ORDER.length * 3 + 2 + SPECIALS.length;
    let got = 1 + (b.dadFound ? 1 : 0) + SPECIALS.filter(x => specialsOf()[x.id]).length;
    const egg = `<div class="card it"><div class="eg">${eggSVG(0.2, "normal")}</div><b>タマゴ</b><small>始まりの姿</small></div>`;
    const rows = TYPE_ORDER.map(k => {
      const slots = [1, 2, 3].map(n => {
        const ok = !!fm[k + "_" + n]; if (ok) got++;
        return `<div class="sl ${ok ? "" : "lock"}"><img src="${ok ? "c_" + k + "_" + n + ".webp" : BLANK}" alt="" draggable="false"><small>${STAGE_NAMES[n]}</small></div>`;
      }).join("");
      const any = [1, 2, 3].some(n => fm[k + "_" + n]);
      return `<div class="card cxrow ${any ? "" : "lockrow"}"><div class="cxh">${any ? `<b>${esc(TYPES[k].n)}</b><small>${esc(TYPES[k].l)}</small>` : `<b>？？？</b><small>${esc(hintOf(k))}</small>`}</div><div class="cxs">${slots}</div></div>`;
    }).join("");
    const dad = `<div class="card it ${b.dadFound ? "" : "lock"}"><img src="${b.dadFound ? DAD_IMG : BLANK}" alt="" draggable="false"><b>${b.dadFound ? "お父さん" : "？？？"}</b><small>${b.dadFound ? "休みが続くと現れる" : "かくれキャラ"}</small></div>`;
    $("#app").innerHTML = `<p class="muted">出会った姿が登録されます。（見つけた ${got} / ${total}）　タマゴ1＋11種×3段階＋かくれキャラ1＋特別なお助けキャラ</p><div class="cx2">${egg}${dad}${SPECIALS.map(x => { const ok = !!specialsOf()[x.id]; return `<div class="card it ${ok ? "" : "lock"}"><img src="${ok ? x.img : BLANK}" alt="" draggable="false"><b>${ok ? esc(x.n) : "？？？"}</b><small>${esc(x.hint)}</small></div>`; }).join("")}</div>${rows}`;
  }

  function toast(gain, kind) {
    if (!gain) return;
    const f = form();
    const old = document.querySelector(".bd-toast"); if (old) old.remove();
    const d = document.createElement("div"); d.className = "bd-toast";
    const pic = f.stage === 0 ? '<span class="eg">' + eggSVG(eggProgress(), "happy") + "</span>" : `<img src="${spriteSrc(f, "happy")}" alt="">`;
    d.innerHTML = `${pic}<span>${kind === "graded" ? "親の採点が入ったよ！" : "おつかれさま！"}　経験値 +${Math.round(gain)}</span>`;
    document.body.appendChild(d); setTimeout(() => d.remove(), 4200);
  }

  function evoOverlay(all) {
    const sps = all.filter(e => e.kind === "special").map(e => e.id), evs = all.filter(e => e.kind !== "special");
    if (!evs.length) { specialOverlay(sps, () => { if (location.hash === "" || location.hash === "#") route(); }); return; }
    const f = form(), hatch = evs.find(e => e.kind === "hatch");
    const o = document.createElement("div"); o.className = "bd-evo";
    document.body.appendChild(o);
    const done = () => { o.remove(); if (sps.length) specialOverlay(sps, () => { if (location.hash === "" || location.hash === "#") route(); }); else if (location.hash === "" || location.hash === "#") route(); };
    if (hatch) {
      const t = TYPES[hatch.type];
      o.innerHTML = `<div class="box"><h2>卵が ゆれている…！</h2><div class="bd-wrap big egg shake" style="margin:0 auto">${eggSVG(1, "normal")}</div></div>`;
      setTimeout(() => {
        o.innerHTML = `<div class="box"><h2>${esc(t.l)}が かえった！</h2>${sprite(true, f, {state: "happy"})}<div class="bd-name">${esc(t.n)}</div><p>これまでの経験値の割合で、この子が生まれました。図鑑にも登録されたよ。</p><button class="primary" id="bdOk">やったー！</button></div>`;
        o.querySelector("#bdOk").onclick = done;
      }, 1800);
      return;
    }
    const ev = evs.find(e => e.kind === "stage"), sn = STAGE_NAMES[f.stage];
    o.innerHTML = `<div class="box"><h2>${esc(sn)}に進化！</h2>${sprite(true, f, {state: "happy"})}<div class="bd-name">${esc(nameOf(f, "happy"))}</div><p>${ev && ev.from && ev.from !== ev.type ? "これまでの経験値の割合で、" + esc(TYPES[ev.from].n) + "から " + esc(TYPES[ev.type].l) + " に変わったよ！" : "がんばった分だけ、成長するよ。"}</p><button class="primary" id="bdOk">やったー！</button></div>`;
    o.querySelector("#bdOk").onclick = done;
  }


  /* ---------- 特別なお助けキャラ（条件をみたすとお助けキャラになる。あとから増やせる）---------- */
  const SPECIALS = [
    {id: "gp", n: "マッ○マン", img: "c_gp.webp", cut: "c_gp_cut.webp", skill: "マッ○マンパンチ", xp: 500, streak: 15, hint: "経験値500と、連続15日でお助けキャラになる",
     title: "続ける力のヒーロー", say: ["やっと会えたな！", "毎日続けてきた君の力、ずっと見ていたぞ。"]},
    {id: "mama", n: "女神ママテミス", img: "c_mama.webp", cut: "c_mama_cut.webp", skill: "ストロングリジェクション", cond: "god", hint: "全知全能の神に3回負けると、現れる",
     title: "母なる女神の加護", say: ["あらあら、神さまに負けちゃったの？", "大丈夫。ママの大すきな梅の力、見せてあげる！"]}
  ];
  const specialsOf = () => { const b = B(); b.specials = b.specials || {}; return b.specials; };
  const friendCount = () => (B().friends || []).length + Object.keys(specialsOf()).length;
  function checkSpecials(evs) {
    const b = B(), sp = specialsOf(); b.xpMax = Math.max(b.xpMax || 0, b.xp);
    const best = streakInfo().best;
    SPECIALS.forEach(s => { if (!s.cond && !sp[s.id] && b.xpMax >= s.xp && best >= s.streak) { sp[s.id] = todayStr(); evs.push({kind: "special", id: s.id}); } });
  }
  function specialOverlay(ids, done) {
    const id = ids[0], s = SPECIALS.find(x => x.id === id); if (!s) { if (done) done(); return; }
    const o = document.createElement("div"); o.className = "bd-evo"; document.body.appendChild(o);
    o.innerHTML = `<div class="bb-flash"></div><div class="box"><h2>新しいお助けキャラが 現れた！</h2><div class="bb-descend"><img class="bb-img" alt="" src="${s.img}"></div><div class="bd-name">${esc(s.n)}</div><div class="bd-rmsg" style="margin-top:10px"><b>「${esc(s.say[0])}」</b><p>${esc(s.say[1])}</p></div><div class="bd-rxp">称号GET：${esc(s.title)}</div><div class="row" style="justify-content:center;margin-top:12px"><button class="primary" id="spOk">次へ</button></div></div>`;
    o.querySelector("#spOk").onclick = () => { o.remove(); if (ids.length > 1) specialOverlay(ids.slice(1), done); else if (done) done(); };
  }

  /* ---------- BOSS ---------- */
  // 勝てる条件（習熟度は科目ごとに0〜100）。あとから数字だけ変えられる。
  //  stage：2＝成体／3＝究極進化　min：4科目すべてがこの値以上　avg：4科目の平均　mock：模擬Ⅰ・Ⅱの合計が究極進化の基準以上　friends：お助けキャラの数
  //  周回ごとに、min と avg が LAP_UP ずつ上がる（2周目＋10、3周目＋20…。上限100）
  const BOSS_CFG = {
    taurus:  {stage: 2},
    devil:   {stage: 2, min: 35, avg: 50},
    taurus2: {stage: 2, min: 42, avg: 56},
    dragon:  {stage: 3, min: 50, avg: 65},
    devil2:  {stage: 3, min: 58, avg: 72},
    dragon2: {stage: 3, min: 65, avg: 78},
    god:     {stage: 3, min: 72, avg: 84, mock: true, friends: 1}
  };
  const LAP_UP = 10;
  const GOD_LOSS_FOR_MAMA = 3;     // 神に3回負けると、女神ママテミスがお助けキャラになる（1日1回までカウント）
  // 挑戦できるのは「一番手前の、まだ倒していないBOSS」だけ（この並びが挑戦の順番）
  const BOSSES = [
    {id: "taurus", n: "半人前パパタウロス", img: "boss_1.webp", appear: "ブヒッ", lose: "おでに勝つなんてやるなぁ", win: "えっ、ザコ？", title: "ツノ折り見習い"},
    {id: "devil", n: "悪魔王パパモデウス", img: "boss_2.webp", appear: "太らせてやろうか", lose: "おれが負ける…だと", win: "ふはははっ、お前も悪魔になるか？", title: "悪魔退治の達人"},
    {id: "taurus2", n: "一人前パパタウロス", img: "boss_5.webp", appear: "もう半人前とは呼ばせん！", lose: "見事だ…一人前と認めよう", win: "まだまだ半人前だな", title: "一人前の壁を越えし者"},
    {id: "dragon", n: "龍王パパムート", img: "boss_3.webp", appear: "やっとここまで来たか", lose: "君がNo.1だ", win: "おれに勝とうなんて100年早いわ", title: "ドラゴンスレイヤー"},
    {id: "devil2", n: "真・悪魔王パパモデウス", img: "boss_6.webp", appear: "真の力を見せてやろう", lose: "真の力でも届かぬ…だと", win: "ふはははっ、もっと太らせてやる", title: "真・悪魔退治の達人"},
    {id: "dragon2", n: "真・龍王パパムート", img: "boss_7.webp", appear: "ここからが本当の戦いだ", lose: "見事だ、真の王者よ", win: "まだ早い。出直してこい", title: "真・ドラゴンスレイヤー"},
    {id: "god", n: "全知全能の神パパウス", img: "boss_4.webp", appear: "私を倒せば合格は間近だ", lose: "後は自分を信じて突き進め", win: "神は絶対です", title: "神に認められし者", bgm: "bgm_god.mp3"}
  ];
  BOSSES.forEach(x => { x.img += "?v=31"; });   // 画像を差し替えたときに古い絵が残らないよう、版の数字をつける（差し替えたら数字を上げる）
  const bossState = () => { const b = B(); b.boss = b.boss || {}; return b.boss; };
  const bossWon = id => !!(bossState()[id] && bossState()[id].won);

  /* ---------- 必殺技（5回目の攻撃）---------- */
  const SKILL_NAMES = {
    math: ["ひらめきパンチ", "ひらめきフラッシュ", "ジオメトリック・バースト"],
    science: ["ぴかぴかビーカー", "サイエンス・ビーム", "ミラクル・コスモス"],
    japanese: ["言葉のつぶて", "ことのは ふぶき", "奥義・百花繚乱言霊陣"],
    society: ["地図ポイ", "歴史のいかずち", "ワールド・ヒストリア"],
    math_science: ["星のそろばん", "ロジカル・ミーティア", "セレスティアル・ロジック"],
    math_japanese: ["ひらめきメロディ", "言葉×数 ハーモニー", "メルティック・ハーモニア"],
    math_society: ["データ・チャージ", "グラフ・ストライク", "ルークス・グランドマップ"],
    science_japanese: ["葉っぱのことのは", "リーフ・ポエム", "奥義・花鳥風月の生命詩"],
    science_society: ["地球どんどん", "テラ・クエイク", "ガイア・ストリーム"],
    japanese_society: ["ふるごとのささやき", "歴史語り・ソング", "メロディア・サーガ"],
    balance: ["にじいろのたま", "レインボー・スパーク", "オール・ルミナス"]
  };
  const skillOf = f => f.stage === 0 || !f.type ? "ころころアタック" : SKILL_NAMES[f.type][Math.min(3, f.stage) - 1];
  const SUBCOL = {math: "#3a7bff", science: "#2fb76a", japanese: "#e8467c", society: "#f08a24"};
  const colsOf = t => !t ? ["#bda8ff", "#ffd45c"] : t === "balance" ? ["#ff5a5a", "#ffd23a", "#4cc38a", "#3a7bff", "#b36bff"] : t.split("_").map(s => SUBCOL[s]);
  const skillImg = t => "skill_" + t + ".webp";

  /* ---------- お助けキャラ（旅立ったキャラ・特別なキャラ）---------- */
  const friendHelper = (t, key) => ({key: key, n: TYPES[t].n, img: skillImg(t), cut: "c_" + t + "_3_nb.webp", skill: SKILL_NAMES[t][2], type: t});
  const specialHelper = s => ({key: s.id, n: s.n, img: s.img, cut: s.cut || s.img, skill: s.skill, special: true});
  function helpers() {
    const out = [];
    (B().friends || []).forEach((x, i) => out.push(friendHelper(x.type, "f" + i)));
    SPECIALS.forEach(s => { if (specialsOf()[s.id]) out.push(specialHelper(s)); });
    return out;
  }

  function bossCheck(id, f) {
    f = f || form();
    const r = BOSS_CFG[id], prof = proficiency(), lacks = [], subs = [], up = (lap() - 1) * LAP_UP;
    const mn = r.min ? Math.min(100, r.min + up) : 0, av = r.avg ? Math.min(100, r.avg + up) : 0;
    if (f.stage < r.stage) lacks.push("stage");
    if (mn) SUBJ.forEach(s => { if (prof[s] < mn) subs.push(s); });
    if (av && SUBJ.reduce((a, s) => a + prof[s], 0) / SUBJ.length < av) lacks.push("avg");
    if (r.mock && !mockOk(lap())) lacks.push("mock");
    if (r.friends && friendCount() < r.friends) lacks.push("friends");
    return {ok: !lacks.length && !subs.length, lacks, subs, need: r, up};
  }
  function bossHint(c) {
    const a = ["勉強が足りないようだ。習熟度を上げて再挑戦しよう！"];
    if (c.lacks.includes("stage")) a.push("もっと成長（進化）してからおいで。");
    if (c.subs.length) a.push("特に「" + c.subs.map(s => SUBJN[s]).join("」「") + "」のパワーがたりないようだ。");
    else if (c.lacks.includes("avg")) a.push("4科目全体のパワーを、もう少し上げよう。");
    if (c.lacks.includes("mock")) a.push("模擬テスト（Ⅰ・Ⅱ）で力を試してみよう。");
    if (c.lacks.includes("friends")) a.push("お助けキャラを増やそう（今 " + friendCount() + " / " + c.need.friends + "）。");
    if (c.up > 0) a.push("今 " + lap() + " 周目。BOSSも 強くなっているよ。");
    return a;
  }
  function earnedTitles() {
    const t = [];
    BOSSES.forEach(x => { if (bossWon(x.id)) t.push({t: x.title, from: x.n + "を倒した"}); });
    SPECIALS.forEach(x => { if (specialsOf()[x.id]) t.push({t: x.title, from: x.n + "がお助けキャラになった"}); });
    return t;
  }
  function titlesHTML() {
    const e = earnedTitles(), total = BOSSES.length + SPECIALS.length;
    return `<h2>称号（${e.length} / ${total}）</h2><div class="card">${e.length ? e.map(x => `<div class="bd-ttl"><b>${esc(x.t)}</b><small>${esc(x.from)}</small></div>`).join("") : '<span class="muted">BOSSを倒したり、お助けキャラを増やすと、称号がもらえるよ。</span>'}</div>`;
  }

  /* ---------- 戦闘 ---------- */
  const ATK = [["算数", "math"], ["理科", "science"], ["国語", "japanese"], ["社会", "society"], ["総合", null]];
  // force: "auto"（本当の条件）／"ok"（全部成功）／"ng"（全部失敗）… 開発者モードのみ
  function bossAttacks(id, f, force) {
    const c = bossCheck(id, f), stageOk = !c.lacks.includes("stage");
    let res = SUBJ.map(sj => stageOk && !c.subs.includes(sj));
    res.push(stageOk && !c.lacks.some(x => x === "avg" || x === "mock" || x === "friends"));
    if (force === "ok") res = res.map(() => true); else if (force === "ng") res = res.map(() => false);
    return {c, res, win: res.every(Boolean)};
  }
  // 効果音（WebAudio。ファイルは使わない）。ポコスカ＝やわらかい打撃音の連打
  let actx = null;
  function ac() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); } catch (e) {} return actx; }
  let muted = false;
  function tone(t, f0, f1, dur, vol, type) {
    const a = ac(); if (!a || muted) return; const o = a.createOscillator(), g = a.createGain();
    o.type = type || "sine"; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(t, dur, vol, freq) {
    const a = ac(); if (!a || muted) return; const n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = a.createBufferSource(), fl = a.createBiquadFilter(), g = a.createGain(); fl.type = "bandpass"; fl.frequency.value = freq; fl.Q.value = 0.9;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.buffer = buf; src.connect(fl); fl.connect(g); g.connect(a.destination); src.start(t);
  }
  function sfxPokosuka() { const a = ac(); if (!a) return; const t = a.currentTime; for (let i = 0; i < 9; i++) { const k = t + i * 0.1; tone(k, 300 - (i % 3) * 40, 90, 0.09, 0.5); noise(k + 0.02, 0.07, 0.25, 1500 + (i % 2) * 900); } }
  function sfxHit() { const a = ac(); if (!a) return; const t = a.currentTime + 0.05; tone(t, 660, 990, 0.14, 0.25, "triangle"); tone(t + 0.12, 880, 1320, 0.22, 0.25, "triangle"); }
  function sfxMiss() { const a = ac(); if (!a) return; const t = a.currentTime + 0.05; tone(t, 220, 110, 0.3, 0.3, "sawtooth"); }
  function sfxWin() { const a = ac(); if (!a) return; const t = a.currentTime; [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.14, f, f * 1.01, 0.3, 0.3, "triangle")); }
  function sfxDon() { const a = ac(); if (!a) return; const t = a.currentTime + 0.02; tone(t, 180, 50, 0.3, 0.5); noise(t, 0.25, 0.4, 600); tone(t + 0.18, 880, 1320, 0.25, 0.22, "triangle"); }
  // 必殺技の効果音。型（科目）ごとに音色が違い、段階が上がるほど長く派手になる（幼体≈0.5秒／成体≈1秒／究極進化≈2秒）
  function sfxSkill(type, stage) {
    const a = ac(); if (!a) return; const t = a.currentTime + 0.02, n = stage >= 3 ? 3 : stage === 2 ? 2 : 1;
    const subs = !type ? ["math"] : type === "balance" ? ["bal"] : type.split("_");
    if (stage >= 3) { noise(t, 0.8, 0.35, 120); tone(t, 70, 40, 0.8, 0.4, "sawtooth"); }
    const t0 = t + (stage >= 3 ? 0.8 : 0);
    subs.forEach(s => {
      if (s === "math") { for (let i = 0; i < 3 * n; i++) { const f = 523 * Math.pow(1.122, i % 5); tone(t0 + i * 0.12, f, f * 1.01, 0.16, 0.25, "triangle"); } }
      else if (s === "science") { tone(t0, 300, 700 + 500 * n, 0.3 * n + 0.2, 0.22, "sawtooth"); tone(t0, 600, 1500 + 600 * n, 0.3 * n + 0.2, 0.12, "sine"); }
      else if (s === "japanese") { for (let i = 0; i < 2 * n; i++) { tone(t0 + i * 0.22, 1318, 1320, 0.5, 0.2, "sine"); tone(t0 + i * 0.22, 1976, 1980, 0.4, 0.1, "sine"); } }
      else if (s === "society") { for (let i = 0; i < 2 * n + 1; i++) { tone(t0 + i * 0.2, 140, 50, 0.18, 0.5, "sine"); noise(t0 + i * 0.2, 0.1, 0.3, 250); } }
      else { [523, 587, 659, 698, 784, 880, 988, 1047].slice(0, 3 + 2 * n).forEach((f, i) => tone(t0 + i * 0.1, f, f * 1.01, 0.2, 0.22, "triangle")); }
    });
    if (stage >= 2) { const tb = t0 + (stage >= 3 ? 0.9 : 0.4); tone(tb, 220, 40, 0.6, 0.5); noise(tb, 0.5, 0.4, 400); }
  }
  let bgm = null;
  let bgmFile = "";
  function bgmStart(file) { try { file = file || "bgm_battle.mp3"; if (bgm && bgmFile !== file) { bgm.pause(); bgm = null; } if (!bgm) { bgm = new Audio(file); bgmFile = file; bgm.loop = true; bgm.volume = 0.5; } bgm.muted = muted; bgm.currentTime = 0; const p = bgm.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
  function bgmStop() { try { if (bgm) { bgm.pause(); bgm.currentTime = 0; } } catch (e) {} }

  // カットイン（必殺技・お助けキャラ共通）。画面をタップするとすぐ終わる。戻り値＝いますぐ終わらせる関数
  function cutIn(layer, o, done) {
    const el = document.createElement("div"); el.className = "bb-ci" + (o.helper ? " hp" : "");
    el.style.setProperty("--c1", o.cols[0]); el.style.setProperty("--c2", o.cols[o.cols.length - 1]);
    el.innerHTML = `<div class="bb-ci-bg"></div><div class="bb-ci-rays"></div><img class="bb-ci-img" alt="" draggable="false" src="${o.img}"><div class="bb-ci-txt"><small>${esc(o.who)}</small><b>${esc(o.title)}</b></div>`;
    const im = el.querySelector("img"); im.onerror = () => { im.onerror = null; if (o.alt) im.src = o.alt; };
    layer.innerHTML = ""; layer.appendChild(el);
    let fin = false, tm;
    const end = () => { if (fin) return; fin = true; clearTimeout(tm); el.classList.add("out"); setTimeout(() => { el.remove(); if (done) done(); }, 220); };
    tm = setTimeout(end, o.ms); el.onclick = end;
    if (o.sfx) o.sfx();
    return end;
  }

  // カード召喚：カードが奥から回って飛んできて、光って割れ、キャラが前に飛び出す（2枚の絵だけで作る3D風の演出）
  function summon(o, f, done) {
    const src = spriteSrc(f, "normal"), cols = colsOf(f.type);
    o.className = "bd-evo bb-battle";
    o.innerHTML = `<div class="bb-sum" style="--c1:${cols[0]};--c2:${cols[cols.length - 1]}"><div class="bb-sum-bg"></div><div class="bb-card"><div class="face l"><img src="${src}" alt="" draggable="false"></div><div class="face r"><img src="${src}" alt="" draggable="false"></div></div><div class="bb-sum-flash"></div><img class="bb-sum-me" src="${meSrc(f)}" alt="" draggable="false"><div class="bb-sum-name">${esc(nameOf(f, "normal"))}</div></div>`;
    const sm = o.querySelector(".bb-sum-me"); if (sm) fixImg(sm, src);
    let fin = false;
    const end = () => { if (fin) return; fin = true; clearTimeout(tm); done(); };
    const tm = setTimeout(end, 3300); setTimeout(() => { if (!fin) o.onclick = end; }, 400);   // 押したクリックがそのまま届いて飛ばされないよう、少しあとから「タップで飛ばす」を有効にする
    try { const a = ac(); if (a) { const t = a.currentTime; noise(t, 1.4, 0.18, 300); tone(t + 1.5, 400, 1600, 0.4, 0.3, "triangle"); tone(t + 1.55, 120, 40, 0.4, 0.4); } } catch (e) {}
  }

  function bossFight(id, opt) {
    opt = opt || {};
    const dev = !!opt.dev, bo = BOSSES.find(x => x.id === id), st = bossState();
    const resume = (id === "god" && !dev && !bossWon("god")) ? ((st.god && st.god.phase) || 1) : 1;   // 途中まで進んでいたら、その形態から再開
    const f = opt.form || form(), H = dev ? (opt.helpers || []) : helpers(), force = dev ? (opt.force || "auto") : "auto";
    const o = document.createElement("div"); o.className = "bd-evo"; document.body.appendChild(o);
    const back = () => { bgmStop(); o.remove(); if (dev) devSelect(id, opt); else boss(); };
    const img = cls => `<img class="bb-img ${cls || ""}" alt="" draggable="false" src="${bo.img}">`;
    o.innerHTML = `<div class="box"><div class="bb-name">${esc(bo.n)}</div>${dev ? '<div class="bd-sub">開発者モード（記録は残りません）</div>' : ""}<div class="bb-appear">${img()}</div><div class="bd-rmsg"><b>「${esc(bo.appear)}」</b>${resume > 1 ? `<p>続きから：第${resume}形態</p>` : ""}</div><div class="row" style="justify-content:center;gap:10px;margin-top:12px"><button class="primary" id="bbGo">${id === "god" ? "神に挑戦する！" : "挑戦する！"}</button><button id="bbNo">やめておく</button></div></div>`;
    o.querySelector("#bbNo").onclick = back;
    o.querySelector("#bbGo").onclick = () => { ac(); bgmStart(bo.bgm); if (resume > 1) { o.remove(); godSeq(resume, false); return; } if (f.stage > 0) summon(o, f, battle); else battle(); };

    function battle() {
      o.onclick = null;
      const A = bossAttacks(id, f, force);
      if (!dev) { st[id] = st[id] || {tries: 0}; st[id].tries = (st[id].tries || 0) + 1; persist(); }
      let n = 0, hp = 5; const cols = colsOf(f.type);
      o.className = "bd-evo bb-battle";
      const me = f.stage === 0 ? `<div class="bb-me egg">${eggSVG(1, "normal")}</div>` : `<img class="bb-me" alt="" draggable="false" src="${meSrc(f)}">`;
      const fixMe = () => { const im = o.querySelector("img.bb-me"); if (im) fixImg(im, spriteSrc(f, "normal")); };
      o.innerHTML = `<div class="bb-bt" style="--c1:${cols[0]};--c2:${cols[cols.length - 1]}">
        <div class="bb-top"><b>${esc(bo.n)}</b><span class="bb-hp">${[0, 1, 2, 3, 4].map(() => "<i></i>").join("")}</span>${dev ? '<span class="bb-dev">DEV</span>' : ""}<button id="bbMute" class="ghost" style="color:#fff">${muted ? "🔇" : "🔊"}</button></div>
        <div class="bb-stage${id === "god" ? " god" : ""}"><div class="bb-bgfx"></div><img class="bb-boss" alt="" draggable="false" src="${bo.img}"><img class="bb-fx" alt="" draggable="false" src="fx_fight.webp">${me}<div class="bb-pop"></div><div class="bb-flashfx"></div><div class="bb-cutlayer"></div></div>
        <div class="bb-panel"><div class="bb-msg" id="bbMsg">「${esc(bo.appear)}」</div>
        <div class="bb-dots">${ATK.map((a, i) => `<span data-i="${i}">${a[0]}</span>`).join("")}</div>
        <div class="row" style="justify-content:center;margin-top:10px"><button class="primary bb-atk" id="bbAtk"></button></div></div></div>`;
      const q = s => o.querySelector(s); fixMe();
      const hpEl = o.querySelectorAll(".bb-hp i"), dots = o.querySelectorAll(".bb-dots span"), msg = q("#bbMsg"), btn = q("#bbAtk"), bimg = q(".bb-boss"), fx = q(".bb-fx"), pop = q(".bb-pop"), meEl = q(".bb-me"), layer = q(".bb-cutlayer"), flash = q(".bb-flashfx"), stageEl = q(".bb-stage");
      q("#bbMute").onclick = e => { muted = !muted; e.target.textContent = muted ? "🔇" : "🔊"; if (bgm) bgm.muted = muted; };
      const label = () => { btn.textContent = n < 4 ? "⚔ " + ATK[n][0] + "の力で こうげき！" : "⚔ 必殺技！ " + skillOf(f); btn.disabled = false; };
      const hitFx = () => {
        sfxPokosuka(); fx.classList.remove("go"); void fx.offsetWidth; fx.classList.add("go");
        bimg.classList.remove("shake"); void bimg.offsetWidth; bimg.classList.add("shake");
        flash.classList.remove("go"); void flash.offsetWidth; flash.classList.add("go");
      };
      label(); dots[0].classList.add("cur");

      // 4回目のあと：お助けキャラが全員カットインして攻撃（演出だけ。勝ち負けには影響しない）
      function helperSeq(done) {
        let i = 0, skipped = false, cur = null;
        const sk = document.createElement("button"); sk.className = "bb-skip"; sk.textContent = "飛ばす ▶▶"; stageEl.appendChild(sk);
        sk.onclick = () => { skipped = true; if (cur) cur(); };
        const next = () => {
          if (skipped || i >= H.length) { sk.remove(); layer.innerHTML = ""; done(); return; }
          const h = H[i++]; msg.textContent = h.n + "が かけつけた！　" + h.skill + "！";
          cur = cutIn(layer, {who: h.n, title: h.skill, img: h.cut, alt: h.img, cols: ["#ffd23a", "#ff7a3a"], ms: 1500, helper: true, sfx: sfxDon}, () => {
            bimg.classList.remove("shake"); void bimg.offsetWidth; bimg.classList.add("shake"); flash.classList.remove("go"); void flash.offsetWidth; flash.classList.add("go");
            setTimeout(next, 200);
          });
        };
        msg.textContent = "その時…！ お助けキャラが かけつけた！";
        setTimeout(next, 700);
      }

      btn.onclick = () => {
        btn.disabled = true; ac();
        const ok = A.res[n], k = n; n++;
        const run = () => {
          meEl.classList.remove("dash"); void meEl.offsetWidth; meEl.classList.add("dash");
          msg.textContent = (k < 4 ? ATK[k][0] + "の力で こうげき！" : skillOf(f) + "！") + "　ポコスカ ポコスカ！";
          setTimeout(hitFx, 280);
          setTimeout(resolve, 1400);
        };
        if (k === 4) {
          msg.textContent = f.stage === 0 ? "ころころアタック！" : "必殺技！ " + skillOf(f);
          const ms = f.stage >= 3 ? 2400 : f.stage === 2 ? 1400 : 900;
          cutIn(layer, {who: nameOf(f, "normal"), title: skillOf(f), img: f.stage >= 3 ? skillImg(f.type) : (f.stage === 0 ? "" : spriteSrc(f, "normal")), alt: f.stage === 0 ? "" : spriteSrc(f, "normal"), cols: cols, ms: ms, sfx: () => sfxSkill(f.type, f.stage)}, run);
        } else run();
        function resolve() {
          dots[k].classList.remove("cur"); dots[k].classList.add(ok ? "ok" : "ng");
          if (ok) { sfxHit(); hp--; hpEl[hp].classList.add("off"); pop.textContent = "成功！"; pop.className = "bb-pop ok"; msg.textContent = (k < 4 ? ATK[k][0] + "の力が" : "必殺技が") + " 決まった！"; }
          else { sfxMiss(); pop.textContent = "かわされた…"; pop.className = "bb-pop ng"; msg.textContent = (k < 4 ? "「" + ATK[k][0] + "」のこうげきは かわされた！" : "必殺技は かわされた！"); }
          if (n < 5) {
            dots[n].classList.add("cur");
            const go = () => { pop.className = "bb-pop"; label(); };
            if (n === 4 && H.length) setTimeout(() => { pop.className = "bb-pop"; helperSeq(go); }, 1000); else setTimeout(go, 1100);
          } else setTimeout(finish, 1500);
        }
      };

      function finish() {
        if (A.win && id === "god") {   // 神の第1形態を倒したら、そのまま第2形態へ（BGMは止めない）
          if (!dev && !bossWon("god")) { st.god = st.god || {tries: 0}; st.god.phase = Math.max(st.god.phase || 1, 2); persist(); }
          o.remove(); godSeq(2, dev); return;
        }
        bgmStop();
        if (!A.win) {
          let mama = false;
          if (!dev && id === "god") {
            const g = st.god = st.god || {tries: 0}; g.losses = g.losses || 0;
            if (g.lossDay !== todayStr()) { g.lossDay = todayStr(); g.losses++; }
            if (g.losses >= GOD_LOSS_FOR_MAMA && !specialsOf().mama) { specialsOf().mama = todayStr(); mama = true; }
            persist();
          }
          o.className = "bd-evo";
          o.innerHTML = `<div class="box"><div class="bb-name">${esc(bo.n)}</div><div class="bb-appear">${img()}</div><div class="bd-rmsg"><b>「${esc(bo.win)}」</b>${bossHint(A.c).map(x => `<p>${esc(x)}</p>`).join("")}</div><div class="bd-rxp">失うものは 何もないよ。力をためて、また来よう！</div><div class="row" style="justify-content:center;margin-top:12px"><button class="primary" id="bbBk">戻る</button></div></div>`;
          o.querySelector("#bbBk").onclick = () => { if (mama) { o.remove(); specialOverlay(["mama"], boss); } else back(); };
          return;
        }
        const first = !dev && !st[id].won; if (!dev) { st[id].won = st[id].won || todayStr(); persist(); } sfxWin();
        o.className = "bd-evo";
        o.innerHTML = `<div class="box"><div class="bb-flash"></div><h2>BOSSを倒した！</h2><div class="bb-appear">${img("bb-down")}</div><div class="bd-rmsg"><b>「${esc(bo.lose)}」</b></div>${first ? `<div class="bd-rxp">称号GET：<b>${esc(bo.title)}</b></div>` : (dev ? '<div class="bd-rxp">開発者モード：記録は残していません</div>' : "")}<div class="row" style="justify-content:center;margin-top:12px"><button class="primary" id="bbNx">次へ</button></div></div>`;
        o.querySelector("#bbNx").onclick = () => {
          if (dev) { back(); return; }
          o.remove();
          if (first && id === "dragon2") godDescent(); else if (first && id === "god") toBeContinued(); else boss();
        };
      }
    }
  }

  // 神降臨：龍王パパムートを初めて倒したときの演出。この後「神に挑戦」が選べるようになる
  function godDescent(dev) {
    const bo = BOSSES.find(x => x.id === "god"), b = B(); if (!dev) { b.godSeen = todayStr(); persist(); }
    const o = document.createElement("div"); o.className = "bd-evo"; document.body.appendChild(o);
    const close = () => { o.remove(); boss(); };
    o.innerHTML = `<div class="box" style="background:#101a33;color:#fff"><h2 style="color:#fff">これで 全部 倒した……と 思いきや</h2><p style="font-size:20px;margin:30px 0">…… 空が、光り始めた ……</p></div>`;
    setTimeout(() => {
      o.innerHTML = `<div class="bb-flash"></div><div class="box"><h2>神が 降臨した！</h2><div class="bb-descend"><img class="bb-img" alt="" src="${bo.img}"></div><div class="bb-name">${esc(bo.n)}</div><div class="bd-rmsg"><b>「汝、更なる力を求めるか？」</b></div><div class="row" style="justify-content:center;margin-top:12px"><button class="primary" id="gdOk">次へ</button></div></div>`;
      o.querySelector("#gdOk").onclick = power;
    }, 2400);
    function power() {
      o.className = "bd-evo bb-powerbg";
      o.innerHTML = `<div class="bb-power"><img class="bb-img" alt="" src="${bo.img}"><div class="bb-power-t">ゴゴゴゴゴ……！</div></div>`;
      try { const a = ac(); if (a) { const t = a.currentTime; noise(t, 1.6, 0.4, 100); tone(t, 80, 40, 1.6, 0.45, "sawtooth"); tone(t + 1.5, 200, 40, 0.8, 0.5); } } catch (e) {}
      setTimeout(() => {
        o.className = "bd-evo";
        o.innerHTML = `<div class="box"><div class="bb-appear"><img class="bb-img" alt="" src="${bo.img}"></div><div class="bd-rmsg"><b>神が 圧倒的な力を 見せつけた……！</b><p>相手は神です。今のままでは勝てません。力をつけてチャレンジしましょう。</p></div><div class="row" style="justify-content:center;margin-top:12px"><button class="primary" id="gdBk">戻る</button></div></div>`;
        o.querySelector("#gdBk").onclick = close;
      }, 2800);
    }
  }
  function toBeContinued(dev) {
    if (!dev) { const b = B(); b.cleared = todayStr(); persist(); }
    const o = document.createElement("div"); o.className = "bb-tbc"; document.body.appendChild(o);
    o.innerHTML = `<div><div class="t">To Be Continued...</div><p>ここまで来た 君へ。続きは、また 後で。</p><button id="tbcOk">戻る</button></div>`;
    o.querySelector("#tbcOk").onclick = () => { o.remove(); boss(); };
  }


  /* ---------- 神パパウス 第2・第3形態 ---------- */
  // 第1形態（いつもの戦闘）を倒すと、そのまま第2形態（4択クイズ）→第3形態（最後の問い）へ進む。
  // 途中で終わった場合は、次回その形態から再開する（b.boss.god.phase）。BGMは止めずに流し続ける。
  const GOD2_SEC = 0;   // 第2形態：1問あたりの制限時間（秒）。0＝制限なし（あとで使いたいときは数字を入れる）
  const GOD_IMG = {b2: "bg_god2.webp?v=32", f2: "boss_8.webp?v=32", b3: "bg_god3.webp?v=32", f3: "boss_9.webp?v=32"};
  const GODQ = {
    math: [
      {q: "時速36kmで走る車は、秒速何mで進んでいますか。", c: ["6m", "10m", "12m", "36m"], a: 1, e: "36km＝36000m、1時間＝3600秒なので、36000÷3600＝10m。"},
      {q: "3/4 ÷ 3/8 を計算すると、いくつになりますか。", c: ["1/2", "2", "9/32", "3"], a: 1, e: "わる数の逆数をかけて、3/4 × 8/3 ＝ 2。"},
      {q: "半径4cmの円の面積は何cm²ですか。（円周率は3.14）", c: ["25.12", "50.24", "12.56", "100.48"], a: 1, e: "4×4×3.14＝50.24。"},
      {q: "定価1500円の品物を、2割引きで売ると、売る値段はいくらですか。", c: ["1000円", "1200円", "1300円", "300円"], a: 1, e: "2割引きは8割の値段。1500×0.8＝1200円。"},
      {q: "ある数に5をたしてから3倍したら42になりました。ある数はいくつですか。", c: ["7", "9", "11", "14"], a: 1, e: "42÷3＝14、14−5＝9。"}
    ],
    science: [
      {q: "水が氷になると、体積はどうなりますか。", c: ["大きくなる", "小さくなる", "変わらない", "いったん小さくなってから大きくなる"], a: 0, e: "水は氷になると、体積がおよそ1.1倍に大きくなる。"},
      {q: "植物が日光を受けて養分をつくるとき、外に出す気体はどれですか。", c: ["酸素", "二酸化炭素", "ちっ素", "水素"], a: 0, e: "光合成では二酸化炭素を取り入れ、酸素を出す。"},
      {q: "月の形が日によって変わって見えるのは、なぜですか。", c: ["月が自分で光る強さが変わるから", "地球のかげが毎日ちがう形で月に落ちるから", "太陽・地球・月の位置関係が変わり、光が当たって見える部分が変わるから", "月が小さくなったり大きくなったりするから"], a: 2, e: "月は太陽の光を反射している。位置関係が変わるので、見える形も変わる。"},
      {q: "てこで、支点から左へ20cmの所に30gのおもりをつるしました。右へ40cmの所に何gのおもりをつるすと、つり合いますか。", c: ["10g", "15g", "30g", "60g"], a: 1, e: "30×20＝600。600÷40＝15g。"},
      {q: "人の血液の中で、酸素を運ぶはたらきをするのはどれですか。", c: ["赤血球", "白血球", "血小板", "血しょう"], a: 0, e: "赤血球のヘモグロビンが酸素を運ぶ。"}
    ],
    japanese: [
      {q: "「油を売る」の意味として正しいものはどれですか。", c: ["商売で大もうけをする", "仕事の途中で、むだ話をしてなまける", "一生けんめい働く", "人にものを売りつける"], a: 1, e: "昔、油売りが客と世間話をしながら売ったことから。"},
      {q: "四字熟語「（　）機一転」の（　）に入る漢字はどれですか。", c: ["心", "新", "神", "進"], a: 1, e: "「心機一転」。あることをきっかけに、気持ちをすっかり入れかえること。"},
      {q: "「雨がふったので、遠足は中止になった。」の「ので」は、どんな関係を表していますか。", c: ["原因・理由", "逆の内容", "つけ加え", "条件"], a: 0, e: "「雨がふった」ことが、「中止」の理由になっている。"},
      {q: "「具体」の対義語（反対の意味の言葉）はどれですか。", c: ["抽象", "具象", "実際", "全体"], a: 0, e: "具体⇔抽象。"},
      {q: "「先生が来る」を尊敬語で言うと、どれが正しいですか。", c: ["参る", "いらっしゃる", "申し上げる", "うかがう"], a: 1, e: "「参る」「うかがう」は自分をへりくだる言い方。「いらっしゃる」が尊敬語。"}
    ],
    society: [
      {q: "日本国憲法の三つの原則にふくまれないものはどれですか。", c: ["国民主権", "基本的人権の尊重", "平和主義", "三権分立"], a: 3, e: "三つの原則は、国民主権・基本的人権の尊重・平和主義。"},
      {q: "鎌倉幕府を開いた人物はだれですか。", c: ["源義経", "源頼朝", "平清盛", "北条時宗"], a: 1, e: "1192年ごろ、源頼朝が征夷大将軍になった。"},
      {q: "次のうち、国会の仕事として正しいものはどれですか。", c: ["法律をつくる", "裁判をおこなう", "外国と条約をむすぶ", "内閣総理大臣が政治の仕事を実行する"], a: 0, e: "国会は国の唯一の立法機関。裁判は裁判所、条約をむすぶのは内閣。"},
      {q: "面積がもっとも大きい都道府県はどれですか。", c: ["岩手県", "北海道", "長野県", "新潟県"], a: 1, e: "北海道は全国でいちばん広い。"},
      {q: "「持続可能な開発目標（SDGs）」が、達成の目標としている年はいつですか。", c: ["2025年", "2030年", "2040年", "2050年"], a: 1, e: "2015年に決まり、2030年までに達成をめざす。"}
    ]
  };
  const GODQ_LABEL = {math: "算数", science: "理科", japanese: "国語", society: "社会"};
  const shuffle = a => { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
  function sfxThunder() { const a = ac(); if (!a) return; const t = a.currentTime; noise(t, 0.12, 0.55, 3000); noise(t + 0.05, 0.9, 0.5, 160); tone(t + 0.05, 90, 35, 0.9, 0.45, "sawtooth"); }
  function bolts() {
    let s = "";
    for (let n = 0, m = 2 + Math.floor(Math.random() * 2); n < m; n++) {
      let x = 8 + Math.random() * 84; const pts = [];
      for (let y = 0; y <= 100; y += 7) { pts.push(x.toFixed(1) + "," + y); x += (Math.random() - 0.5) * 18; }
      s += `<polyline points="${pts.join(" ")}"/>`;
    }
    return s;
  }
  // 神の戦闘画面（全画面）：背景・神・稲妻・光・下の操作エリア
  function godStage(o, cls, bg, boss) {
    o.className = "bd-evo bb-battle";
    o.innerHTML = `<div class="g-stage ${cls}" style="background-image:url(${bg})"><img class="g-boss" alt="" draggable="false" src="${boss}"><svg class="g-bolt" viewBox="0 0 100 100" preserveAspectRatio="none"></svg><div class="g-flash"></div><div class="g-ui"></div></div>`;
    return o.querySelector(".g-stage");
  }
  function say(ui, text, next, label) {
    ui.innerHTML = `<div class="g-say">${esc(text)}</div><div class="row" style="justify-content:center"><button class="primary" id="gNx">${esc(label || "つぎへ")}</button></div>`;
    ui.querySelector("#gNx").onclick = next;
  }
  function thunder(st, n, done) {
    const svg = st.querySelector(".g-bolt"), fl = st.querySelector(".g-flash"); let k = 0;
    const hit = () => {
      svg.innerHTML = bolts(); fl.classList.remove("go"); void fl.offsetWidth; fl.classList.add("go"); sfxThunder();
      st.classList.remove("quake"); void st.offsetWidth; st.classList.add("quake");
      if (++k < n) setTimeout(hit, 240 + Math.random() * 220); else setTimeout(() => { svg.innerHTML = ""; if (done) done(); }, 700);
    };
    hit();
  }
  // 神に負けた回数を数える（1日1回まで）。3回で女神ママテミスがお助けキャラに。戻り値＝いま加入したか
  function godLossCount() {
    const st = bossState(), g = st.god = st.god || {tries: 0}; g.losses = g.losses || 0;
    if (g.lossDay !== todayStr()) { g.lossDay = todayStr(); g.losses++; }
    let mama = false;
    if (g.losses >= GOD_LOSS_FOR_MAMA && !specialsOf().mama) { specialsOf().mama = todayStr(); mama = true; }
    persist(); return mama;
  }
  function godSeq(ph, dev) {
    const st0 = bossState(), o = document.createElement("div"); document.body.appendChild(o);
    const leave = () => { bgmStop(); o.remove(); boss(); };
    const keep = n => { if (!dev && !bossWon("god")) { st0.god = st0.god || {tries: 0}; st0.god.phase = Math.max(st0.god.phase || 1, n); persist(); } };
    if (ph === 2) form2(); else form3();

    // ---- 第2形態：4科目の4択クイズ。ぜんぶ正解で勝ち ----
    function form2() {
      const st = godStage(o, "p2", GOD_IMG.b2, GOD_IMG.f2), ui = st.querySelector(".g-ui");
      say(ui, "「ほう、人の身でここまでたどり着くとは」", () => {
        ui.innerHTML = "";
        thunder(st, 4, () => say(ui, "「ならば本気を出そう！ 汝の学びが本物であることを証明せよ」", quiz, "挑戦する！"));
      });
      function quiz() {
        const Q = SUBJ.map(s => { const it = GODQ[s][Math.floor(Math.random() * GODQ[s].length)], idx = shuffle(it.c.map((_, k) => k)); return {label: GODQ_LABEL[s], q: it.q, e: it.e, c: idx.map(k => it.c[k]), a: idx.indexOf(it.a)}; });
        let i = 0; const res = []; let timer = null;
        const show = () => {
          const it = Q[i]; clearInterval(timer);
          ui.innerHTML = `<div class="g-hd"><b>第${i + 1}問／4　${esc(it.label)}</b><span class="g-dots">${Q.map((_, k) => `<i class="${k < res.length ? (res[k] ? "ok" : "ng") : ""}"></i>`).join("")}</span></div>${GOD2_SEC ? '<div class="g-time"><i></i></div>' : ""}<div class="g-q">${esc(it.q)}</div><div class="g-ch">${it.c.map((c, k) => `<button data-k="${k}"><span>${"アイウエ"[k]}</span>${esc(c)}</button>`).join("")}</div>`;
          const btns = ui.querySelectorAll(".g-ch button");
          btns.forEach(b => b.onclick = () => answer(+b.dataset.k));
          if (GOD2_SEC) { let left = GOD2_SEC * 10; const bar = ui.querySelector(".g-time i"); timer = setInterval(() => { left--; bar.style.width = (left / (GOD2_SEC * 10) * 100) + "%"; if (left <= 0) { clearInterval(timer); answer(-1); } }, 100); }
        };
        const answer = k => {
          clearInterval(timer); const it = Q[i], ok = k === it.a; res.push(ok);
          const btns = ui.querySelectorAll(".g-ch button"); btns.forEach((b, j) => { b.disabled = true; if (j === it.a) b.classList.add("right"); else if (j === k) b.classList.add("wrong"); });
          ui.querySelectorAll(".g-dots i")[i].className = ok ? "ok" : "ng";
          const fb = document.createElement("div"); fb.className = "g-fb " + (ok ? "ok" : "ng");
          fb.innerHTML = `<b>${ok ? "正解！" : (k < 0 ? "時間切れ…" : "不正解…")}</b> ${esc(it.e)}<div class="row" style="justify-content:center;margin-top:8px"><button class="primary" id="gQn">${i < 3 ? "つぎへ" : "結果へ"}</button></div>`;
          ui.appendChild(fb);
          if (ok) { sfxHit(); const bs = st.querySelector(".g-boss"); bs.classList.remove("hit"); void bs.offsetWidth; bs.classList.add("hit"); const fl = st.querySelector(".g-flash"); fl.classList.remove("go"); void fl.offsetWidth; fl.classList.add("go"); } else sfxMiss();
          fb.querySelector("#gQn").onclick = () => { i++; if (i < 4) show(); else finish2(); };
        };
        const finish2 = () => {
          if (res.every(Boolean)) {
            sfxWin(); keep(3);
            say(ui, "「見事だ、しっかりと身についておる」", () => { o.remove(); godSeq(3, dev); });
          } else {
            const mama = dev ? false : godLossCount();
            say(ui, "「勉強が足りぬ、次こそは我を超えてみろ」", () => { if (mama) { bgmStop(); o.remove(); specialOverlay(["mama"], boss); } else leave(); }, "もどる");
          }
        };
        show();
      }
    }

    // ---- 第3形態：最後の問い（どんな答えでも勝てる）----
    function form3() {
      const st = godStage(o, "p3 rise", GOD_IMG.b3, GOD_IMG.f3), ui = st.querySelector(".g-ui");
      try { const a = ac(); if (a) { const t = a.currentTime; noise(t, 2.6, 0.22, 140); tone(t, 60, 120, 2.6, 0.3, "sine"); tone(t + 2.4, 300, 900, 0.8, 0.2, "triangle"); } } catch (e) {}
      setTimeout(() => {
        st.classList.remove("rise");
        say(ui, "「さあ、最後の問いだ」", () => {
          ui.innerHTML = `<div class="g-say">「汝、津山中学に行って何を成す？」</div><textarea id="gWish" rows="3" maxlength="200" placeholder="ここに答えを書こう"></textarea><div class="row" style="justify-content:center"><button class="primary" id="gAns" disabled>答える</button></div>`;
          const ta = ui.querySelector("#gWish"), bt = ui.querySelector("#gAns");
          ta.oninput = () => { bt.disabled = !ta.value.trim(); };
          bt.onclick = () => {
            if (!dev) { const b = B(); b.godWish = {text: ta.value.trim(), date: todayStr()}; persist(); }
            const L = ["「そうか、それが汝の望みか」", "「ならば進め。汝の未来は、汝自身の手で切り拓くのだ。」", "「合格を祈っている」"];
            let n = 0; const next = () => { if (n < L.length) say(ui, L[n++], next, n < L.length ? "つぎへ" : "終わる"); else clear(); }; next();
          };
        }, "答える準備ができた");
      }, 3200);
      const clear = () => {
        sfxWin(); bgmStop();
        const first = !dev && !bossWon("god");
        if (!dev) { const g = st0.god = st0.god || {tries: 0}; g.won = g.won || todayStr(); delete g.phase; B().cleared = todayStr(); persist(); }
        const bo = BOSSES.find(x => x.id === "god");
        o.className = "bd-evo";
        o.innerHTML = `<div class="box"><div class="bb-flash"></div><h2>神に認められた！</h2><div class="bb-appear"><img class="bb-img" alt="" src="${GOD_IMG.f3}"></div>${first ? `<div class="bd-rxp">称号GET：<b>${esc(bo.title)}</b></div>` : (dev ? '<div class="bd-rxp">開発者モード：記録は残していません</div>' : "")}<div class="row" style="justify-content:center;margin-top:12px"><button class="primary" id="gEnd">もどる</button></div></div>`;
        o.querySelector("#gEnd").onclick = () => { o.remove(); boss(); };
      };
    }
  }
  const css3 = document.createElement("style");
  css3.textContent = `
  .g-stage{position:absolute;inset:0;background:#06102a center/cover no-repeat;overflow:hidden;color:#fff}
  .g-boss{position:absolute;left:50%;transform:translateX(-50%);object-fit:contain;filter:drop-shadow(0 0 28px rgba(255,236,170,.7));pointer-events:none;-webkit-touch-callout:none;user-select:none}
  .p2 .g-boss{top:1%;height:46%;max-width:96%;animation:bbFloat 4.2s ease-in-out infinite}
  .p2 .g-boss.hit{animation:bbHit .9s ease-in-out}
  .p3 .g-boss{top:-6%;height:auto;width:min(138vw,130vh);max-width:none;animation:gRise 3.2s ease-out both}
  .p3:not(.rise) .g-boss{animation:bbFloat 5s ease-in-out infinite}
  @keyframes gRise{0%{transform:translateX(-50%) scale(.12);opacity:0;filter:brightness(3) blur(8px)}60%{opacity:1}100%{transform:translateX(-50%) scale(1);opacity:1;filter:drop-shadow(0 0 28px rgba(255,236,170,.7))}}
  .g-bolt{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
  .g-bolt polyline{fill:none;stroke:#e6f2ff;stroke-width:3;vector-effect:non-scaling-stroke;stroke-linejoin:round;filter:drop-shadow(0 0 6px #6fb2ff) drop-shadow(0 0 14px #9cc9ff)}
  .g-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none}
  .g-flash.go{animation:gFlash .55s ease-out}
  @keyframes gFlash{0%{opacity:.95}100%{opacity:0}}
  .g-stage.quake{animation:gQuake .4s linear}
  @keyframes gQuake{0%,100%{transform:none}20%{transform:translate(-6px,4px)}40%{transform:translate(6px,-4px)}60%{transform:translate(-4px,-3px)}80%{transform:translate(4px,3px)}}
  .g-ui{position:absolute;left:0;right:0;bottom:0;padding:14px 14px calc(14px + env(safe-area-inset-bottom));background:linear-gradient(180deg,rgba(6,14,40,0),rgba(6,14,40,.82) 22%,rgba(6,14,40,.92));max-height:62%;overflow:auto}
  .g-say{font-size:19px;font-weight:700;line-height:1.6;text-align:center;margin:8px 4px 12px;text-shadow:0 2px 6px #000}
  .g-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
  .g-dots{display:flex;gap:6px}.g-dots i{width:16px;height:16px;border-radius:50%;background:#3a3f55;display:block}.g-dots i.ok{background:#4cc38a}.g-dots i.ng{background:#ff5a5a}
  .g-time{height:8px;border-radius:4px;background:#2a3050;overflow:hidden;margin-bottom:6px}.g-time i{display:block;height:100%;width:100%;background:#ffd23a}
  .g-q{font-size:17px;line-height:1.6;margin:6px 0 10px;text-shadow:0 1px 4px #000}
  .g-ch{display:grid;grid-template-columns:1fr;gap:8px}
  .g-ch button{display:flex;gap:10px;align-items:center;text-align:left;font-size:16px;padding:12px 14px;border-radius:12px;background:rgba(255,255,255,.92);color:#16203a;border:2px solid transparent}
  .g-ch button span{flex:none;width:26px;height:26px;border-radius:50%;background:#2f5fb3;color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px}
  .g-ch button.right{background:#c9f5dc;border-color:#2e9e62}.g-ch button.wrong{background:#ffd9d9;border-color:#e05252}
  .g-fb{margin-top:10px;padding:10px 12px;border-radius:12px;background:rgba(0,0,0,.55);font-size:15px;line-height:1.55}.g-fb.ok b{color:#6df0a8}.g-fb.ng b{color:#ff8a8a}
  #gWish{width:100%;box-sizing:border-box;font-size:17px;padding:10px;border-radius:12px;border:2px solid #9cc9ff;background:rgba(255,255,255,.95);color:#16203a;margin-bottom:10px}
  `;
  document.head.appendChild(css3);

  /* ---------- 開発者モード（保護者用：条件に関係なくBOSS・神と戦って、演出を確認できる。記録は残らない）---------- */
  let devMode = false;
  function devHelperPool() { return SPECIALS.map(specialHelper).concat(TYPE_ORDER.map(t => friendHelper(t, "t_" + t))); }
  function devSelect(bid, prev) {
    prev = prev || {};
    title("開発者モード：キャラを選ぶ"); setHdr(""); showFab(false);
    const bo = BOSSES.find(x => x.id === bid);
    let sel = prev.form ? {type: prev.form.type, stage: prev.form.stage} : {type: "math", stage: 3}, hs = new Set(prev.helperKeys || []), force = prev.force || "auto";
    const pool = devHelperPool();
    const render = () => {
      const isOn = (t, s) => sel.type === t && sel.stage === s;
      const rows = `<button class="dv-b ${sel.stage === 0 ? "on" : ""}" data-t="" data-s="0"><span class="dv-eg">🥚</span><small>タマゴ</small></button>` + TYPE_ORDER.map(t => [1, 2, 3].map(s => `<button class="dv-b ${isOn(t, s) ? "on" : ""}" data-t="${t}" data-s="${s}"><img src="c_${t}_${s}.webp" alt="" draggable="false"><small>${esc(TYPES[t].n)}<br>${STAGE_NAMES[s]}</small></button>`).join("")).join("");
      const chips = pool.map(h => `<button class="dv-c ${hs.has(h.key) ? "on" : ""}" data-h="${h.key}">${h.special ? "" : "旅立ち："}${esc(h.n)}</button>`).join("");
      $("#app").innerHTML = `<p class="muted">開発者モード：${esc(bo.n)} と戦います。結果は記録されません（称号・討伐・周回・お助けキャラは変わりません）。</p>
        <h2>戦うキャラ（メインキャラ）</h2><div class="dv-grid">${rows}</div>
        <h2>お助けキャラ（4回目の後にカットイン）</h2><div class="dv-chips">${chips}</div>
        <h2>攻撃の結果</h2><div class="row"><button class="dv-f ${force === "auto" ? "on" : ""}" data-f="auto">本当の条件で</button><button class="dv-f ${force === "ok" ? "on" : ""}" data-f="ok">全部成功</button><button class="dv-f ${force === "ng" ? "on" : ""}" data-f="ng">全部失敗</button></div>
        <div class="row" style="margin-top:16px"><button class="primary" id="dvGo">この設定で戦う（${sel.stage === 0 ? "タマゴ" : esc(TYPES[sel.type].n + "・" + STAGE_NAMES[sel.stage])}）</button><button id="dvBk">BOSS一覧へ</button></div>`;
      $("#app").querySelectorAll(".dv-b").forEach(b => b.onclick = () => { sel = {type: b.dataset.t || null, stage: +b.dataset.s}; render(); });
      $("#app").querySelectorAll(".dv-c").forEach(b => b.onclick = () => { const k = b.dataset.h; hs.has(k) ? hs.delete(k) : hs.add(k); render(); });
      $("#app").querySelectorAll(".dv-f").forEach(b => b.onclick = () => { force = b.dataset.f; render(); });
      $("#dvBk").onclick = boss;
      $("#dvGo").onclick = () => { const keys = Array.from(hs); bossFight(bid, {dev: true, form: {stage: sel.stage, type: sel.type}, helperKeys: keys, helpers: pool.filter(h => hs.has(h.key)), force: force}); };
    };
    render();
  }

  function boss() {
    title("BOSSに挑戦"); setHdr(""); showFab(false);
    const b = B(), st = bossState();
    if (b.godSeen && !bossWon("dragon2")) { delete b.godSeen; persist(); }   // 旧版で先に神が出ていた場合は、真・龍王を倒すまで隠す
    if (!devMode && bossWon("dragon2") && !b.godSeen) { godDescent(); return; }
    const next = BOSSES.find(x => !bossWon(x.id));
    const rows = BOSSES.filter(x => x.id !== "god" || b.godSeen || devMode).map(x => {
      const w = bossWon(x.id), isNext = next && next.id === x.id, god = x.id === "god";
      if (w) return `<div class="card bb-row"><img src="${x.img}" alt="" draggable="false"><div><b>${esc(x.n)}</b><br><span class="muted">倒した ✓　称号「${esc(x.title)}」</span><br><button data-boss="${x.id}" style="margin-top:8px">もう一度挑戦</button></div></div>`;
      if (isNext) return `<div class="card bb-row now"><img src="${x.img}" alt="" draggable="false"><div><b>${esc(x.n)}</b><br><span class="muted">「${esc(x.appear)}」</span>${god && friendCount() < 1 ? '<br><span class="muted">お助けキャラが いないと、勝てないかも…</span>' : ""}<br><button class="primary" data-boss="${x.id}" style="margin-top:8px">${god ? "神に挑戦" : "挑戦する"}</button></div></div>`;
      return `<div class="card bb-row lock"><img src="${BLANK}" alt="" draggable="false"><div><b>？？？</b><br><span class="muted">前のBOSSを倒すと 現れる</span></div></div>`;
    }).join("");
    const dv = devMode ? `<div class="card" style="border:2px dashed #b36bff"><b>開発者モード ON</b><p class="note" style="margin:4px 0 8px">条件に関係なく、どのBOSSとも戦えます。結果は記録されません。</p><div class="row">${BOSSES.map(x => `<button class="primary small" data-dev="${x.id}">${esc(x.n)}と戦う</button>`).join("")}</div><div class="row" style="margin-top:8px"><button class="small" id="dvDesc">神降臨の演出を見る</button><button class="small" data-gseq="2">神・第2形態を見る</button><button class="small" data-gseq="3">神・第3形態を見る</button><button class="small" id="dvTbc">To Be Continued を見る</button></div></div>` : "";
    $("#app").innerHTML = `<p class="muted">キャラクターを育てて、BOSSに挑戦しよう。負けても、失うものは 何もないよ。</p>${dv}${rows}${b.cleared ? '<div class="card" style="text-align:center"><b>To Be Continued...</b></div>' : ""}${titlesHTML()}`;
    document.querySelectorAll("[data-boss]").forEach(el => { el.onclick = () => bossFight(el.dataset.boss); });
    document.querySelectorAll("[data-dev]").forEach(el => { el.onclick = () => devSelect(el.dataset.dev); });
    document.querySelectorAll("[data-gseq]").forEach(el => { el.onclick = () => { ac(); bgmStart("bgm_god.mp3"); godSeq(+el.dataset.gseq, true); }; });
    const d1 = document.getElementById("dvDesc"); if (d1) d1.onclick = () => godDescent(true);
    const d2 = document.getElementById("dvTbc"); if (d2) d2.onclick = () => toBeContinued(true);
  }
  const css2 = document.createElement("style");
  css2.textContent = `
  .bb-name{font-size:20px;font-weight:800;margin-bottom:6px}
  .bb-appear{display:flex;justify-content:center;margin:6px 0 10px}
  .bb-img{max-width:100%;max-height:42vh;border-radius:16px;filter:drop-shadow(0 3px 10px rgba(0,0,0,.35))}
  .bb-appear .bb-img{animation:bbPop .6s ease-out}
  .bb-down{animation:bbDown 1.2s ease-in forwards}
  .bb-descend .bb-img{animation:bbDescend 2.4s ease-out}
  .bb-flash{position:fixed;inset:0;background:#fff;pointer-events:none;animation:bbFlash 1.8s ease-out forwards}
  @keyframes bbPop{0%{transform:scale(.6);opacity:0}100%{transform:scale(1);opacity:1}}
  @keyframes bbDown{0%{transform:none;filter:none}40%{transform:translateX(-8px) rotate(-3deg)}100%{transform:translateY(14px) scale(.96);filter:grayscale(1) brightness(.8)}}
  @keyframes bbDescend{0%{transform:translateY(-60vh) scale(.5);opacity:0;filter:brightness(4)}50%{opacity:1}100%{transform:none;filter:none}}
  @keyframes bbFlash{0%{opacity:.95}100%{opacity:0}}
  .bb-row{display:flex;gap:12px;align-items:center;margin:10px 0}.bb-row img{width:96px;height:96px;object-fit:cover;border-radius:12px;flex:none}
  .bb-row.now{border:2px solid #e08e1e}.bb-row.lock img{filter:brightness(0) opacity(.5)}
  .bd-ttl{margin:6px 0}.bd-ttl b{display:block;font-size:16px}.bd-ttl small{color:var(--sub)}
  /* ---- 戦闘：画面全体を使う ---- */
  .bb-battle{padding:0;align-items:stretch;overflow:hidden;background:#0b1020}
  .bb-bt{position:relative;width:100%;height:100%;display:flex;flex-direction:column;color:#fff;text-align:center;background:radial-gradient(circle at 50% 35%,#2b3a73,#0b1020 78%)}
  .bb-top{display:flex;align-items:center;gap:10px;justify-content:space-between;font-size:20px;padding:calc(10px + env(safe-area-inset-top)) 16px 6px}
  .bb-hp{display:flex;gap:4px;flex:1;max-width:240px}.bb-hp i{flex:1;height:14px;border-radius:7px;background:#ff5a5a;box-shadow:inset 0 -3px 0 rgba(0,0,0,.18)}.bb-hp i.off{background:#3a3f55;transition:background .4s}
  .bb-dev{background:#b36bff;border-radius:8px;padding:0 8px;font-size:13px;font-weight:800}
  .bb-stage{position:relative;flex:1;min-height:0;overflow:hidden}
  .bb-bgfx{position:absolute;inset:-40%;background:repeating-conic-gradient(from 0deg,color-mix(in srgb,var(--c1) 22%,transparent) 0 8deg,transparent 8deg 20deg);opacity:.55;animation:ciSpin 24s linear infinite}
  .bb-boss{position:absolute;left:50%;top:3%;height:64%;max-width:86%;transform:translateX(-50%);object-fit:contain;border-radius:16px;filter:drop-shadow(0 0 26px rgba(255,255,255,.28))}
  .bb-boss.shake{animation:bbHit .9s ease-in-out}
  .bb-stage.god{background:#6fa8ff url(bg_god.webp) center/cover no-repeat}
  .bb-stage.god .bb-bgfx{display:none}
  .bb-stage.god .bb-boss{top:1%;height:68%;filter:drop-shadow(0 0 28px rgba(255,236,170,.8));animation:bbFloat 4.2s ease-in-out infinite}
  .bb-stage.god .bb-boss.shake{animation:bbHit .9s ease-in-out}
  @keyframes bbFloat{0%,100%{transform:translateX(-50%) translateY(0)}50%{transform:translateX(-50%) translateY(-16px)}}
  .bb-me{position:absolute;left:3%;bottom:2%;height:38%;max-width:46%;object-fit:contain;border-radius:14px;filter:drop-shadow(0 0 20px var(--c1));animation:bdIdle 3.4s ease-in-out infinite}
  .bb-me.egg{width:90px;height:112px}.bb-me.egg svg{width:100%;height:100%}
  .bb-me.dash{animation:bbDash .75s ease-in-out}
  .bb-fx{position:absolute;left:50%;top:32%;width:62%;max-width:380px;opacity:0;pointer-events:none;transform:translate(-50%,-50%)}
  .bb-fx.go{animation:bbFx 1s ease-out}
  .bb-pop{position:absolute;top:6%;left:50%;transform:translateX(-50%);font-size:34px;font-weight:900;opacity:0;text-shadow:0 2px 6px #000;white-space:nowrap;z-index:3}
  .bb-pop.ok,.bb-pop.ng{animation:bbPopT 1.1s ease-out forwards}.bb-pop.ok{color:#ffd23a}.bb-pop.ng{color:#9fb4ff}
  .bb-flashfx{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none}.bb-flashfx.go{animation:bbFlash2 .5s ease-out}
  .bb-panel{padding:8px 16px calc(14px + env(safe-area-inset-bottom));background:linear-gradient(transparent,rgba(0,0,0,.5) 28%);max-width:640px;width:100%;margin:0 auto}
  .bb-msg{min-height:48px;background:rgba(255,255,255,.12);border-radius:12px;padding:10px 14px;font-size:17px}
  .bb-dots{display:flex;gap:6px;justify-content:center;margin-top:10px}.bb-dots span{flex:1;max-width:96px;padding:6px 0;border-radius:10px;background:rgba(255,255,255,.12);font-size:13px}
  .bb-dots span.cur{outline:2px solid #ffd23a}.bb-dots span.ok{background:#e08e1e}.bb-dots span.ng{background:#4a5170;color:#cfd6ff}
  .bb-atk{font-size:20px;padding:14px 26px;min-height:56px}
  .bb-skip{position:absolute;right:12px;bottom:10px;z-index:8;background:rgba(0,0,0,.55);color:#fff;border-color:#fff}
  @keyframes bbHit{0%,100%{transform:translateX(-50%)}15%{transform:translateX(calc(-50% - 16px)) rotate(-3deg)}30%{transform:translateX(calc(-50% + 16px)) rotate(3deg)}45%{transform:translateX(calc(-50% - 10px))}60%{transform:translateX(calc(-50% + 10px))}80%{transform:translateX(calc(-50% - 4px))}}
  @keyframes bbDash{0%{transform:none}35%{transform:translate(34vw,-26vh) scale(1.3) rotate(-6deg)}55%{transform:translate(34vw,-26vh) scale(1.3) rotate(4deg)}100%{transform:none}}
  @keyframes bbFx{0%{opacity:0;transform:translate(-50%,-50%) scale(.4) rotate(-10deg)}20%{opacity:1;transform:translate(-50%,-50%) scale(1) rotate(6deg)}60%{opacity:1;transform:translate(-50%,-50%) scale(1.1) rotate(-6deg)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.25) rotate(8deg)}}
  @keyframes bbPopT{0%{opacity:0;transform:translateX(-50%) scale(.5)}25%{opacity:1;transform:translateX(-50%) scale(1.15)}100%{opacity:0;transform:translateX(-50%) translateY(-12px)}}
  @keyframes bbFlash2{0%{opacity:.8}100%{opacity:0}}
  /* ---- カットイン ---- */
  .bb-cutlayer{position:absolute;inset:0;z-index:6;pointer-events:none}
  .bb-ci{position:absolute;inset:0;overflow:hidden;pointer-events:auto;cursor:pointer;animation:ciIn .25s ease-out}
  .bb-ci.out{opacity:0;transition:opacity .2s}
  .bb-ci-bg{position:absolute;inset:0;background:linear-gradient(135deg,var(--c1),var(--c2));opacity:.9}
  .bb-ci-rays{position:absolute;inset:-60%;background:repeating-conic-gradient(from 0deg,rgba(255,255,255,.3) 0 6deg,transparent 6deg 14deg);animation:ciSpin 3s linear infinite}
  .bb-ci-img{position:absolute;bottom:0;left:50%;height:90%;max-width:94%;object-fit:contain;transform:translateX(-50%);animation:ciSlide .5s ease-out;filter:drop-shadow(0 0 22px #fff)}
  .bb-ci.hp .bb-ci-img{height:78%;animation:ciSlideR .45s ease-out}
  .bb-ci-txt{position:absolute;left:0;right:0;top:7%;text-shadow:0 3px 10px #000,0 0 20px var(--c1);padding:0 12px}
  .bb-ci-txt small{display:block;font-size:20px;font-weight:700}
  .bb-ci-txt b{display:block;font-size:clamp(26px,7vw,58px);font-style:italic;letter-spacing:.04em;animation:ciPop .5s ease-out}
  @keyframes ciIn{from{opacity:0}to{opacity:1}}
  @keyframes ciSpin{to{transform:rotate(360deg)}}
  @keyframes ciSlide{from{transform:translateX(-50%) translateY(40%) scale(.7);opacity:0}to{transform:translateX(-50%);opacity:1}}
  @keyframes ciSlideR{from{transform:translateX(70%);opacity:0}to{transform:none;opacity:1}}
  @keyframes ciPop{from{transform:scale(2.2);opacity:0}to{transform:none;opacity:1}}
  .bb-ci.hp .bb-ci-img{left:auto;right:0}
  /* ---- カード召喚 ---- */
  .bb-sum{position:relative;width:100%;height:100%;perspective:1100px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle,#2b3a73,#0b1020 75%);cursor:pointer}
  .bb-sum-bg{position:absolute;inset:-60%;background:repeating-conic-gradient(from 0deg,rgba(255,255,255,.1) 0 7deg,transparent 7deg 16deg);animation:ciSpin 20s linear infinite}
  .bb-card{position:relative;width:min(38vmin,280px);aspect-ratio:3/4;transform-style:preserve-3d;animation:cardIn 1.5s cubic-bezier(.2,.7,.2,1) both}
  .bb-card .face{position:absolute;inset:0;border-radius:18px;border:6px solid var(--c1);overflow:hidden;background:linear-gradient(160deg,#fff,#ffeec9);box-shadow:0 0 40px var(--c1),0 0 80px var(--c2)}
  .bb-card .face img{width:100%;height:100%;object-fit:cover;display:block}
  .bb-card .face.l{clip-path:polygon(0 0,53% 0,47% 100%,0 100%);animation:cardL .5s ease-in 1.55s forwards}
  .bb-card .face.r{clip-path:polygon(53% 0,100% 0,100% 100%,47% 100%);animation:cardR .5s ease-in 1.55s forwards}
  .bb-sum-flash{position:absolute;inset:0;background:#fff;opacity:0;animation:sumFlash .6s ease-out 1.5s}
  .bb-sum-me{position:absolute;height:64%;max-width:82%;object-fit:contain;opacity:0;filter:drop-shadow(0 0 30px var(--c1));animation:meOut .9s cubic-bezier(.2,1.4,.4,1) 1.55s forwards}
  .bb-sum-name{position:absolute;bottom:9%;left:0;right:0;text-align:center;color:#fff;font-size:28px;font-weight:800;text-shadow:0 2px 10px #000;opacity:0;animation:ciIn .5s ease-out 2.1s forwards}
  @keyframes cardIn{0%{transform:translateZ(-2200px) rotateY(1080deg) rotateZ(25deg);opacity:0}15%{opacity:1}80%{transform:translateZ(0) rotateY(8deg) rotateZ(0)}100%{transform:translateZ(80px) rotateY(0) rotateZ(0)}}
  @keyframes cardL{to{transform:translateX(-70vw) rotate(-30deg);opacity:0}}
  @keyframes cardR{to{transform:translateX(70vw) rotate(30deg);opacity:0}}
  @keyframes sumFlash{0%{opacity:0}30%{opacity:.95}100%{opacity:0}}
  @keyframes meOut{0%{opacity:0;transform:translateZ(-600px) scale(.2)}100%{opacity:1;transform:none}}
  /* ---- 神降臨 ---- */
  .bb-powerbg{background:#000;animation:bbRumble .25s linear infinite}
  .bb-power{position:relative;width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(circle,#7a1010,#000 70%)}
  .bb-power .bb-img{max-height:70vh;animation:bbGrow 2.6s ease-in forwards;filter:drop-shadow(0 0 40px #ffd23a)}
  .bb-power-t{color:#ffd23a;font-size:36px;font-weight:900;margin-top:12px;text-shadow:0 0 14px #f00;animation:ciPop .6s ease-out}
  @keyframes bbRumble{0%,100%{transform:translate(0,0)}25%{transform:translate(-3px,2px)}50%{transform:translate(3px,-2px)}75%{transform:translate(-2px,-3px)}}
  @keyframes bbGrow{from{transform:scale(.7);filter:brightness(.4)}to{transform:scale(1.15);filter:brightness(1.2) drop-shadow(0 0 40px #ffd23a)}}
  /* ---- 開発者モード ---- */
  .dv-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  .dv-b{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 4px;min-height:0;font-size:12px}.dv-b img{width:100%;height:84px;object-fit:cover;border-radius:8px}.dv-b .dv-eg{font-size:40px;line-height:84px}.dv-b.on,.dv-c.on,.dv-f.on{outline:3px solid #b36bff;background:var(--main2)}
  .dv-chips{display:flex;flex-wrap:wrap;gap:8px}.dv-c,.dv-f{font-size:15px}
  .cx img,.cx2 img,.cxs img,.bb-row img,.bd-friends img,.bb-img,.bb-boss,.bb-fx,.bb-me,.bb-ci-img,.bb-sum img{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
  .cx img,.cx2 img,.cxs img,.bb-row img,.bd-friends img{pointer-events:none}
  .bb-tbc{position:fixed;inset:0;z-index:80;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px}
  .bb-tbc .t{font-size:44px;font-style:italic;font-weight:800;letter-spacing:.02em;animation:bbPop 1.6s ease-out}.bb-tbc p{opacity:.8;margin:18px 0 28px}
  .bb-tbc button{background:#fff;color:#000;border:none;border-radius:12px;padding:12px 26px;font-size:16px;font-weight:700}`;
  document.head.appendChild(css2);

  function check() { const evs = evaluate(); if (evs.length) setTimeout(() => evoOverlay(evs), 500); }
  window.Buddy = {godQ: GODQ, isDev: () => devMode, boss, bossCheck, friendCount, rewardOverlay, check, init, card, page, codex, complete, graded, status, form, proficiency, subjOf, lap, evaluate, decideType, TYPES, SUBJ, SUBJN};
  try { init(); } catch (e) {}
})();
