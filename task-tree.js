/* task-tree.js — drills down a «Ход» row into its task tree + step timeline.
   Static mini-app, no build step, no external libs. Loaded AFTER index.html.
   Data sources (existing only): LIVE_JOBS (live.json), api() (process_api),
   LIVE.tree (tree.json) as an honest static fallback. No new endpoints. */
(function(){
  "use strict";

  var ID = "ttDrawer", MAX_CHAIN = 10;

  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function $(sel, root){ return (root || document).querySelector(sel); }
  function apiCall(path){
    return (typeof window.api === "function") ? window.api(path) : Promise.resolve(null);
  }
  function liveJobs(){
    try { return (typeof LIVE_JOBS !== "undefined" && LIVE_JOBS) ? LIVE_JOBS : null; }
    catch(e){ return null; }
  }
  function apiNodesCache(){
    try { return (typeof API_TREE_NODES !== "undefined" && Array.isArray(API_TREE_NODES)) ? API_TREE_NODES : []; }
    catch(e){ return []; }
  }
  function staticTree(){
    try { return (typeof LIVE !== "undefined" && LIVE && Array.isArray(LIVE.tree)) ? LIVE.tree : []; }
    catch(e){ return []; }
  }
  function normId(v){ return v == null ? "" : String(v); }
  function hhmmss(ts){
    if(!ts) return "";
    var ms = (typeof ts === "number") ? (ts < 1e12 ? ts*1000 : ts) : Date.parse(ts);
    if(!isFinite(ms)) return String(ts).slice(11,19) || String(ts);
    var d = new Date(ms);
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map(function(n){ return String(n).padStart(2,"0"); }).join(":");
  }
  function short(v, n){
    var s = String(v == null ? "" : v).trim();
    return s.length > (n || 700) ? s.slice(0, n || 700) + "…" : s;
  }

  /* ---------- CSS: local palette mirrors Catppuccin Mocha variables ---------- */
  var css = [
    "#liveJobs .live-row,#liveSteps .live-row{cursor:pointer}",
    "#liveJobs .live-row::after,#liveSteps .live-row::after{content:'›';color:var(--overlay1,#7f849c);font:700 15px/1 var(--fm,monospace)}",
    "#liveJobs .live-row:hover,#liveSteps .live-row:hover{background:rgba(137,180,250,.08)}",
    ".tt-backdrop{position:fixed;inset:0;background:rgba(17,17,27,.72);z-index:60;opacity:0;pointer-events:none;transition:opacity .2s}",
    ".tt-backdrop.open{opacity:1;pointer-events:auto}",
    /* Полный экран: боковая щель в 460 px не помещала тезисы по карте/видео.
       @owner:agent @region:card-fullscreen */
    ".tt-panel{position:fixed;top:0;right:0;bottom:0;width:100%;z-index:61;" +
      "background:var(--base,#1e1e2e);color:var(--text,#cdd6f4);box-shadow:var(--shadow,0 10px 30px rgba(0,0,0,.35));" +
      "border-left:1px solid var(--surface1,#45475a);display:flex;flex-direction:column;" +
      "transform:translateX(102%);transition:transform .22s ease;padding-top:env(safe-area-inset-top)}",
    ".tt-panel.open{transform:translateX(0)}",
    ".tt-head{display:flex;align-items:flex-start;gap:10px;padding:16px 16px 12px;border-bottom:1px solid var(--surface0,#313244);" +
      "background:var(--crust,#11111b)}",
    ".tt-headtxt{flex:1;min-width:0}",
    ".tt-eyebrow{font:700 9.5px/1 var(--fm,monospace);letter-spacing:1.1px;text-transform:uppercase;" +
      "color:var(--overlay1,#7f849c);margin-bottom:7px}",
    ".tt-title{font-size:15px;font-weight:700;line-height:1.35;word-break:break-word}",
    ".tt-sub{font:600 10px/1.5 var(--fm,monospace);color:var(--overlay2,#9399b2);margin-top:5px;word-break:break-all}",
    ".tt-close{flex:none;width:32px;height:32px;border-radius:9px;border:1px solid var(--surface1,#45475a);" +
      "background:var(--surface0,#313244);color:var(--text,#cdd6f4);font:700 17px/1 var(--ff,sans-serif);cursor:pointer}",
    ".tt-close:active{background:var(--surface2,#585b70)}",
    ".tt-body{overflow-y:auto;overscroll-behavior:contain;padding:6px 14px 28px;-webkit-overflow-scrolling:touch}",
    ".tt-sec{margin-top:16px}",
    ".tt-sec>.tt-eyebrow{margin-bottom:8px}",
    ".tt-card{background:var(--mantle,#181825);border:1px solid var(--surface0,#313244);" +
      "border-radius:var(--radius-sm,11px);padding:10px 11px}",
    ".tt-empty{font:500 11.5px/1.5 var(--ff,sans-serif);color:var(--overlay1,#7f849c);" +
      "border:1px dashed var(--surface1,#45475a);border-radius:10px;padding:10px 11px}",
    ".tt-kv{display:flex;gap:8px;justify-content:space-between;align-items:baseline;" +
      "font:600 10.5px/1.5 var(--fm,monospace);padding:3px 0;border-bottom:1px solid var(--surface0,#313244)}",
    ".tt-kv:last-child{border-bottom:0}",
    ".tt-kv b{color:var(--overlay2,#9399b2);font-weight:600;flex:none}",
    ".tt-kv span{color:var(--text,#cdd6f4);text-align:right;word-break:break-all}",
    ".tt-chain{position:relative;padding-left:16px}",
    ".tt-chain:before{content:'';position:absolute;left:4px;top:6px;bottom:8px;width:1px;background:var(--surface1,#45475a)}",
    ".tt-node{position:relative;padding:6px 0 10px}",
    ".tt-node:before{content:'';position:absolute;left:-16px;top:11px;width:9px;height:9px;border-radius:50%;" +
      "background:var(--surface2,#585b70);border:2px solid var(--base,#1e1e2e)}",
    ".tt-node.current:before{background:var(--blue,#89b4fa)}",
    ".tt-node.root:before{background:var(--lavender,#cba6f7)}",
    ".tt-nlabel{font-size:12px;font-weight:600;line-height:1.4;word-break:break-word}",
    ".tt-nmeta{font:600 9.5px/1.5 var(--fm,monospace);color:var(--overlay1,#7f849c);margin-top:2px;word-break:break-all}",
    ".tt-depth{font:700 9px/1 var(--fm,monospace);color:var(--overlay0,#6c7086);margin-right:5px}",
    ".tt-cur{font:700 9px/1 var(--fm,monospace);color:var(--blue,#89b4fa);margin-left:5px}",
    ".tt-filters{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:9px}",
    ".tt-filter{font:700 9.5px/1 var(--fm,monospace);padding:6px 9px;border-radius:8px;cursor:pointer;" +
      "border:1px solid var(--surface1,#45475a);background:transparent;color:var(--overlay2,#9399b2)}",
    ".tt-filter.on{border-color:var(--blue,#89b4fa);color:var(--blue,#89b4fa);background:rgba(137,180,250,.1)}",
    ".tt-ev{display:grid;grid-template-columns:60px 76px 1fr;gap:6px;align-items:start;" +
      "padding:7px 0;border-bottom:1px solid var(--surface0,#313244)}",
    ".tt-ev:last-child{border-bottom:0}",
    ".tt-evts{font:600 9px/1.4 var(--fm,monospace);color:var(--overlay0,#6c7086)}",
    ".tt-badge{font:700 9px/1.4 var(--fm,monospace);border-radius:6px;padding:2px 5px;text-align:center;" +
      "border:1px solid var(--surface1,#45475a);color:var(--overlay2,#9399b2)}",
    ".tt-badge.step_start{color:var(--sky,#89dceb);border-color:rgba(137,220,235,.35)}",
    ".tt-badge.step_end{color:var(--green,#a6e3a1);border-color:rgba(166,227,161,.35)}",
    ".tt-badge.text{color:var(--subtext1,#bac2de)}",
    ".tt-badge.error{color:var(--maroon,#f38ba8);border-color:rgba(243,139,168,.35)}",
    ".tt-badge.done{color:var(--green,#a6e3a1);border-color:rgba(166,227,161,.35)}",
    ".tt-badge.question{color:var(--yellow,#f9e2af);border-color:rgba(249,226,175,.35)}",
    ".tt-evtext{font:500 10.5px/1.5 var(--ff,sans-serif);color:var(--subtext1,#bac2de);" +
      "white-space:pre-wrap;word-break:break-word;max-height:150px;overflow:auto}",
    ".tt-answer{font:500 12px/1.6 var(--ff,sans-serif);white-space:pre-wrap;word-break:break-word;" +
      "max-height:240px;overflow:auto;color:var(--text,#cdd6f4)}",
    "#liveProgressBar .pbar{cursor:pointer;border-radius:9px;padding:5px 6px;margin:0 0 8px}",
    "#liveProgressBar .pbar:hover{background:rgba(137,180,250,.09)}",
    "#liveProgressBar .pbar:focus-visible{outline:2px solid var(--blue,#89b4fa)}",
    ".tt-toolhead{font:600 10px/1.5 var(--fm,monospace);color:var(--overlay2,#9399b2);margin-bottom:9px}",
    ".tt-tool{display:grid;grid-template-columns:64px 70px 1fr;gap:8px;align-items:center;" +
      "padding:5px 0;border-bottom:1px solid var(--surface0,#313244)}",
    ".tt-tool:last-child{border-bottom:0}",
    ".tt-tool b{font:700 9.5px/1.4 var(--fm,monospace);letter-spacing:.4px;color:var(--sky,#89dceb)}",
    ".tt-tool b.k-READ{color:var(--blue,#89b4fa)}",
    ".tt-tool b.k-WRITE,.tt-tool b.k-EDIT{color:var(--green,#a6e3a1)}",
    ".tt-tool b.k-SYNC{color:var(--lavender,#cba6f7)}",
    ".tt-tool b.k-BASH{color:var(--yellow,#f9e2af)}",
    ".tt-tool span{font:600 10px/1.4 var(--fm,monospace);color:var(--subtext1,#bac2de)}",
    ".tt-foot{font:600 9.5px/1.5 var(--fm,monospace);color:var(--overlay0,#6c7086);margin-top:14px;text-align:center}"
  ].join("\n");
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------- drawer skeleton ---------- */
  var backdrop = document.createElement("div");
  backdrop.className = "tt-backdrop";
  var panel = document.createElement("div");
  panel.className = "tt-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Дерево задачи");
  panel.innerHTML =
    '<div class="tt-head"><div class="tt-headtxt">' +
      '<div class="tt-eyebrow">Дерево задачи · ход</div>' +
      '<div class="tt-title" id="ttTitle">…</div>' +
      '<div class="tt-sub" id="ttSub"></div>' +
    '</div><button class="tt-close" id="ttClose" title="Закрыть (Esc)" aria-label="Закрыть">×</button></div>' +
    '<div class="tt-body" id="ttBody"></div>';
  document.body.appendChild(backdrop);
  document.body.appendChild(panel);

  var lastFocus = null, prevOverflow = "", filter = "all", current = null;
  var toolTimer = null, toolTask = null;

  function stopTools(){
    if(toolTimer){ clearInterval(toolTimer); toolTimer = null; }
    toolTask = null;
  }

  function close(){
    stopTools();
    backdrop.classList.remove("open");
    panel.classList.remove("open");
    document.body.style.overflow = prevOverflow;
    if(lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }
  function open(task, row){
    lastFocus = row || document.activeElement;
    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    filter = "all";
    current = task;
    $("#ttTitle").textContent = task.title || task.id || "задача";
    $("#ttSub").textContent = [task.id, task.kind && ("источник: " + task.source), task.task && ("шаг: " + task.task)]
      .filter(Boolean).join(" · ");
    $("#ttBody").innerHTML = '<div class="tt-empty">Загружаю цепочку…</div>';
    backdrop.classList.add("open");
    panel.classList.add("open");
    $("#ttBody").scrollTop = 0;
    load(task);
  }
  $("#ttClose").addEventListener("click", close);
  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", function(e){
    if(e.key === "Escape" && panel.classList.contains("open")){ e.preventDefault(); close(); }
  });

  /* ---------- resolve row -> task object from live.json ---------- */
  function rowTask(row){
    var d = liveJobs();
    if(!d) return null;
    var box = row.parentElement;
    var idx = Array.prototype.indexOf.call(
      Array.prototype.filter.call(box.children, function(el){ return el.classList.contains("live-row"); }), row);
    if(idx < 0) return null;
    if(box.id === "liveJobs"){
      var j = (d.active || [])[idx];
      if(!j) return null;
      return {id: j.id, title: j.title, source: j.source || "очередь",
              ts: j.claimed_human, age: j.age_min, kind: "job", raw: j};
    }
    if(box.id === "liveSteps"){
      var active = (d.tasks || []).filter(function(s){ return s.status !== "done"; });
      var s = active[idx];
      if(!s) return null;
      return {id: s.id, title: s.title, task: s.task, note: s.note, status: s.status,
              source: "progress.json", kind: "step", raw: s};
    }
    return null;
  }
  document.addEventListener("click", function(e){
    var row = e.target && e.target.closest ? e.target.closest("#liveJobs .live-row,#liveSteps .live-row") : null;
    if(!row) return;
    var t = rowTask(row);
    if(t) open(t, row);
  });

  /* ---------- chain: API parent_id, else honest static tree.json ---------- */
  function apiNode(id, cache){
    if(cache && Object.prototype.hasOwnProperty.call(cache, id)) return Promise.resolve(cache[id]);
    return apiCall("/nodes/" + encodeURIComponent(id)).then(function(res){
      return res && res.node ? res.node : null;
    });
  }
  function buildApiChain(id, node){
    var cache = {};
    apiNodesCache().forEach(function(n){
      var k = normId(n.id != null ? n.id : (n._id != null ? n._id : n.node_id));
      if(k) cache[k] = n;
    });
    cache[id] = node;
    var chain = [node], seen = {};
    seen[id] = true;
    function step(parentId, depth){
      if(!parentId || depth >= MAX_CHAIN || seen[parentId]) return Promise.resolve();
      seen[parentId] = true;
      return apiNode(parentId, cache).then(function(p){
        if(!p) return;
        chain.push(p);
        var next = p.parent_id != null ? p.parent_id : p.parent;
        return step(normId(next), depth + 1);
      });
    }
    return step(normId(node.parent_id != null ? node.parent_id : node.parent), 1)
      .then(function(){ return chain.reverse(); });
  }
  function staticChain(id){
    var byId = {}, parent = {};
    (function walk(list, up){
      list.forEach(function(n){
        var k = normId(n.id);
        if(!k) return;
        byId[k] = n; parent[k] = up;
        if(Array.isArray(n.children)) walk(n.children, k);
      });
    })(staticTree(), "");
    if(!byId[id]) return null;
    var out = [], p = id, seen = {};
    while(p && !seen[p] && out.length < MAX_CHAIN){
      seen[p] = true;
      out.push(byId[p]);
      p = parent[p] || "";
    }
    return out.reverse();
  }

  /* ---------- events ---------- */
  function evInfo(e){
    var name = String(e.event || e.type || e.kind || "");
    var low = name.toLowerCase();
    var cat = "other", label = name || "событие";
    if(/step\.started|step_start|step\.begin/.test(low)){ cat="step_start"; label="шаг начат"; }
    else if(/step\.(finished|completed|end)|step_end/.test(low)){ cat="step_end"; label="шаг завершён"; }
    else if(/fail|error|reject|failed/.test(low)){ cat="error"; label="ошибка"; }
    else if(/succeed|idle|done|complete/.test(low)){ cat="done"; label="готово"; }
    else if(/question|permission|form/.test(low)){ cat="question"; label="вопрос"; }
    else if(/text|message|assistant/.test(low)){ cat="text"; label="текст"; }
    return {cat:cat, label:label};
  }
  function evText(e){
    var d = (e.data && typeof e.data === "object") ? e.data : {};
    var parts = [
      d.text || d.answer || d.output || d.message || d.error || e.title || e.error,
      (e.tool && e.tool.name) ? ("инструмент: " + e.tool.name + (e.tool.ms ? " · " + e.tool.ms + "мс" : "")) : "",
      e.step || e.status || (e.model ? "модель: " + e.model : "")
    ];
    return parts.filter(function(x){ return x != null && String(x).trim(); })
      .map(function(x){ return short(x, 700); }).join("\n") || "—";
  }
  function sortEvents(list){
    return list.slice().sort(function(a,b){
      var ta = a.ts || a.time || a.at || "", tb = b.ts || b.time || b.at || "";
      var ma = (typeof ta === "number") ? (ta < 1e12 ? ta*1000 : ta) : Date.parse(ta);
      var mb = (typeof tb === "number") ? (tb < 1e12 ? tb*1000 : tb) : Date.parse(tb);
      return (isFinite(ma)?ma:0) - (isFinite(mb)?mb:0);
    });
  }
  function renderEvents(events){
    var keep = events.map(function(e){ var i = evInfo(e); i.e = e; return i; })
      .filter(function(i){ return filter === "all" || i.cat === filter; });
    if(!keep.length) return '<div class="tt-empty">' +
      (events.length ? "Событий этого типа нет." : "Событий в process_api нет.") + '</div>';
    return keep.map(function(i){
      return '<div class="tt-ev"><span class="tt-evts">' + esc(hhmmss(i.e.ts || i.e.time || i.e.at)) + '</span>' +
        '<span class="tt-badge ' + i.cat + '">' + esc(i.label) + '</span>' +
        '<span class="tt-evtext">' + esc(evText(i.e)) + '</span></div>';
    }).join("");
  }
  function bindFilters(events){
    Array.prototype.forEach.call(panel.querySelectorAll(".tt-filter"), function(b){
      b.addEventListener("click", function(){
        filter = b.dataset.filter;
        Array.prototype.forEach.call(panel.querySelectorAll(".tt-filter"), function(x){
          x.classList.toggle("on", x === b);
        });
        var box = $("#ttEvents"); if(box) box.innerHTML = renderEvents(events);
      });
    });
  }

  /* ---------- main load ---------- */
  function load(task){
    var node = null, events = [], chain = [], src = "";
    apiCall("/nodes/" + encodeURIComponent(task.id)).then(function(res){
      if(res && res.node){
        node = res.node;
        events = Array.isArray(res.events) ? sortEvents(res.events) : [];
        src = "process_api · /nodes/" + task.id;
        return buildApiChain(task.id, node);
      }
      return null;
    }).then(function(apiChain){
      if(apiChain && apiChain.length){ chain = apiChain; }
      else {
        var st = staticChain(task.id);
        if(st){ chain = st; src = "tree.json · статическое дерево прогресса"; }
      }
      render(task, node, chain, events, src);
    }).catch(function(err){
      render(task, node, chain, events, src, (err && err.message) ? err.message : String(err));
    });
  }

  function render(task, node, chain, events, src, err){
    if(current !== task) return;   // closed / switched
    var body = $("#ttBody"), html = "";

    /* 1. источник и исходные данные */
    var t = task.raw || {};
    var kv = [
      ["ID", task.id],
      ["очередь / источник", task.source || t.source || "—"],
      ["claimed", task.ts || "—"],
      ["возраст", task.age != null ? task.age + " мин" : "—"],
      ["шаг progress", task.task || t.task || "—"],
      ["заметка", t.note || "—"]
    ];
    html += '<section class="tt-sec"><div class="tt-eyebrow">Источник задачи</div><div class="tt-card">' +
      kv.map(function(p){ return '<div class="tt-kv"><b>' + esc(p[0]) + '</b><span>' + esc(p[1]) + '</span></div>'; }).join("") +
      '</div></section>';

    /* 2. цепочка узел → родитель → корень */
    html += '<section class="tt-sec"><div class="tt-eyebrow">Цепочка · узел → родитель → корень</div>';
    if(chain.length){
      html += '<div class="tt-card"><div class="tt-chain">' + chain.slice().reverse().map(function(n, i){
        var id = normId(n.id != null ? n.id : (n._id != null ? n._id : n.node_id));
        var title = n.title || n.name || id;
        var isLast = (i === chain.length-1);
        var cls = (i === 0 ? " current" : "") + (isLast ? " root" : "");
        var meta = [id, (n.status || ""), (n.step || ""), (n.kind || "")].filter(Boolean).join(" · ");
        return '<div class="tt-node' + cls + '">' +
          '<span class="tt-depth">' + (i === 0 ? "узел" : (isLast ? "↳ корень" : "↳ родитель " + i)) + '</span>' +
          '<span class="tt-nlabel">' + esc(short(title, 180)) + '</span>' +
          (i === 0 ? '<span class="tt-cur">эта задача</span>' : "") +
          '<div class="tt-nmeta">' + esc(meta) + '</div></div>';
      }).join("") + '</div></div>';
      html += '<div class="tt-foot">' + esc(src) + '</div>';
    } else {
      html += '<div class="tt-empty">Нет данных о дереве: узел process_api с ID <b>' + esc(task.id) +
        '</b> не найден' + (err ? " (" + esc(err) + ")" : "") +
        ', в статическом tree.json его тоже нет. Цепочку не выдумываем.</div>';
    }
    html += '</section>';

    /* 3. хронология событий шагов */
    html += '<section class="tt-sec"><div class="tt-eyebrow">Последовательность шагов · ' +
      events.length + '</div>';
    if(events.length){
      html += '<div class="tt-filters">' +
        [["all","все"],["step_start","шаги"],["text","текст"],["error","ошибки"],["done","итог"]]
          .map(function(p){ return '<button class="tt-filter' + (filter === p[0] ? " on" : "") +
            '" data-filter="' + p[0] + '">' + p[1] + '</button>'; }).join("") + '</div>';
    }
    html += '<div class="tt-card" id="ttEvents">' + renderEvents(events) + '</div></section>';

    /* 4. финальный ответ / результат + привязка к промпту */
    var answer = node && (node.answer || node.result || node.output || node.text ||
      (node.question && node.question.text));
    if(!answer){
      var lastDone = events.slice().reverse().find(function(e){
        var info = evInfo(e);
        return info.cat === "done" || info.cat === "text" || info.cat === "error";
      });
      if(lastDone) answer = evText(lastDone);
    }
    html += '<section class="tt-sec"><div class="tt-eyebrow">Финальный ответ / результат</div>';
    html += answer ? '<div class="tt-card"><div class="tt-answer">' + esc(short(answer, 4000)) + '</div></div>'
                   : '<div class="tt-empty">Нет данных: process_api не вернул answer/result/text для этого узла.</div>';
    html += '</section>';

    var ref = node && node.ref;
    html += '<section class="tt-sec"><div class="tt-eyebrow">Привязка · сессия / промпт / проект</div><div class="tt-card">';
    var refs = node ? [
      ["проект", node.project_id || "—"],
      ["тип узла", node.kind || "—"],
      ["модель", node.model || "—"],
      ["промпт", (ref && (ref.prompt || ref.prompt_id)) || "не указан в данных"],
      ["сессия", (ref && (ref.ses || ref.session)) || "не указана в данных"],
      ["задача ПК", (ref && (ref.pc_task || ref.unit)) || "—"]
    ] : [["привязка", "нет данных process_api для этого ID"]];
    html += refs.map(function(p){
      return '<div class="tt-kv"><b>' + esc(p[0]) + '</b><span>' + esc(p[1] || "—") + '</span></div>';
    }).join("") + '</div></section>';

    html += '<div class="tt-foot">данные: live.json · process_api · tree.json · Esc — закрыть</div>';
    body.innerHTML = html;
    bindFilters(events);
  }
})();
