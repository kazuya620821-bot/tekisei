// ルミン（育成キャラ）機能 v2。設定値は BUDDY_CFG にまとめてある（あとから調整できる）。
// タマゴ → 経験値100でかえる（4科目の経験値の割合で型が決まる）→ 中間進化 → 最終進化
// index.html の db / persist / P / today / byId / esc などを使う（読み込みは index.html の本体より前）。
window.BUDDY_CFG = {
  // ---- 眠る・おとうさん ----
  sleepWarnDays: 3,        // この日数あいたら「ねむそう」
  sleepDays: 4,            // この日数あいたら「眠る」
  dormPerDay: 10,          // 休眠値＝あいた日数×この値（上限100）
  dadLimit: 70,            // 休眠値がこれ以上で、かつ4科目の習熟度より高いと「おとうさん」が出る
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
  mid:   {xp: 300, top1: 40},               // 中間進化：経験値300＋どれかの科目の習熟度が40以上
  final: {xp: 600, count: 2, min: 40,       // 最終進化：経験値600＋2科目の習熟度が40以上
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
  const STAGE_NAMES = ["タマゴ", "幼体", "中間進化", "最終進化"];
  const DAD_IMG = "c_dad.webp";
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
    if (total > sum) {                       // 親の採点ぶんなど、科目がわからない経験値は、いまの割合で配る
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
    if (evs.length) persist();
    return evs;
  }

  /* ---------- 状態（通常・嬉しい・眠る・おとうさん）---------- */
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
  function nameOf(f, state) {
    if (state === "dad") return "おとうさん";
    if (f.stage === 0) return "タマゴ";
    return TYPES[f.type].n;
  }
  function subName(f, state) {
    if (state === "dad") return "ねむそうなおとうさん";
    if (f.stage === 0) return "たまごの中で、なにかが育っているよ";
    return TYPES[f.type].l + "　" + STAGE_NAMES[f.stage];
  }

  const LINES = {
    normal: ["いっしょにがんばろうね！", "キミならできるよ！", "きょうは どれから やる？", "1問だけでも、ちゃんと前に進むよ！"],
    egg: ["たまごの中から、とくとく…音がするよ。", "いろいろな科目を解くと、どんな子が生まれるかな？", "もうすぐ 会えるかもしれないね！"],
    happy: ["やったー！", "がんばったね！", "いいね、その調子！", "ありがとう！ちからが わいてきたよ！"],
    sleepy: ["ふわぁ…ちょっと ねむいな。1問だけ いっしょに やってみる？"],
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

  /* ---------- れんぞくスタンプ（ログインボーナス）---------- */
  const STREAK_MILESTONES = {3: 3, 5: 5, 7: 10, 10: 10, 14: 15, 21: 20, 30: 30};
  const STREAK_MSG = {
    3: ["3日つづいたね！", "いい調子。この流れ、大切にしよう。"],
    5: ["5日れんぞく！がんばってるねー！", "毎日の積み重ねが、いちばんの力になるよ。"],
    7: ["1週間れんぞく！", "7日つづけられたのは、りっぱな力だよ。"],
    10: ["10日れんぞく！", "もう、勉強が生活の一部になってきたね。"],
    14: ["2週間れんぞく！", "つづける力は、入試でもきっと味方になるよ。"],
    21: ["3週間れんぞく！", "すごい。ここまでつづいた人は、なかなかいないよ。"],
    30: ["30日れんぞく！", "ひと月つづけた自分を、ほこりに思っていいよ。"]
  };
  const wkKey = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.getFullYear() + "/" + (x.getMonth() + 1) + "/" + x.getDate(); };
  // 勉強した日から、れんぞく日数を数える。1週間に1回だけ、1日お休みしても切れない（お休みチケット・自動）
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
    // れんぞくの節目ボーナス：その日に取り組んだ科目に等分して配る（型の割合をかたよらせないため）
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
    const m = STREAK_MSG[sk.n] || [sk.n + "日れんぞく！", "すごいね。"];
    const o = document.createElement("div"); o.className = "bd-evo"; document.body.appendChild(o);
    o.innerHTML = `<div class="box"><div class="bd-stamp">${sk.n}<small>日</small></div><h2>${esc(m[0])}</h2><p>${esc(m[1])}</p><p class="bd-sub">ボーナス経験値 +${sk.bonus}</p><button class="primary" id="bdOk">やったー！</button></div>`;
    o.querySelector("#bdOk").onclick = () => { o.remove(); if (done) done(); };
  }

  /* ---------- ごほうび（親の採点が入ったとき）---------- */
  const REWARD = [
    {min: 80, head: ["ぜんぶ たしかめた力、光ってるよ", "考えぬいた分だけ、ちゃんと点になったね", "いまの力、かなり本物だよ"], msg: ["むずかしい問題にも、あきらめずに向きあえたね。この調子で、つぎも進もう。", "できた問題は、人に説明できるくらいまで理解を深めると、もっと強くなるよ。"], title: "すばらしい！"},
    {min: 60, head: ["あと一歩のところまで来たよ", "できたところが、ちゃんと増えてるよ", "おしい問題が、伸びしろだよ"], msg: ["できた点を、まず自分でほめよう。まちがえた問題をもう一度やると、ぐんと伸びるよ。", "考え方があっていた問題も多いよ。まちがえた問題を、もう一度ためしてみよう。"], title: "いい調子！", review: true},
    {min: 30, head: ["今日も 机に向かえたのが すごい", "やってみたことが、いちばん大事だよ", "むずかしい問題は、伸びるチャンス"], msg: ["どこでつまずいたかが分かれば、次は必ず強くなるよ。ひとつだけ、ふり返ってみよう。", "点数より、取り組んだことがえらいよ。まちがえた問題は、ゆっくり見直せば大丈夫。"], title: "やってみたね！", review: true},
    {min: 0, head: ["やれやれ、パパを頼りなさい"], msg: ["どこでつまずいたか、いっしょに見てみよう。ひとりで悩まなくて大丈夫だよ。"], title: "パパの出番！", review: true, papa: true}
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
    host.innerHTML = RKEYS.map(([k, n]) => `<div class="bd-rwrow" data-k="${k}"><div class="th">?</div><div><b>${n}</b><br><label class="rwb">えらぶ<input type="file" accept="image/*" hidden></label> <button class="ghost rwx">もどす</button></div></div>`).join("");
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
      <div class="bd-rmsg"><b>${esc(pickR(r.head))}</b><p>${esc(pickR(r.msg))}</p><div class="bd-from">おうえん：てきせいトレーニング</div></div>
      <div class="bd-rxp">経験値 +${Math.round(gain)}${si.cur ? "　／　れんぞく " + si.cur + "日め" : ""}</div>
      <div class="row" style="justify-content:center;gap:10px;margin-top:12px">${r.review ? '<button id="bdRv">まちがえた問題を見る</button>' : ""}<button class="primary" id="bdOk">つぎへ</button></div></div>`;
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
      return {frac: Math.min(1, (b.xp - C.hatchXp) / (m.xp - C.hatchXp)), need, label: "中間進化"};
    }
    if (f.stage === 2) {
      const m = C.final; if (b.xp < m.xp) need.push("あと経験値 " + (m.xp - b.xp));
      if (v.filter(x => x >= m.min).length < m.count) need.push(m.count + "科目の習熟度を " + m.min + " 以上に");
      if (!mockOk(lap())) need.push("45分模擬（Ⅰ・Ⅱ）で合計 " + m.mockPct + "％以上");
      return {frac: Math.min(1, (b.xp - C.mid.xp) / (m.xp - C.mid.xp)), need, label: "最終進化"};
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
      else prog = `<div class="bd-sub" style="margin-top:8px">最終進化まで育ったよ！旅立ちもできるよ。</div>`;
    }
    return `<button class="card bd-card" data-go="#buddy">${sprite(false, f, st)}<div class="bd-info">
      <div class="bd-name">${esc(nameOf(f, st.state))}</div><div class="bd-sub">${esc(subName(f, st.state))}　経験値 ${B().xp}${streakInfo().cur >= 2 ? "　れんぞく " + streakInfo().cur + "日" : ""}</div>
      <div class="bd-say">${esc(line(st, f))}</div>${prog}</div></button>`;
  }

  function weekCount() {
    const b = B(), n = new Date(); n.setHours(0, 0, 0, 0); let c = 0;
    b.days.forEach(d => { const x = dkey(d); if (x && daysBetween(x, n) <= 6 && daysBetween(x, n) >= 0) c++; });
    return c;
  }

  // 旅立ち：最終進化したキャラは「おともだち」として残り、新しいタマゴ（次の周）がはじまる。記録・図鑑は消えない
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
    const evo = b.evo.slice(-6).reverse().map(e => `<li>${esc(e.date)}　${e.stage === 1 ? "たまごから " + TYPES[e.type].l + "（" + TYPES[e.type].n + "）がかえった" : TYPES[e.type].n + "が" + STAGE_NAMES[e.stage] + "になった"}</li>`).join("");
    const lean = f.stage === 0 ? decideType(b.xpSub) : null;
    const typeMsg = f.stage === 0
      ? (lean ? "いまのところ「" + esc(TYPES[lean].l) + "」になりそう。経験値" + C.hatchXp + "でかえるまで、変わるかもしれないよ。" : "まだ、どんな子が生まれるかわからないよ。いろいろな科目を解いてみよう。")
      : (esc(TYPES[f.type].l + "（" + TYPES[f.type].n + "）の姿です。") + (f.stage < 3 && decideType(b.xpSub) && decideType(b.xpSub) !== f.type ? "　次の進化では「" + esc(TYPES[decideType(b.xpSub)].l) + "」になりそう。進化まで、変わるかもしれないよ。" : (f.stage < 3 ? "　次の進化でも、この調子なら同じ型だよ。" : "")));
    $("#app").innerHTML = `
    <div class="card bd-big">${sprite(true, f, st)}
      <div class="bd-name">${esc(nameOf(f, st.state))}</div><div class="bd-sub">${esc(subName(f, st.state))}</div>
      <div class="bd-say">${esc(line(st, f))}</div></div>
    <h2>れんぞくスタンプ</h2>
    <div class="card"><div class="bd-week">${weekStamps().map(x => `<div class="${x.done ? "d" : x.rest ? "r" : ""} ${x.today ? "t" : ""}">${x.n}<br>${x.done ? "✔" : x.rest ? "休" : "・"}</div>`).join("")}</div><div class="bd-sub" style="margin-top:8px">いま <b>${streakInfo().cur}</b> 日れんぞく　／　さいこう ${streakInfo().best} 日　／　お休みチケット：${streakInfo().ticketLeft ? "今週は 1回つかえるよ" : "今週は つかったよ"}</div><p class="note" style="margin:6px 0 0">問題を1つ記録した日に、スタンプがつきます。3・5・7・10・14・21・30日で、ボーナス経験値。1日休んでも、週に1回は つづきます。とぎれても、経験値は へりません。</p></div>
    <h2>経験値</h2>
    <div class="card"><div>${b.xp} <span class="muted">経験値</span>　<span class="muted">今週 ${weekCount()}日 がんばったよ</span></div>
      ${nx ? `<div class="bar" style="margin:8px 0"><i style="width:${Math.round(nx.frac * 100)}%"></i></div><div class="bd-sub">次は「${esc(nx.label)}」　${nx.need.length ? esc(nx.need.join("／")) : "条件はそろっているよ。1問やると成長するかも！"}</div>` : `<div class="bd-sub" style="margin-top:6px">最終進化まで育ちました。</div>`}</div>
    ${f.stage === 3 ? `<h2>旅立ちのとき</h2><div class="card"><p style="margin:0 0 8px">${esc(TYPES[f.type].n)}は、りっぱに育ちました。旅立つと、${esc(TYPES[f.type].n)}は「おともだち」としてずっと残り、新しいタマゴがはじまります。</p><p class="note" style="margin:0 0 10px">記録・図鑑・解いた問題の履歴は消えません。新しい周では、同じ問題をもう一度やると、また経験値がもらえます。</p><button class="primary" id="bdDepart">旅立たせて、新しいタマゴをむかえる</button></div>` : ""}
    ${(b.friends || []).length ? `<h2>おともだち（${b.friends.length}）</h2><div class="card"><div class="bd-friends">${b.friends.map(x => `<div><img src="c_${x.type}_3.webp" alt=""><b>${esc(TYPES[x.type].n)}</b><small>${esc(x.date)}</small></div>`).join("")}</div></div>` : ""}
    <h2>科目ごとの経験値</h2>
    <div class="card">${xrows}<p class="note" style="margin:6px 0 0">解いた問題の科目に経験値がたまります。たまごがかえるときと、進化するときに、この割合で型が決まります。</p>
      <div class="bd-sub" style="font-size:15px;color:var(--ink);margin-top:8px">${typeMsg}</div></div>
    <h2>科目ごとの習熟度（100点満点）</h2>
    <div class="card">${prow}<p class="note" style="margin:6px 0 0">解いた問題の得点率から決まります。親の採点が入ると、そちらが使われます。進化の条件に使います。</p></div>
    ${evo ? `<h2>これまでの成長</h2><div class="card"><ul style="margin:0;padding-left:20px">${evo}</ul></div>` : ""}
    <div class="row" style="margin-top:14px"><button class="primary" data-go="#codex">図鑑を見る</button></div>
    <div id="rwBox"></div>
    <div id="rwTap" style="text-align:center;margin:26px 0 8px;font-size:11px;color:var(--sub);opacity:.45;user-select:none;-webkit-user-select:none">てきせいトレーニング</div>`;
    (function () {
      const box = document.getElementById("rwBox"), tap = document.getElementById("rwTap"); let n = 0, t0 = 0;
      const open = () => { box.innerHTML = `<h2>ごほうび画像の設定（保護者用）</h2><div class="card"><p class="note" style="margin:0 0 6px">点数ごとに出す画像を、この端末の写真から選べます（この端末の中だけに保存され、ネットには出ません）。選ばない場合は、キャラクターが出ます。</p><div id="rwSet"></div><div class="row" style="margin-top:10px"><button id="rwHide">この設定をかくす</button></div></div>`; rewardSettings(); document.getElementById("rwHide").onclick = () => { box.innerHTML = ""; }; box.scrollIntoView({behavior: "smooth", block: "center"}); };
      tap.onclick = () => { const now = Date.now(); if (now - t0 > 3000) n = 0; t0 = now; if (++n >= 5) { n = 0; open(); } };
    })();
    const dp = document.getElementById("bdDepart");
    if (dp) dp.onclick = () => { if (confirm(TYPES[f.type].n + "を旅立たせて、新しいタマゴをむかえますか？\n（" + TYPES[f.type].n + "は「おともだち」として残ります）")) { if (depart()) { toast(0); location.hash = "#buddy"; route(); } } };
  }

  function hintOf(k) {
    if (HINT[k]) return HINT[k];
    const p = k.split("_").map(s => SUBJN[s]);
    return p.length === 1 ? p[0] + "の経験値がほかより多い" : p.join("と") + "の経験値が同じくらい多い";
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
    const total = TYPE_ORDER.length * 3 + 2;
    let got = 1 + (b.dadFound ? 1 : 0);
    const egg = `<div class="card it"><div class="eg">${eggSVG(0.2, "normal")}</div><b>タマゴ</b><small>はじまりの姿</small></div>`;
    const rows = TYPE_ORDER.map(k => {
      const slots = [1, 2, 3].map(n => {
        const ok = !!fm[k + "_" + n]; if (ok) got++;
        return `<div class="sl ${ok ? "" : "lock"}"><img src="c_${k}_${n}.webp" alt=""><small>${STAGE_NAMES[n]}</small></div>`;
      }).join("");
      const any = [1, 2, 3].some(n => fm[k + "_" + n]);
      return `<div class="card cxrow ${any ? "" : "lockrow"}"><div class="cxh">${any ? `<b>${esc(TYPES[k].n)}</b><small>${esc(TYPES[k].l)}</small>` : `<b>？？？</b><small>${esc(hintOf(k))}</small>`}</div><div class="cxs">${slots}</div></div>`;
    }).join("");
    const dad = `<div class="card it ${b.dadFound ? "" : "lock"}"><img src="${DAD_IMG}" alt=""><b>${b.dadFound ? "おとうさん" : "？？？"}</b><small>${b.dadFound ? "休みが続くとあらわれる" : "かくれキャラ"}</small></div>`;
    $("#app").innerHTML = `<p class="muted">出会った姿が登録されます。（見つけた ${got} / ${total}）　タマゴ1＋11種×3段階＋かくれキャラ1</p><div class="cx2">${egg}${dad}</div>${rows}`;
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

  function evoOverlay(evs) {
    const f = form(), hatch = evs.find(e => e.kind === "hatch");
    const o = document.createElement("div"); o.className = "bd-evo";
    document.body.appendChild(o);
    const done = () => { o.remove(); if (location.hash === "" || location.hash === "#") route(); };
    if (hatch) {
      const t = TYPES[hatch.type];
      o.innerHTML = `<div class="box"><h2>たまごが ゆれている…！</h2><div class="bd-wrap big egg shake" style="margin:0 auto">${eggSVG(1, "normal")}</div></div>`;
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

  function check() { const evs = evaluate(); if (evs.length) setTimeout(() => evoOverlay(evs), 500); }
  window.Buddy = {rewardOverlay, check, init, card, page, codex, complete, graded, status, form, proficiency, subjOf, lap, evaluate, decideType, TYPES, SUBJ, SUBJN};
  try { init(); } catch (e) {}
})();
