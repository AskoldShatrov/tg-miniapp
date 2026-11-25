/* views.js — универсальный рендер декларативных представлений мини-апа.
   Загружается после index.html. Внешних библиотек нет.
   Спецификация: window.MINIAPP_VIEWS_SRC (по умолчанию "views.json") либо
   window.MINIAPP_VIEWS (inline-спецификация, если сборщик её подложил).
   Нет views.json / нет данных — показываем честное «нет данных» и ничего не выдумываем.

   Поддерживаемые типы: cards | checklist | tree | table | decision.
   Общие элементы: поиск, фильтры из spec, сортировка, выделить всё/снять,
   счётчик выбранных, поле решения, комментарий и кнопка действия.
   Действие собирает payload {source:"miniapp_selection", view, ids, decision,
   comment, ts}, звонит tg.sendData (если доступен) и показывает toast.
   Тип decision — карточки да/нет/не знаю (не более 5): sendYesNo шлёт отдельный
   payload {source:"miniapp_yesno", question_id, answer, scope, ts}; мини-ап
   miniapp_selection не перегружается. Горячие клавиши: y / n / u.
   tg.close НЕ вызывается намеренно — закрытие решает вызывающая сторона. */
(function(){
  "use strict";

  var SRC = (typeof window.MINIAPP_VIEWS_SRC === "string" && window.MINIAPP_VIEWS_SRC.trim())
    ? window.MINIAPP_VIEWS_SRC.trim() : "views.json";
  var INLINE = (window.MINIAPP_VIEWS && Array.isArray(window.MINIAPP_VIEWS.views))
    ? window.MINIAPP_VIEWS : null;
  var MAXDEPTH = 12;

  var V = {
    views: [], cur: null, data: {}, specError: null,
    search: "", sort: {}, desc: {}, filters: {}, selected: {}, collapsed: {},
    decision: {}, comment: {}, wrapped: [], visible: [], ynAnswered: {},
    lastLoadAt: 0
  };

  /* ---------- helpers ---------- */
  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function $(sel, root){ return (root || document).querySelector(sel); }
  function isObj(x){ return x != null && typeof x === "object" && !Array.isArray(x); }
  function getPath(o, p){
    if(!p) return undefined;
    var parts = String(p).split("."), cur = o;
    for(var i=0;i<parts.length;i++){
      if(cur == null || typeof cur !== "object") return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }
  function asText(x){
    if(x == null) return "";
    if(Array.isArray(x)) return x.map(asText).filter(Boolean).join(", ");
    if(isObj(x)){
      var k = x.name != null ? x.name : (x.title != null ? x.title : (x.label != null ? x.label : x.id));
      return k != null ? String(k) : JSON.stringify(x);
    }
    return String(x);
  }
  function tsHuman(v){
    if(!v) return "";
    var ms = (typeof v === "number") ? (v < 1e12 ? v*1000 : v) : Date.parse(v);
    if(!isFinite(ms)) return String(v).slice(11,19) || String(v);
    var d = new Date(ms);
    return [d.getHours(), d.getMinutes()].map(function(n){ return String(n).padStart(2,"0"); }).join(":");
  }
  function viewId(v){ return String(v && v.id != null ? v.id : (v && v.title) || "view"); }
  function pickOf(id){ if(!V.selected[id]) V.selected[id] = {}; return V.selected[id]; }
  function currentView(){
    for(var i=0;i<V.views.length;i++) if(viewId(V.views[i]) === V.cur) return V.views[i];
    return null;
  }
  function idOf(item, v, i){
    var val = v && v.value_field ? getPath(item, v.value_field) : undefined;
    if(val == null && item) val = item.id != null ? item.id : (item._id != null ? item._id :
      (item.key != null ? item.key : item.node_id));
    if(val == null) return "#" + (i+1); // позиционный id, явно помечен решёткой
    return String(val);
  }
  function labelOf(item, v){
    var val = v && v.label_field ? getPath(item, v.label_field) : undefined;
    if(val == null && item) val = item.title != null ? item.title : (item.name != null ? item.name :
      (item.label != null ? item.label : (item.id != null ? item.id : item.q)));
    return asText(val) || "—";
  }
  function metaList(item, v){
    var fs = Array.isArray(v && v.meta_fields) ? v.meta_fields : [];
    return fs.map(function(f){
      var val = getPath(item, f);
      if(Array.isArray(val)) val = val.map(asText).join(", ");
      else if(isObj(val)) val = asText(val);
      return {k:f, v:(val == null || val === "") ? "—" : String(val)};
    });
  }
  function normalizeData(raw){
    if(Array.isArray(raw)) return raw.filter(isObj);
    if(isObj(raw)){
      var prefer = ["items","nodes","rows","decisions","cards","questions","tasks","views","data","list","results"];
      for(var i=0;i<prefer.length;i++) if(Array.isArray(raw[prefer[i]])) return raw[prefer[i]].filter(isObj);
      var ks = Object.keys(raw);
      for(var j=0;j<ks.length;j++) if(Array.isArray(raw[ks[j]])) return raw[ks[j]].filter(isObj);
    }
    return [];
  }
  function sourceURL(v){
    var s = v && v.source;
    if(Array.isArray(s) || isObj(s)) return null;
    s = String(s || "").trim();
    if(!s) return null;
    // Приватные/API-источники с ведущим '/' — это эндпоинты process_api,
    // а не файлы на GitHub Pages. Без этого /private/review давал 404.
    if(s.charAt(0) === "/"){
      /* Приватный process_api отключён для публичного Pages. Не превращаем
         endpoint в относительный URL, который гарантированно даёт 404/зависает. */
      return null;
    }
    if(!/\.(json|js)($|\?)/.test(s) && s.indexOf("/") < 0) s += ".json";
    return s;
  }
  function inlineSource(v){
    var s = v && v.source;
    if(Array.isArray(s)) return normalizeData(s);
    if(isObj(s)) return normalizeData(s);
    return null;
  }
  function fetchJSON(url, bust){
    var u = String(url);
    if(bust) u += (u.indexOf("?") >= 0 ? "&" : "?") + "_=" + Date.now();
    var headers = {};
    var opts={cache:"no-store", headers:headers};
    if(typeof AbortController === "function"){
      var ctl=new AbortController();
      opts.signal=ctl.signal;
      setTimeout(function(){ctl.abort();},10000);
    }
    return fetch(u, opts).then(function(r){
      if(!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  /* ---------- фильтрация / сортировка / группировка ---------- */
  function wrapItems(v, items){
    return items.map(function(it, i){ return {item:it, id:idOf(it,v,i), label:labelOf(it,v)}; });
  }
  function itemMatchesFilters(item, v){
    var fs = Array.isArray(v && v.filters) ? v.filters : [];
    for(var i=0;i<fs.length;i++){
      var field = fs[i] && fs[i].field, sel = V.filters[field];
      if(!sel) continue;
      var active = Object.keys(sel).filter(function(k){ return sel[k]; });
      if(!active.length) continue;
      var val = getPath(item, field), text = asText(val);
      var list = Array.isArray(val) ? val.map(asText) : [text];
      var ok = false;
      for(var j=0;j<active.length;j++) if(list.indexOf(active[j]) >= 0 || text === active[j]) { ok = true; break; }
      if(!ok) return false;
    }
    return true;
  }
  function itemMatchesSearch(item){
    var q = V.search.trim().toLowerCase();
    if(!q) return true;
    try { return JSON.stringify(item).toLowerCase().indexOf(q) >= 0; }
    catch(e){ return asText(item).toLowerCase().indexOf(q) >= 0; }
  }
  function visibleItems(v, wrapped, id){
    var out = wrapped.filter(function(w){ return itemMatchesSearch(w.item) && itemMatchesFilters(w.item, v); });
    var field = V.sort[id];
    if(field){
      out.sort(function(a,b){
        var av = getPath(a.item, field), bv = getPath(b.item, field), c;
        if(typeof av === "number" && typeof bv === "number") c = av - bv;
        else c = asText(av).localeCompare(asText(bv), "ru");
        return V.desc[id] ? -c : c;
      });
    }
    return out;
  }
  function groupWrapped(wrapped, field){
    var map = {}, order = [];
    wrapped.forEach(function(w){
      var key = asText(field ? getPath(w.item, field) : "—") || "—";
      if(!(key in map)){ map[key] = []; order.push(key); }
      map[key].push(w);
    });
    return order.map(function(k){ return {key:k, items:map[k]}; });
  }
  function columnsOf(v, wrapped){
    var fs = [];
    function add(f){ f = String(f || "").replace(/^-/, "").split(":")[0]; if(f && fs.indexOf(f) < 0) fs.push(f); }
    add(v && v.value_field); add(v && v.label_field);
    (Array.isArray(v && v.meta_fields) ? v.meta_fields : []).forEach(add);
    if(v && v.group_by) add(v.group_by);
    if(v && v.sort_by) add(v.sort_by);
    (Array.isArray(v && v.filters) ? v.filters : []).forEach(function(f){ add(f && f.field); });
    wrapped.slice(0,3).forEach(function(w){ Object.keys(w.item).slice(0,8).forEach(add); });
    return fs.slice(0,12);
  }
  function fieldOptions(v, wrapped){
    var fs = [];
    function add(f){ f = String(f || "").replace(/^-/, "").split(":")[0]; if(f && fs.indexOf(f) < 0) fs.push(f); }
    add(v && v.group_by); add(v && v.sort_by); add(v && v.label_field); add(v && v.value_field);
    (Array.isArray(v && v.meta_fields) ? v.meta_fields : []).forEach(add);
    (Array.isArray(v && v.filters) ? v.filters : []).forEach(function(f){ add(f && f.field); });
    wrapped.slice(0,1).forEach(function(w){ Object.keys(w.item).slice(0,10).forEach(add); });
    return fs;
  }

  /* ---------- дерево ---------- */
  function buildTree(v, wrapped){
    var childField = null, parentField = null;
    var ck = ["children","items","nodes","subtasks","child","steps"];
    var pk = ["parent_id","parentId","parent","parent_ref","pid","ref"];
    var i, j;
    for(i=0;i<ck.length && !childField;i++){
      (function(key){ if(wrapped.some(function(w){ return Array.isArray(getPath(w.item,key)); })) childField = key; })(ck[i]);
    }
    for(j=0;j<pk.length && !parentField;j++){
      (function(key){ if(wrapped.some(function(w){ return getPath(w.item,key) != null; })) parentField = key; })(pk[j]);
    }
    var byId = {};
    wrapped.forEach(function(w){ byId[w.id] = w; });
    function node(w, depth){ return {key:w.id, id:w.id, w:w, label:w.label, depth:depth, children:[]}; }
    function childWrap(ch){
      if(isObj(ch)){
        var cid = ch.id != null ? ch.id : (ch._id != null ? ch._id : ch.key);
        return (cid != null && byId[String(cid)]) || wrapItems(v, [ch])[0];
      }
      return byId[String(ch)];
    }
    if(childField){
      var referenced = {};
      wrapped.forEach(function(w){
        (getPath(w.item, childField) || []).forEach(function(ch){
          var cw = childWrap(ch); if(cw) referenced[cw.id] = true;
        });
      });
      function walk(w, depth, seen){
        var n = node(w, depth);
        if(depth >= MAXDEPTH) return n;
        var seen2 = {}; for(var sk in seen) seen2[sk] = seen[sk]; seen2[w.id] = true;
        (getPath(w.item, childField) || []).forEach(function(ch){
          var cw = childWrap(ch);
          if(cw && !seen2[cw.id]) n.children.push(walk(cw, depth+1, seen2));
        });
        return n;
      }
      return wrapped.filter(function(w){ return !referenced[w.id]; }).map(function(w){ return walk(w,0,{}); });
    }
    if(parentField){
      var roots = [], map = {};
      wrapped.forEach(function(w){ map[w.id] = node(w,0); });
      wrapped.forEach(function(w){
        var p = getPath(w.item, parentField);
        var pid = p == null ? "" : (isObj(p) ? asText(p) : String(p));
        if(pid && map[pid] && map[pid] !== map[w.id]) map[pid].children.push(map[w.id]);
        else roots.push(map[w.id]);
      });
      function setDepth(n,d){ n.depth=d; n.children.forEach(function(c){ setDepth(c,d+1); }); }
      roots.forEach(function(n){ setDepth(n,0); });
      return roots;
    }
    if(v && v.group_by){
      return groupWrapped(wrapped, v.group_by).map(function(g){
        return {key:"g:"+g.key, label:g.key, group:true, depth:0,
          children:g.items.map(function(w){ return node(w,1); })};
      });
    }
    return wrapped.map(function(w){ return node(w,0); });
  }

  /* ---------- CSS (Catppuccin Mocha, локальные переменные с фолбэками) ---------- */
  var CSS = [
    ".vw-launch{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:80;",
      "border:1px solid var(--surface1,#45475a);background:var(--surface0,#313244);color:var(--text,#cdd6f4);",
      "border-radius:999px;padding:9px 13px;font:700 11.5px/1 var(--ff,sans-serif);box-shadow:0 8px 24px rgba(0,0,0,.4);",
      "cursor:pointer;display:flex;gap:6px;align-items:center}",
    ".vw-launch span{color:var(--lavender,#cba6f7)}",
    ".vw-back{position:fixed;inset:0;background:rgba(17,17,27,.72);z-index:81;opacity:0;pointer-events:none;transition:opacity .2s}",
    ".vw-back.open{opacity:1;pointer-events:auto}",
    ".vw-panel{position:fixed;top:0;right:0;bottom:0;width:min(520px,100%);z-index:82;",
      "background:var(--base,#1e1e2e);color:var(--text,#cdd6f4);border-left:1px solid var(--surface1,#45475a);",
      "box-shadow:var(--shadow,0 10px 30px rgba(0,0,0,.35));display:flex;flex-direction:column;",
      "transform:translateX(102%);transition:transform .22s ease;padding-top:env(safe-area-inset-top,0px)}",
    ".vw-panel.open{transform:translateX(0)}",
    ".vw-head{display:flex;align-items:flex-start;gap:10px;padding:15px 15px 12px;border-bottom:1px solid var(--surface0,#313244);background:var(--crust,#11111b)}",
    ".vw-headtxt{flex:1;min-width:0}",
    ".vw-eyebrow{font:700 9.5px/1.2 var(--fm,monospace);letter-spacing:1px;text-transform:uppercase;color:var(--overlay1,#7f849c);margin-bottom:6px;word-break:break-all}",
    ".vw-htitle{font-size:16px;font-weight:700}",
    ".vw-hsub{font:600 10px/1.5 var(--fm,monospace);color:var(--overlay2,#9399b2);margin-top:4px}",
    ".vw-close{flex:none;width:32px;height:32px;border-radius:9px;border:1px solid var(--surface1,#45475a);background:var(--surface0,#313244);color:var(--text,#cdd6f4);font:700 18px/1 var(--ff,sans-serif);cursor:pointer}",
    ".vw-close:active{background:var(--surface2,#585b70)}",
    ".vw-select{display:flex;gap:6px;overflow-x:auto;padding:10px 14px;border-bottom:1px solid var(--surface0,#313244);flex:0 0 auto}",
    ".vw-vchip{flex:none;max-width:190px;text-align:left;border:1px solid var(--surface1,#45475a);background:var(--mantle,#181825);",
      "color:var(--subtext1,#bac2de);border-radius:10px;padding:7px 10px;cursor:pointer;font:600 11px/1.35 var(--ff,sans-serif)}",
    ".vw-vchip.on{border-color:var(--blue,#89b4fa);background:rgba(137,180,250,.1);color:var(--text,#cdd6f4)}",
    ".vw-vchip small{display:block;font:600 9px/1.4 var(--fm,monospace);color:var(--overlay1,#7f849c);margin-top:3px}",
    ".vw-body{overflow-y:auto;overscroll-behavior:contain;padding:12px 14px 28px;-webkit-overflow-scrolling:touch;flex:1 1 auto}",
    ".vw-bar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:9px}",
    ".vw-in,.vw-sel{border:1px solid var(--surface1,#45475a);background:var(--mantle,#181825);color:var(--text,#cdd6f4);",
      "border-radius:9px;padding:8px 10px;font:500 11px/1.3 var(--ff,sans-serif);min-width:0}",
    ".vw-in::placeholder{color:var(--overlay0,#6c7086)}",
    ".vw-search{flex:1 1 150px}",
    ".vw-btn{flex:none;border:1px solid var(--surface1,#45475a);background:var(--surface0,#313244);color:var(--subtext1,#bac2de);",
      "border-radius:9px;padding:8px 9px;font:700 10px/1 var(--ff,sans-serif);cursor:pointer;white-space:nowrap}",
    ".vw-btn:active{background:var(--surface2,#585b70)}",
    ".vw-btn.on{border-color:var(--blue,#89b4fa);color:var(--blue,#89b4fa);background:rgba(137,180,250,.1)}",
    ".vw-count{font:700 10px/1 var(--fm,monospace);color:var(--teal,#94e2d5);white-space:nowrap}",
    ".vw-filters{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}",
    ".vw-fgroup{display:flex;gap:5px;align-items:center;flex-wrap:wrap}",
    ".vw-flabel{font:700 9.5px/1 var(--fm,monospace);color:var(--overlay1,#7f849c);min-width:58px;word-break:break-all}",
    ".vw-chip{border:1px solid var(--surface1,#45475a);background:transparent;color:var(--overlay2,#9399b2);",
      "border-radius:999px;padding:5px 9px;font:700 9.5px/1 var(--fm,monospace);cursor:pointer}",
    ".vw-chip.on{border-color:var(--lavender,#cba6f7);color:var(--lavender,#cba6f7);background:rgba(203,166,247,.1)}",
    ".vw-actions{display:flex;gap:6px;flex-wrap:wrap;margin:9px 0 4px}",
    ".vw-act{flex:1 1 auto;border:1px solid rgba(166,227,161,.4);background:rgba(166,227,161,.1);color:var(--green,#a6e3a1);",
      "border-radius:10px;padding:10px 11px;font:700 11px/1.2 var(--ff,sans-serif);cursor:pointer;min-width:120px}",
    ".vw-act:active{background:rgba(166,227,161,.2)}",
    ".vw-note{font:500 10.5px/1.5 var(--fm,monospace);color:var(--overlay1,#7f849c);margin:6px 0 10px}",
    ".vw-card{background:var(--mantle,#181825);border:1px solid var(--surface0,#313244);border-radius:var(--radius-sm,11px);",
      "padding:10px 11px;margin-bottom:7px}",
    ".vw-card.sel{border-color:rgba(137,180,250,.55);background:rgba(137,180,250,.06)}",
    ".vw-row{display:flex;gap:8px;align-items:flex-start;padding:8px 4px;border-bottom:1px solid var(--surface0,#313244)}",
    ".vw-row.sel{background:rgba(137,180,250,.06)}",
    ".vw-row input[type=checkbox],.vw-card input[type=checkbox],.vw-node input[type=checkbox]{accent-color:var(--blue,#89b4fa);margin-top:2px;flex:none}",
    ".vw-main{flex:1;min-width:0}",
    ".vw-title{font-size:12px;font-weight:600;line-height:1.4;word-break:break-word}",
    ".vw-id{font:600 9px/1.4 var(--fm,monospace);color:var(--overlay0,#6c7086);word-break:break-all}",
    ".vw-metas{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}",
    ".vw-meta{font:600 9.5px/1.4 var(--fm,monospace);color:var(--subtext1,#bac2de);background:var(--surface0,#313244);",
      "border-radius:6px;padding:3px 6px;word-break:break-all}",
    ".vw-meta b{color:var(--overlay2,#9399b2);font-weight:700;margin-right:4px}",
    ".vw-group{margin:10px 0}",
    ".vw-ghead{display:flex;gap:7px;align-items:center;padding:7px 8px;border-radius:9px;background:var(--surface0,#313244);",
      "font:700 10.5px/1.3 var(--fm,monospace);color:var(--blue,#89b4fa);cursor:pointer}",
    ".vw-ghead span.n{margin-left:auto;color:var(--overlay1,#7f849c)}",
    ".vw-group .vw-row{padding-left:12px}",
    ".vw-node{position:relative;padding:4px 0 4px 6px;border-left:1px solid var(--surface1,#45475a)}",
    ".vw-kids{margin-left:14px}",
    ".vw-nhead{display:flex;gap:7px;align-items:flex-start;min-width:0}",
    ".vw-toggle{flex:none;width:20px;height:20px;border-radius:6px;border:1px solid var(--surface1,#45475a);",
      "background:var(--surface0,#313244);color:var(--subtext1,#bac2de);font:700 11px/1 var(--fm,monospace);cursor:pointer}",
    ".vw-toggle.leaf{visibility:hidden}",
    ".vw-tablewrap{overflow-x:auto;border:1px solid var(--surface0,#313244);border-radius:10px}",
    ".vw-table{border-collapse:collapse;width:100%;font:500 10.5px/1.45 var(--fm,monospace)}",
    ".vw-table th,.vw-table td{padding:7px 8px;text-align:left;border-bottom:1px solid var(--surface0,#313244);white-space:nowrap;max-width:240px;overflow:hidden;text-overflow:ellipsis}",
    ".vw-table th{color:var(--overlay2,#9399b2);font-weight:700;background:var(--crust,#11111b);position:sticky;top:0;z-index:1}",
    ".vw-table tr.sel td{background:rgba(137,180,250,.06)}",
    ".vw-atlas-link,.vw-voice-link{display:inline-block;margin:0 4px 2px 0;padding:1px 6px;border-radius:6px;border:1px solid rgba(137,180,250,.35);background:rgba(137,180,250,.08);color:var(--blue,#89b4fa);font:600 10px/1.4 var(--fm,monospace);cursor:pointer}",
    ".vw-atlas-link:hover,.vw-voice-link:hover{background:rgba(137,180,250,.18);color:var(--text,#cdd6f4)}",
    ".vw-empty{border:1px dashed var(--surface1,#45475a);border-radius:10px;padding:14px 12px;",
      "font:500 11.5px/1.6 var(--ff,sans-serif);color:var(--overlay1,#7f849c);word-break:break-word}",
    ".vw-empty b{color:var(--yellow,#f9e2af)}",
    ".vw-yn-card{background:var(--mantle,#181825);border:1px solid var(--surface0,#313244);border-radius:var(--radius-sm,11px);padding:11px 12px;margin-bottom:8px}",
    ".vw-yn-card.overdue{border-color:rgba(249,226,175,.4)}",
    ".vw-yn-card.answered{opacity:.62}",
    ".vw-yn-top{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:7px}",
    ".vw-yn-badge{font:700 9px/1.3 var(--fm,monospace);padding:2px 6px;border-radius:6px;background:var(--surface0,#313244);color:var(--subtext1,#bac2de)}",
    ".vw-yn-badge.pri{color:var(--yellow,#f9e2af);background:rgba(249,226,175,.1)}",
    ".vw-yn-badge.overdue{color:var(--red,#f38ba8);background:rgba(243,139,168,.12)}",
    ".vw-yn-badge.done{color:var(--green,#a6e3a1);background:rgba(166,227,161,.12)}",
    ".vw-yn-text{font-size:12.5px;font-weight:600;line-height:1.45;word-break:break-word;color:var(--text,#cdd6f4)}",
    ".vw-yn-scope{font:500 10px/1.5 var(--fm,monospace);color:var(--overlay1,#7f849c);margin-top:5px;word-break:break-all}",
    ".vw-yn-dl{font:500 10px/1.5 var(--fm,monospace);color:var(--overlay2,#9399b2);margin-top:3px}",
    ".vw-yn-btns{display:flex;gap:7px;margin-top:9px;flex-wrap:wrap}",
    ".vw-yn-btn{flex:1;min-width:76px;border:1px solid var(--surface1,#45475a);border-radius:8px;background:var(--surface0,#313244);color:var(--subtext1,#bac2de);font:700 11.5px/1.3 var(--ff,sans-serif);padding:8px 6px;cursor:pointer;transition:.15s}",
    ".vw-yn-btn:hover:not(:disabled){background:var(--surface1,#45475a);color:var(--text,#cdd6f4)}",
    ".vw-yn-btn.yes:hover:not(:disabled){border-color:var(--green,#a6e3a1);color:var(--green,#a6e3a1)}",
    ".vw-yn-btn.no:hover:not(:disabled){border-color:var(--red,#f38ba8);color:var(--red,#f38ba8)}",
    ".vw-yn-btn.unknown:hover:not(:disabled){border-color:var(--overlay2,#9399b2);color:var(--overlay2,#9399b2)}",
    ".vw-yn-btn:disabled{opacity:.45;cursor:default}",
    ".vw-yn-hint{font:500 9.5px/1.4 var(--fm,monospace);color:var(--overlay0,#6c7086);margin-top:8px}",
    ".vw-toast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom,0px));transform:translate(-50%,12px);z-index:99;",
      "background:var(--surface2,#585b70);color:var(--text,#cdd6f4);border:1px solid var(--overlay0,#6c7086);",
      "padding:10px 15px;border-radius:999px;font:600 11.5px/1.3 var(--ff,sans-serif);box-shadow:var(--shadow,0 10px 30px rgba(0,0,0,.35));",
      "opacity:0;pointer-events:none;transition:.25s;max-width:90vw;text-align:center}",
    ".vw-toast.show{opacity:1;transform:translate(-50%,0)}",
    /* Индикатор открытия: виден в кадре клика, не ловит тапы, живёт до render. */
    "@keyframes vwOpenShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}",
    ".vw-opening{position:absolute;left:14px;right:14px;top:calc(env(safe-area-inset-top,0px) + 78px);z-index:10;",
      "display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;pointer-events:none;",
      "background:rgba(30,30,46,.96);border:1px solid var(--surface1,#45475a);",
      "box-shadow:0 8px 24px rgba(0,0,0,.4);font:600 11px/1.3 var(--ff,sans-serif);color:var(--blue,#89b4fa)}",
    ".vw-opening[hidden]{display:none}",
    ".vw-opening .vw-op-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}",
    ".vw-opening .vw-op-bar{flex:1 1 24px;height:3px;border-radius:3px;",
      "background:linear-gradient(90deg,var(--surface0,#313244),var(--blue,#89b4fa),var(--surface0,#313244));",
      "background-size:200% 100%;animation:vwOpenShimmer 1.1s linear infinite}",
    ".vw-opening .vw-op-ms{flex:none;font:700 10px/1 var(--fm,monospace);color:var(--overlay2,#9399b2)}",
    "@media (prefers-reduced-motion:reduce){.vw-opening .vw-op-bar{animation:none}}"
  ].join("\n");

  var toastTimer = null;
  function vtoast(msg){
    var t = $("#vwToast");
    if(!t){
      t = document.createElement("div"); t.id = "vwToast"; t.className = "vw-toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ t.classList.remove("show"); }, 2200);
  }

  /* ---------- видимое состояние: источник, время, индикатор открытия ---------- */
  function nowMs(){ return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function clockHMS(v){
    var ms = (typeof v === "number") ? v : Date.parse(v);
    if(!ms || !isFinite(ms)) return "--:--:--";
    var d = new Date(ms);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(function(n){
      return String(n).padStart(2,"0");
    }).join(":");
  }
  function hostSubtitle(){
    return "HOST: " + SRC + " · " + V.views.length + " видов · последняя загрузка " +
      clockHMS(V.lastLoadAt) + " · скрытый приватный доступ только локально";
  }
  function setHostSub(){
    var h = $("#vwHsub");
    if(h){ h.textContent = hostSubtitle(); h._vwSkel = false; }
  }
  function markLoaded(){ V.lastLoadAt = Date.now(); setHostSub(); }

  var openState = null;
  function ensureOpenCSS(){
    if($("#vwOpenCSS")) return;
    var st = document.createElement("style"); st.id = "vwOpenCSS";
    /* Стили индикатора уже лежат в основном CSS (ensureShell) — здесь только
       страховка для случая, когда open-индикатор вызван до создания оболочки. */
    st.textContent = ".vw-opening{position:absolute;left:14px;right:14px;top:calc(env(safe-area-inset-top,0px) + 78px);z-index:10;" +
      "display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;pointer-events:none;" +
      "background:#1e1e2e;border:1px solid #45475a;color:#89b4fa;font:600 11px/1.3 sans-serif}";
    document.head.appendChild(st);
  }
  function showOpen(title){
    var panel = $("#vwPanel"); if(!panel) return;
    stopOpen();
    ensureOpenCSS();
    var el = $("#vwOpening");
    if(!el){
      el = document.createElement("div"); el.id = "vwOpening"; el.className = "vw-opening";
      panel.appendChild(el);
    }
    el.innerHTML = '<span class="vw-op-label">Открываю ' + esc(title || "вид") + '…</span>' +
      '<span class="vw-op-bar"></span><span class="vw-op-ms">0 мс</span>';
    el.hidden = false;
    var msEl = el.querySelector(".vw-op-ms");
    openState = { t0: nowMs(), el: el, ms: msEl, timer: null };
    openState.timer = setInterval(function(){
      if(!openState || !openState.ms) return;
      openState.ms.textContent = Math.round(nowMs() - openState.t0) + " мс";
    }, 100);
  }
  function stopOpen(){
    if(!openState) return;
    var s = openState; openState = null;
    if(s.timer) clearInterval(s.timer);
    if(s.el) s.el.hidden = true;
  }

  /* ---------- оболочка ---------- */
  function ensureShell(){
    if($("#vwPanel")) return;
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    var launch = document.createElement("button");
    launch.id = "vwLaunch"; launch.className = "vw-launch"; launch.type = "button";
    launch.innerHTML = '<span>◇</span> Виды';
    document.body.appendChild(launch);
    var back = document.createElement("div"); back.id = "vwBack"; back.className = "vw-back";
    var panel = document.createElement("div");
    panel.id = "vwPanel"; panel.className = "vw-panel";
    panel.setAttribute("role","dialog");
    panel.innerHTML =
      '<div class="vw-head"><div class="vw-headtxt">' +
        '<div class="vw-eyebrow">ДЕКЛАРАТИВНЫЕ ВИДЫ · ' + esc(SRC) + '</div>' +
        '<div class="vw-htitle">Виды</div><div class="vw-hsub" id="vwHsub">загрузка…</div></div>' +
        '<button class="vw-close" type="button" data-role="close" aria-label="Закрыть">×</button></div>' +
      '<div class="vw-select" id="vwSelect"></div>' +
      '<div class="vw-body" id="vwBody"></div>';
    document.body.appendChild(back); document.body.appendChild(panel);
    launch.addEventListener("click", open);
    back.addEventListener("click", close);
    panel.addEventListener("click", onClick);
    panel.addEventListener("change", onChange);
    panel.addEventListener("input", onInput);
    document.addEventListener("keydown", function(e){
      if(!panel.classList.contains("open")) return;
      if(e.key === "Escape"){ close(); return; }
      var v = currentView();
      if(!v || String(v.type || "") !== "decision") return;
      var tag = e.target && (e.target.tagName || "").toLowerCase();
      if(tag === "input" || tag === "textarea" || tag === "select") return;
      var k = String(e.key || "").toLowerCase(), map = {y:"yes", n:"no", u:"unknown"};
      if(!map[k]) return;
      var answered = V.ynAnswered[V.cur] || {}, target = null;
      for(var i=0;i<V.visible.length && i<5;i++){
        var w = V.visible[i], qid = ynIdOf(w, i);
        if(!answered[qid] && !(w.item && w.item.status === "answered")){ target = qid; break; }
      }
      if(!target){ vtoast("Все вопросы отвечены"); return; }
      e.preventDefault();
      sendYesNo(target, map[k]);
    });
  }
  function open(){ ensureShell(); $("#vwBack").classList.add("open"); $("#vwPanel").classList.add("open"); }
  function close(){ var p=$("#vwPanel"), b=$("#vwBack"); if(p) p.classList.remove("open"); if(b) b.classList.remove("open"); }

  /* ---------- загрузка спецификации и данных ---------- */
  function loadSpec(){
    if(INLINE){ applySpec(INLINE); return; }
    fetchJSON(SRC, false).then(applySpec).catch(function(err){
      V.specError = (err && err.message) ? err.message : String(err);
      renderSelector(); renderNoSpec();
    });
  }
  function applySpec(spec){
    V.views = Array.isArray(spec && spec.views) ? spec.views : [];
    V.specError = null;
    markLoaded();
    prefetchAll();
    renderSelector();
    var keep = V.cur, target = null;
    for(var i=0;i<V.views.length;i++) if(viewId(V.views[i]) === keep) target = keep;
    if(!target && V.views.length) target = viewId(V.views[0]);
    if(target) selectView(target);
    else { V.cur = null; renderNoSpec(); }
  }
  function loadData(v, force){
    var id = viewId(v);
    if(!force && V.data[id]){
      var d = V.data[id];
      if(d.redacted){ clearSkeleton(); renderBody(); renderRedacted(v, d); return; }
      if(d.loading){ scheduleSkeleton(); return; }
      if(!d.error && d.loadedAt && Date.now() - d.loadedAt < CACHE_TTL){ clearSkeleton(); renderBody(); return; }
    }
    var inline = inlineSource(v);
    if(inline){ V.data[id] = {items:inline, loadedAt:Date.now(), inline:true}; clearSkeleton(); renderBody(); return; }
    var url = sourceURL(v);
    if(!url){ V.data[id] = {items:[], error:"в спецификации вида нет source", loadedAt:Date.now()}; clearSkeleton(); renderBody(); return; }
    /* publish=false: приватный источник не запрашиваем вообще (req #4) */
    if(v.publish === false){
      V.data[id] = {items:[], redacted:true, hint:v.hint || "", loadedAt:Date.now()};
      clearSkeleton(); renderBody(); renderRedacted(v, V.data[id]); return;
    }
    scheduleSkeleton();
    fetchSource(v, force, false);
  }
  /* ---- точечная предзагрузка источников + TTL-кэш + скелетон (Catppuccin Mocha) ---- */
  var CACHE_TTL = 60000;
  var PREFETCH_LIMIT = 3;       // не более трёх параллельных fetch на телефоне
  var PREFETCH_DEFER_MS = 300;  // остальные виды — в простой, после idle/300 мс
  var pfQueue = [], pfActive = 0;
  var skelTimer = null;
  function clearSkeleton(){
    if(skelTimer){ clearTimeout(skelTimer); skelTimer = null; }
    var s = $("#vwSkel"); if(s && s.parentNode) s.parentNode.removeChild(s);
    var h = $("#vwHsub");
    if(h && h._vwSkel){
      h.textContent = hostSubtitle();
      h._vwSkel = false;
    }
  }
  function ensureSkelCSS(){
    if($("#vwSkelCSS")) return;
    var st = document.createElement("style"); st.id = "vwSkelCSS";
    st.textContent = [
      "@keyframes vwShimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}",
      ".vw-skel{padding:4px 2px}",
      ".vw-skel-bar,.vw-skel-line{height:12px;border-radius:6px;margin:9px 0;",
        "background:linear-gradient(90deg,var(--surface0,#313244) 25%,var(--surface1,#45475a) 50%,var(--surface0,#313244) 75%);",
        "background-size:200% 100%;animation:vwShimmer 1.2s linear infinite}",
      ".vw-skel-bar{height:36px;border-radius:10px}",
      ".vw-skel-line:nth-child(3){width:84%}",
      ".vw-skel-line:nth-child(4){width:62%}",
      ".vw-skel-line:nth-child(5){width:91%}",
      "@media (prefers-reduced-motion:reduce){.vw-skel-bar,.vw-skel-line{animation:none}}"
    ].join("\n");
    document.head.appendChild(st);
  }
  function scheduleSkeleton(){
    clearSkeleton();
    skelTimer = setTimeout(function(){
      skelTimer = null;
      var body = $("#vwBody"); if(!body) return;
      ensureSkelCSS();
      var h = $("#vwHsub"); if(h){ h.textContent = hostSubtitle(); h._vwSkel = true; }
      body.innerHTML = "<div class='vw-skel' id='vwSkel'><div class='vw-skel-bar'></div>" +
        "<div class='vw-skel-line'></div><div class='vw-skel-line'></div>" +
        "<div class='vw-skel-line'></div><div class='vw-skel-line'></div></div>";
    }, 90);
  }
  function renderRedacted(v, d){
    var box = $("#vwContent"); if(!box) return;
    box.innerHTML = "<div class='vw-empty'>Черновик (publish=false): приватный источник не запрашивается. " +
      (d.hint ? "<b>" + esc(d.hint) + "</b>" : "Данные не выдумываются.") + "</div>";
  }
  function fetchSource(v, force, prefetch){
    var id = viewId(v), url = sourceURL(v), d = V.data[id];
    if(!force && d && d.loadedAt && Date.now() - d.loadedAt < CACHE_TTL && !d.loading && !d.error) return Promise.resolve(d);
    if(d && d.inflight) return d.inflight;
    V.data[id] = {loading:true, items:(d && d.items) || [], url:url, prefetch:!!prefetch};
    var p = fetchJSON(url, !!force).then(function(raw){
      V.data[id] = {items:normalizeData(raw), url:url, loadedAt:Date.now(), prefetch:!!prefetch, ttl:CACHE_TTL};
      markLoaded();
      if(V.cur === id){ clearSkeleton(); renderBody(); }
      return V.data[id];
    }).catch(function(err){
      V.data[id] = {items:[], url:url, loadedAt:Date.now(), prefetch:!!prefetch,
        error:(err && err.message) ? err.message : String(err)};
      markLoaded();
      if(V.cur === id){ clearSkeleton(); renderBody(); }
      return V.data[id];
    });
    V.data[id].inflight = p;
    return p;
  }
  /* Планировщик предзагрузки: глобальный лимит 3, очередь без блокировки клика.
     Отложенные задачи помечаются ready=false и не запускаются до idle/300 мс. */
  function pfPump(){
    while(pfActive < PREFETCH_LIMIT){
      var at = -1;
      for(var i=0;i<pfQueue.length;i++){ if(pfQueue[i].ready){ at = i; break; } }
      if(at < 0) break;
      var job = pfQueue.splice(at, 1)[0];
      pfActive++;
      fetchSource(job.v, false, true).then(pfDone, pfDone);
    }
  }
  function pfDone(){ pfActive--; pfPump(); }
  function pfSubmit(tasks, deferred){
    if(!tasks || !tasks.length) return;
    tasks.forEach(function(v){ pfQueue.push({v:v, ready:!deferred}); });
    pfPump();
    if(deferred){
      var kick = function(){
        for(var i=0;i<pfQueue.length;i++) pfQueue[i].ready = true;
        pfPump();
      };
      if(typeof window.requestIdleCallback === "function")
        window.requestIdleCallback(kick, {timeout: PREFETCH_DEFER_MS});
      else setTimeout(kick, PREFETCH_DEFER_MS);
    }
  }
  function pfTarget(v){
    // publish=false (confidential) и inline-виды не предзагружаем никогда
    return !!v && v.publish !== false && !inlineSource(v) && !!sourceURL(v);
  }
  function pfNeighbours(center){
    var list = V.views.filter(pfTarget), out = [], i = 0, j;
    if(!list.length) return out;
    for(var k=0;k<list.length;k++) if(viewId(list[k]) === center){ i = k; break; }
    for(j=Math.max(0, i-1); j<=Math.min(list.length-1, i+1); j++) out.push(list[j]);
    return out;
  }
  function prefetchAll(){
    if(V.prefetchStarted && V.prefetchAt && Date.now() - V.prefetchAt < CACHE_TTL &&
       V.views.some(function(v){ return !!V.data[viewId(v)]; })) return V.prefetchDone;
    V.prefetchStarted = true; V.prefetchAt = Date.now();
    var list = V.views.filter(pfTarget);
    if(!list.length){ V.prefetchDone = Promise.resolve(); return V.prefetchDone; }
    var near = pfNeighbours(V.cur), nearIds = {};
    near.forEach(function(v){ nearIds[viewId(v)] = true; });
    var far = list.filter(function(v){ return !nearIds[viewId(v)]; });
    pfSubmit(near, false);  // активный + 2 соседа — сразу, клик не ждёт
    pfSubmit(far, true);    // остальные 7 — отложенно (idle или 300 мс)
    V.prefetchDone = Promise.resolve();
    return V.prefetchDone;
  }
  function selectView(id){
    var v = null;
    for(var i=0;i<V.views.length;i++) if(viewId(V.views[i]) === id) v = V.views[i];
    if(!v) return;
    V.cur = id;
    showOpen(v.title || v.id || id);
    renderSelector();
    loadData(v, false);
    pfSubmit(pfNeighbours(id), false);  // греем выбранный вид и его соседей
  }
  function setSearch(q){
    V.search = String(q || "");
    var inp = $("#vwSearch"); if(inp) inp.value = V.search;
    V.visible = visibleItems(currentView(), V.wrapped, V.cur);
    renderContent();
  }
  window.__miniappViews = {selectView: selectView, setSearch: setSearch, getState: function(){ return V; }};

  /* ---------- рендер ---------- */
  function renderSelector(){
    var box = $("#vwSelect"); if(!box) return;
    if(V.specError){
      box.innerHTML = '<div class="vw-empty">Нет данных: ' + esc(SRC) + ' недоступен (' + esc(V.specError) + ')</div>';
      return;
    }
    if(!V.views.length){ box.innerHTML = '<div class="vw-empty">Нет данных: в спецификации нет видов</div>'; return; }
    box.innerHTML = V.views.map(function(v){
      var id = viewId(v), d = V.data[id];
      var sub = [v.type || "cards", v.count != null ? ("count " + v.count) : "",
        v.publish === false ? "черновик" : "", tsHuman(v.built_at)].filter(Boolean).join(" · ");
      if(d && !d.loading) sub += (sub ? " · " : "") + (d.items ? d.items.length : 0) + " строк";
      return '<button type="button" class="vw-vchip' + (V.cur === id ? ' on' : '') +
        '" data-role="view" data-id="' + esc(id) + '">' + esc(v.title || v.id || id) +
        '<small>' + esc(sub) + '</small></button>';
    }).join("");
  }
  function renderNoSpec(){
    var body = $("#vwBody"); if(!body) return;
    stopOpen(); setHostSub();
    body.innerHTML = '<div class="vw-empty">Нет данных: specs <b>' + esc(SRC) +
      '</b> не загружен' + (V.specError ? ' (' + esc(V.specError) + ')' : '') +
      '. Ни один вид не выдуман — положите views.json рядом с index.html или задайте window.MINIAPP_VIEWS.</div>';
  }
  function renderLoading(){
    var body = $("#vwBody"); if(!body) return;
    setHostSub();
    body.innerHTML = '<div class="vw-empty">Загрузка источника данных вида…</div>';
  }
  function controlsHTML(v, wrapped){
    var id = viewId(v), fs = fieldOptions(v, wrapped), sel = V.sort[id] || "";
    var h = ["<div class='vw-bar'>",
      "<input class='vw-in vw-search' data-role='search' placeholder='Поиск по виду…' value='" + esc(V.search) + "'>",
      "<button type='button' class='vw-btn' data-role='selectAll' title='по текущему поиску и фильтрам'>Выделить всё</button>",
      "<button type='button' class='vw-btn' data-role='clearAll' title='снять выделение видимого'>Снять</button>",
      "<span class='vw-count' id='vwCount'>Выбрано: 0 / " + wrapped.length + "</span>",
      "<button type='button' class='vw-btn' data-role='refresh' title='перечитать spec и данные'>⟳</button>",
      "</div>"];
    var specFilters = Array.isArray(v.filters) ? v.filters : [];
    if(specFilters.length){
      h.push("<div class='vw-filters'>");
      specFilters.forEach(function(f){
        var field = f && f.field; if(!field) return;
        var vals = Array.isArray(f.values) ? f.values.map(asText) : [];
        if(!vals.length){
          var seen = {};
          wrapped.forEach(function(w){ var x = getPath(w.item, field); (Array.isArray(x)?x:[x]).forEach(function(y){
            var t = asText(y); if(t) seen[t] = true; }); });
          vals = Object.keys(seen).sort();
        }
        var active = V.filters[field] || {};
        h.push("<div class='vw-fgroup'><span class='vw-flabel'>" + esc(field) + "</span>");
        h.push("<button type='button' class='vw-chip" + (Object.keys(active).every(function(k){return !active[k];}) ? " on" : "") +
          "' data-role='chip' data-field='" + esc(field) + "' data-value=''>все</button>");
        vals.slice(0,40).forEach(function(val){
          h.push("<button type='button' class='vw-chip" + (active[val] ? " on" : "") +
            "' data-role='chip' data-field='" + esc(field) + "' data-value='" + esc(val) + "'>" + esc(val) + "</button>");
        });
        h.push("</div>");
      });
      h.push("</div>");
    }
    h.push("<div class='vw-bar'>");
    h.push("<span class='vw-flabel'>сортировка</span><select class='vw-sel' data-role='sort'><option value=''>- по порядку -</option>");
    fs.forEach(function(f){
      h.push("<option value='" + esc(f) + "'" + (sel === f ? " selected" : "") + ">" + esc(f) + "</option>");
    });
    h.push("</select><button type='button' class='vw-btn" + (V.desc[id] ? " on" : "") +
      "' data-role='dir' title='направление сортировки'>" + (V.desc[id] ? "↓ убыв" : "↑ возр") + "</button></div>");
    if(v.type !== "decision"){
      h.push("<div class='vw-bar'>");
      h.push("<input class='vw-in' data-role='decision' placeholder='решение (approve / reject / …)' value='" + esc(V.decision[id] || "") + "'>");
      h.push("<input class='vw-in' data-role='comment' placeholder='комментарий' value='" + esc(V.comment[id] || "") + "'>");
      h.push("</div>");
      var acts = Array.isArray(v.actions) ? v.actions.filter(function(a){ return a && a.label; }) : [];
      if(!acts.length) acts = [{label:"Отправить выбор", source:"miniapp_selection"}];
      h.push("<div class='vw-actions'>");
      acts.forEach(function(a){
        h.push("<button type='button' class='vw-act' data-role='action' data-label='" + esc(a.label) + "'>" + esc(a.label) + "</button>");
      });
      h.push("</div>");
    }
    var specBits = [];
    if(v.count != null) specBits.push("ожидалось " + v.count + ", фактически " + wrapped.length);
    if(v.publish === false) specBits.push("черновик");
    if(v.built_at) specBits.push("построено " + esc(tsHuman(v.built_at)));
    if(specBits.length) h.push("<div class='vw-note'>" + specBits.join(" · ") + "</div>");
    return h.join("");
  }
  function metasHTML(w, v){
    var ms = metaList(w.item, v);
    if(!ms.length) return "";
    return "<div class='vw-metas'>" + ms.map(function(m){
      return "<span class='vw-meta'><b>" + esc(m.k) + "</b>" + esc(m.v) + "</span>";
    }).join("") + "</div>";
  }
  function renderCards(v, vis){
    if(!vis.length) return "<div class='vw-empty'>Нет данных.</div>";
    return vis.map(function(w){
      var sel = !!pickOf(V.cur)[w.id];
      return "<div class='vw-card" + (sel ? " sel" : "") + "'><div class='vw-bar' style='margin:0'>" +
        "<input type='checkbox' data-role='pick' data-id='" + esc(w.id) + "'" + (sel ? " checked" : "") + ">" +
        "<div class='vw-main'><div class='vw-title'>" + esc(w.label) + "</div>" +
        "<div class='vw-id'>" + esc(w.id) + "</div></div></div>" + metasHTML(w, v) + "</div>";
    }).join("");
  }
  function renderChecklist(v, vis){
    if(!vis.length) return "<div class='vw-empty'>Нет данных.</div>";
    if(!v.group_by) return vis.map(function(w){
      var sel = !!pickOf(V.cur)[w.id];
      return "<div class='vw-row" + (sel ? " sel" : "") + "'><input type='checkbox' data-role='pick' data-id='" +
        esc(w.id) + "'" + (sel ? " checked" : "") + "><div class='vw-main'><div class='vw-title'>" +
        esc(w.label) + "</div><div class='vw-id'>" + esc(w.id) + "</div>" + metasHTML(w, v) + "</div></div>";
    }).join("");
    return groupWrapped(vis, v.group_by).map(function(g){
      var allSel = !!g.items.length && g.items.every(function(w){ return !!pickOf(V.cur)[w.id]; });
      return "<div class='vw-group'><div class='vw-ghead'><input type='checkbox' data-role='groupPick' data-group='" +
        esc(g.key) + "'" + (allSel ? " checked" : "") + "><span>" + esc(g.key) + "</span><span class='n'>" + g.items.length + "</span></div>" +
        g.items.map(function(w){
          var sel = !!pickOf(V.cur)[w.id];
          return "<div class='vw-row" + (sel ? " sel" : "") + "'><input type='checkbox' data-role='pick' data-id='" +
            esc(w.id) + "'" + (sel ? " checked" : "") + "><div class='vw-main'><div class='vw-title'>" +
            esc(w.label) + "</div><div class='vw-id'>" + esc(w.id) + "</div>" + metasHTML(w, v) + "</div></div>";
        }).join("") + "</div>";
    }).join("");
  }
  function renderTree(v, vis){
    var roots = buildTree(v, vis);
    if(!roots.length) return "<div class='vw-empty'>Нет данных.</div>";
    var collapsed = V.collapsed[V.cur] || {};
    function walk(n, depth){
      var key = n.key, isCollapsed = !!collapsed[key], hasKids = n.children.length > 0;
      var head = "<div class='vw-nhead'>";
      if(hasKids) head += "<button type='button' class='vw-toggle' data-role='nodeToggle' data-key='" + esc(key) + "'>" +
        (isCollapsed ? "▸" : "▾") + "</button>";
      else head += "<button type='button' class='vw-toggle leaf' tabindex='-1'>·</button>";
      if(n.w){
        var sel = !!pickOf(V.cur)[n.id];
        head += "<input type='checkbox' data-role='pick' data-id='" + esc(n.id) + "'" + (sel ? " checked" : "") + ">";
      }
      var hid = (n.w && n.w.item && n.w.item.hypothesis_id) ? n.w.item.hypothesis_id : "";
      var rawLink = (n.w && v && v.id === "atlas-tree")
        ? " <button type='button' class='vw-atlas-link' data-role='raw-cards-link' data-node='" + esc(n.id) + "'" + (hid ? " data-hid='" + esc(hid) + "'" : "") + ">карточки</button>"
        : "";
      head += "<div class='vw-main'><div class='vw-title'>" + esc(n.label || "—") + rawLink + "</div>" +
        (n.w ? "<div class='vw-id'>" + esc(n.id) + "</div>" + metasHTML(n.w, v) : "") + "</div></div>";
      var kids = (!isCollapsed && hasKids) ? "<div class='vw-kids'>" +
        n.children.map(function(c){ return walk(c, depth+1); }).join("") + "</div>" : "";
      return "<div class='vw-node'>" + head + kids + "</div>";
    }
    return roots.map(function(n){ return walk(n,0); }).join("");
  }
  function renderTable(v, vis){
    if(!vis.length) return "<div class='vw-empty'>Нет данных.</div>";
    var cols = columnsOf(v, V.wrapped), pick = pickOf(V.cur);
    var h = ["<div class='vw-tablewrap'><table class='vw-table'><thead><tr><th>✓</th>"];
    cols.forEach(function(c){ h.push("<th>" + esc(c) + "</th>"); });
    h.push("</tr></thead><tbody>");
    vis.forEach(function(w){
      h.push("<tr" + (pick[w.id] ? " class='sel'" : "") + "><td><input type='checkbox' data-role='pick' data-id='" +
        esc(w.id) + "'" + (pick[w.id] ? " checked" : "") + "></td>");
      cols.forEach(function(c){
        var val = getPath(w.item, c);
        if(c === (v && v.label_field)) val = w.label;
        if((c === "atlas" || c === "atlas_nodes") && Array.isArray(val) && val.length){
          var links = val.map(function(aid){
            return "<button type='button' class='vw-atlas-link' data-role='atlas-link' data-atlas='" + esc(String(aid)) + "'>" + esc(String(aid)) + "</button>";
          }).join(" ");
          h.push("<td title='" + esc(val.join(", ")) + "'>" + links + "</td>");
        } else if(c === "ideas" && Array.isArray(val) && val.length){
          var ilinks = val.map(function(iid){
            return "<button type='button' class='vw-voice-link' data-role='idea-link' data-idea='" + esc(String(iid)) + "'>" + esc(String(iid)) + "</button>";
          }).join(" ");
          h.push("<td title='" + esc(val.join(", ")) + "'>" + ilinks + "</td>");
        } else {
          h.push("<td title='" + esc(asText(val)) + "'>" + esc(asText(val)) + "</td>");
        }
      });
      h.push("</tr>");
    });
    h.push("</tbody></table></div>");
    return h.join("");
  }
  /* ---------- decision (да / нет / не знаю) ---------- */
  function ynAnswers(){
    return [
      {answer:"yes", label:"Да", cls:"yes", key:"y"},
      {answer:"no", label:"Нет", cls:"no", key:"n"},
      {answer:"unknown", label:"Не знаю", cls:"unknown", key:"u"}
    ];
  }
  function ynScopeObj(q){
    var s = q && q.scope;
    if(isObj(s)) return s;
    return {kind: s == null ? "unknown" : String(s)};
  }
  function ynScopeText(q){
    var s = q && q.scope, bits = [];
    if(!s) return "scope · —";
    bits.push(asText(s.kind || "—"));
    if(Array.isArray(s.ids) && s.ids.length) bits.push(s.ids.length + " ID");
    if(s.view) bits.push(asText(s.view));
    if(s.source_file) bits.push(asText(s.source_file));
    return "scope · " + bits.join(" · ");
  }
  function ynExpired(q){
    if(!q || !q.expires) return false;
    var ms = (typeof q.expires === "number") ? (q.expires < 1e12 ? q.expires*1000 : q.expires) : Date.parse(q.expires);
    return isFinite(ms) && ms < Date.now();
  }
  function ynDeadline(q){
    if(!q || !q.expires) return "дедлайн: —";
    var txt = (typeof q.expires === "string") ? q.expires.slice(0,16).replace("T"," ") : tsHuman(q.expires);
    return "дедлайн: " + txt + (ynExpired(q) ? " · просрочено" : "");
  }
  function ynIdOf(w, i){
    var q = w && w.item;
    return String(q && q.id != null ? q.id : ((q && q.q) != null ? q.q : w.id || ("#"+(i+1))));
  }
  function renderDecision(v, vis){
    var answered = V.ynAnswered[V.cur] || {};
    var h = [];
    vis.slice(0,5).forEach(function(w, i){
      var q = w.item || {}, id = ynIdOf(w, i);
      var done = answered[id] || (q.status === "answered" ? "принято" : "");
      var overdue = ynExpired(q) && !done;
      var pri = (q.priority != null && String(q.priority)) ? String(q.priority).toUpperCase() : "";
      h.push("<div class='vw-yn-card" + (overdue ? " overdue" : "") + (done ? " answered" : "") + "'>");
      h.push("<div class='vw-yn-top'>");
      if(pri) h.push("<span class='vw-yn-badge pri'>" + esc(pri) + "</span>");
      if(overdue) h.push("<span class='vw-yn-badge overdue'>просрочено</span>");
      if(done) h.push("<span class='vw-yn-badge done'>ответ отправлен · " + esc(done) + "</span>");
      h.push("</div>");
      h.push("<div class='vw-yn-text'>" + esc(asText(q.text != null ? q.text : (q.title != null ? q.title : w.label))) + "</div>");
      h.push("<div class='vw-yn-scope'>" + esc(ynScopeText(q)) + "</div>");
      h.push("<div class='vw-yn-dl'>" + esc(ynDeadline(q)) + "</div>");
      h.push("<div class='vw-yn-btns'>");
      ynAnswers().forEach(function(a){
        var label = a.answer === "yes" ? (q.text_yes ? asText(q.text_yes) : a.label)
          : a.answer === "no" ? (q.text_no ? asText(q.text_no) : a.label) : a.label;
        h.push("<button type='button' class='vw-yn-btn " + a.cls + "' data-role='yn' data-id='" + esc(id) +
          "' data-answer='" + a.answer + "'" + (done ? " disabled" : "") + ">" + esc(label) + "</button>");
      });
      h.push("</div>");
      h.push("<div class='vw-yn-hint'>горячие клавиши: y — да · n — нет · u — не знаю</div>");
      h.push("</div>");
    });
    return h.join("");
  }
  function renderContent(){
    var box = $("#vwContent"), v = currentView(); if(!box || !v) return;
    var d = V.data[V.cur] || {items:[]};
    /* pdf-hub: снимаем старый контроллер до любой перерисовки, иначе повторный
       клик/фильтр оставлял бы слушатели beforeprint и дубли контейнера.
       Храним ссылку на #vwBody (он не пересоздаётся), а не на #vwContent —
       тот renderBody() заменяет через innerHTML при каждом открытии вида. */
    var hubHost = $("#vwBody");
    if(hubHost && hubHost.__pdfHub){ try{ hubHost.__pdfHub.destroy(); }catch(e){} hubHost.__pdfHub = null; }
    if(String(v.type || "") === "decision"){
      if(d.error){
        box.innerHTML = "<div class='vw-empty'>Вопросов нет: источник <b>" + esc(d.url || (v.source || "—")) +
          "</b> недоступен (" + esc(d.error) + ").</div>"; updateCount(); return;
      }
      var qitems = (d.items || []).filter(function(x){ return isObj(x) && (x.text != null || x.id != null); });
      if(!qitems.length){
        box.innerHTML = "<div class='vw-empty'>Вопросов нет: источник <b>" + esc(d.url || (v.source || "inline")) +
          "</b> вернул пустой список вопросов.</div>"; updateCount(); return;
      }
      if(!V.visible.length){
        box.innerHTML = "<div class='vw-empty'>Вопросов нет по текущему поиску/фильтрам (всего " +
          qitems.length + "). Сбросьте фильтры или поиск.</div>"; updateCount(); return;
      }
      box.innerHTML = renderDecision(v, V.visible); updateCount(); return;
    }
    if(d.error){
      box.innerHTML = "<div class='vw-empty'>Нет данных для вида <b>" + esc(V.cur) + "</b>: источник <b>" +
        esc(d.url || (v.source || "—")) + "</b> недоступен (" + esc(d.error) + "). Данные не выдумываются.</div>";
      updateCount(); return;
    }
    if(!d.items || !d.items.length){
      box.innerHTML = "<div class='vw-empty'>Нет данных: источник <b>" + esc(d.url || "inline") +
        "</b> вернул пустой список.</div>";
      updateCount(); return;
    }
    var vis = V.visible;
    if(!vis.length){
      box.innerHTML = "<div class='vw-empty'>Нет данных по текущему поиску/фильтрам (всего " +
        V.wrapped.length + "). Сбросьте фильтры или поиск.</div>";
      updateCount(); return;
    }
    var type = String(v.type || "cards");
    box.innerHTML = type === "decision" ? renderDecision(v, vis) :
      type === "checklist" ? renderChecklist(v, vis) :
      type === "tree" ? renderTree(v, vis) :
      type === "table" ? renderTable(v, vis) : renderCards(v, vis);
    updateCount();
    /* pdf-hub: после обычного рендера карточек подключаем window.PDFHub.render.
       Контейнер один, пересоздаётся чисто: старый контроллер уже.destroy() выше. */
    if(viewId(v) === "pdf-hub" || (type === "cards" && String(v.source || "") === "works.json")){
      var mount = $("#pdfHubMount", box);
      if(!mount){ mount = document.createElement("div"); mount.id = "pdfHubMount"; box.appendChild(mount); }
      mount.innerHTML = "";
      var Hub = window.PDFHub;
      if(Hub && typeof Hub.render === "function"){
        try {
          (hubHost || box).__pdfHub = Hub.render(mount, d.items || [], {
            title: v.title || "Хаб университетских работ",
            groupBy: v.group_by || "source",
            selectable: true,
            showExport: true,
            onSelectionChange: function(ids){
              var pick = pickOf(V.cur);
              Object.keys(pick).forEach(function(k){ delete pick[k]; });
              (ids || []).forEach(function(id){ pick[String(id)] = true; });
              updateCount();
            }
          });
        } catch(err) {
          mount.innerHTML = "";
          var fail = document.createElement("div");
          fail.className = "vw-empty";
          fail.textContent = "PDF-хаб недоступен: " + ((err && err.message) || String(err));
          mount.appendChild(fail);
        }
      } else {
        var off = document.createElement("div");
        off.className = "vw-empty";
        off.textContent = "PDF-хаб недоступен";
        mount.appendChild(off);
      }
    }
  }
  function updateCount(){
    var el = $("#vwCount"); if(!el) return;
    var pick = pickOf(V.cur), n = 0;
    Object.keys(pick).forEach(function(k){ if(pick[k]) n++; });
    el.textContent = "Выбрано: " + n + " / " + V.wrapped.length;
  }
  function renderBody(){
    var body = $("#vwBody"), v = currentView(); if(!body || !v) return;
    setHostSub();
    var d = V.data[V.cur] || {items:[]};
    V.wrapped = wrapItems(v, d.items || []);
    V.visible = visibleItems(v, V.wrapped, V.cur);
    body.innerHTML = controlsHTML(v, V.wrapped) + "<div class='vw-content' id='vwContent'></div>";
    renderContent();
    stopOpen();
  }

  /* ---------- события ---------- */
  function setVisibleSelection(on){
    var pick = pickOf(V.cur);
    V.visible.forEach(function(w){ pick[w.id] = on; });
    renderContent();
  }
  function getTG(){
    try {
      if(window.Telegram && window.Telegram.WebApp && typeof window.Telegram.WebApp.sendData === "function")
        return window.Telegram.WebApp;
    } catch(e){}
    try {
      if(typeof tg !== "undefined" && tg && typeof tg.sendData === "function") return tg;
    } catch(e){}
    return null;
  }
  function ynFindQuestion(id){
    for(var i=0;i<V.visible.length;i++){
      var w = V.visible[i];
      if(isObj(w.item) && ynIdOf(w, i) === String(id)) return w.item;
    }
    return null;
  }
  function sendYesNo(id, answer){
    if(!id || !answer) return;
    var answered = V.ynAnswered[V.cur] || (V.ynAnswered[V.cur] = {});
    if(answered[id]){ vtoast("На этот вопрос уже отвечено"); return; }
    var q = ynFindQuestion(id);
    if(q && q.status === "answered"){
      answered[id] = "принято"; vtoast("На этот вопрос уже отвечено"); renderContent(); return;
    }
    var payload = {
      source: "miniapp_yesno",
      question_id: id,
      answer: answer,
      scope: ynScopeObj(q),
      ts: new Date().toISOString()
    };
    var tgApp = getTG();
    if(!tgApp){ vtoast("Открой мини-ап через бота: sendData недоступен"); return; }
    try {
      if (typeof dshSend === "function") dshSend(payload, "Отправлено в DeepSeek Harness");
      else tgApp.sendData(JSON.stringify(payload));
      var a = ynAnswers(), label = a[0].label;
      for(var i=0;i<a.length;i++) if(a[i].answer === answer) label = a[i].label;
      answered[id] = label;
      vtoast("Ответ «" + label + "» отправлен · " + id);
      renderContent(); renderSelector();
    } catch(e){
      vtoast("Ошибка отправки: " + ((e && e.message) || String(e)));
    }
    /* tg.close намеренно НЕ вызывается; miniapp_selection не трогаем */
  }
  function sendAction(label){
    var v = currentView(); if(!v) return;
    var pick = pickOf(V.cur);
    var ids = Object.keys(pick).filter(function(k){ return pick[k]; });
    var decEl = $('[data-role="decision"]'), comEl = $('[data-role="comment"]');
    var decision = ((decEl && decEl.value) || V.decision[V.cur] || "").trim() || String(label || "");
    var comment = ((comEl && comEl.value) || V.comment[V.cur] || "").trim();
    var payload = {
      source: "miniapp_selection",
      view: V.cur,
      ids: ids,
      decision: decision,
      comment: comment,
      ts: new Date().toISOString()
    };
    var tgApp = getTG();
    if(!tgApp){ vtoast("Открой мини-ап через бота: sendData недоступен"); return; }
    try {
      if (typeof dshSend === "function") dshSend(payload, "Отправлено в DeepSeek Harness");
      else tgApp.sendData(JSON.stringify(payload));
      vtoast("Отправлено · " + ids.length + " из " + V.cur + " · " + label);
    } catch(e){
      vtoast("Ошибка отправки: " + ((e && e.message) || String(e)));
    }
    /* tg.close намеренно НЕ вызывается */
  }
  function onClick(e){
    var t = e.target, role = t && t.getAttribute && t.getAttribute("data-role");
    if(!role) return;
    var v = currentView();
    if(role === "close"){ close(); return; }
    if(role === "view"){ selectView(t.getAttribute("data-id")); return; }
    if(role === "selectAll"){ setVisibleSelection(true); return; }
    if(role === "clearAll"){ setVisibleSelection(false); return; }
    if(role === "refresh"){
      if(v){ loadData(v, true); loadSpec(); }
      return;
    }
    if(role === "dir"){
      V.desc[V.cur] = !V.desc[V.cur];
      t.classList.toggle("on", !!V.desc[V.cur]);
      t.textContent = V.desc[V.cur] ? "↓ убыв" : "↑ возр";
      V.visible = visibleItems(v, V.wrapped, V.cur); renderContent();
      return;
    }
    if(role === "chip"){
      var field = t.getAttribute("data-field"), val = t.getAttribute("data-value") || "";
      if(!V.filters[field]) V.filters[field] = {};
      if(!val) V.filters[field] = {};
      else V.filters[field][val] = !V.filters[field][val];
      var group = t.parentNode;
      $$(".vw-chip", group).forEach(function(b){
        var fv = b.getAttribute("data-value") || "";
        var active = fv ? !!(V.filters[field] && V.filters[field][fv]) :
          !Object.keys(V.filters[field] || {}).some(function(k){ return V.filters[field][k]; });
        b.classList.toggle("on", active);
      });
      V.visible = visibleItems(v, V.wrapped, V.cur); renderContent();
      return;
    }
    if(role === "nodeToggle"){
      var key = t.getAttribute("data-key");
      if(!V.collapsed[V.cur]) V.collapsed[V.cur] = {};
      V.collapsed[V.cur][key] = !V.collapsed[V.cur][key];
      renderContent();
      return;
    }
    if(role === "atlas-link"){
      var aid = t.getAttribute("data-atlas") || "";
      if(aid && typeof window.__openAtlasNode === "function") window.__openAtlasNode(aid);
      return;
    }
    if(role === "idea-link"){
      var iid = t.getAttribute("data-idea") || "";
      if(iid){
        selectView("voice-ideas");
        setSearch(iid);
        if(typeof window.setTab === "function") window.setTab("prompts");
      }
      return;
    }
    if(role === "voice-link"){
      var voice = t.getAttribute("data-voice") || "";
      if(voice){
        selectView("cs2-ideas");
        setSearch(voice);
        if(typeof window.setTab === "function") window.setTab("prompts");
      }
      return;
    }
    if(role === "idea-link"){
      var iid = t.getAttribute("data-idea") || "";
      if(iid){
        selectView("voice-ideas");
        setSearch(iid);
      }
      return;
    }
    if(role === "raw-cards-link"){
      var nid = t.getAttribute("data-node") || "";
      var hid = t.getAttribute("data-hid") || "";
      var q = hid || nid.replace(/^voicehyp:/, "");
      if(q){
        selectView("atlas-raw-cards");
        setSearch(q);
      }
      return;
    }
    if(role === "yn"){
      if(t.disabled) return;
      sendYesNo(t.getAttribute("data-id"), t.getAttribute("data-answer"));
      return;
    }
    if(role === "action"){ sendAction(t.getAttribute("data-label")); return; }
  }
  function onChange(e){
    var t = e.target, role = t && t.getAttribute && t.getAttribute("data-role");
    if(role === "pick"){
      var pick = pickOf(V.cur);
      pick[t.getAttribute("data-id")] = !!t.checked;
      var row = t.closest(".vw-card,.vw-row");
      if(row) row.classList.toggle("sel", !!t.checked);
      updateCount();
      return;
    }
    if(role === "groupPick"){
      var key = t.getAttribute("data-group"), g = null;
      for(var i=0;i<V.visible.length;i++){
        if((asText(getPath(V.visible[i].item, currentView().group_by)) || "—") === key){ g = 1; break; }
      }
      if(g){
        var on = !!t.checked;
        V.visible.forEach(function(w){
          if((asText(getPath(w.item, currentView().group_by)) || "—") === key) pickOf(V.cur)[w.id] = on;
        });
        renderContent();
      }
      return;
    }
    if(role === "sort"){
      V.sort[V.cur] = t.value || "";
      V.visible = visibleItems(currentView(), V.wrapped, V.cur);
      renderContent();
    }
  }
  function onInput(e){
    var t = e.target, role = t && t.getAttribute && t.getAttribute("data-role");
    if(role === "search"){
      V.search = t.value || "";
      V.visible = visibleItems(currentView(), V.wrapped, V.cur);
      renderContent();
    } else if(role === "decision") V.decision[V.cur] = t.value || "";
    else if(role === "comment") V.comment[V.cur] = t.value || "";
  }

  /* ---------- старт ---------- */
  ensureShell();
  loadSpec();
  window.addEventListener("miniapp-views-reload", function(){
    V.data = {}; V.ynAnswered = {}; loadSpec(); if(V.cur) loadData(currentView(), true);
  });

  /* @owner:casino-vibes @region:vibes-loader — независимая подгрузка вайбов казино.
     Дубль страховки на случай, если сгенерированный casino-activity.js перегенерируется.
     Идентификатор тега один и тот же — второй раз модуль не подгрузится. */
  try {
    if (!document.getElementById('csn-vibes-loader')) {
      var s = document.createElement('script');
      s.id = 'csn-vibes-loader';
      s.src = 'casino-vibes.js?v=20261122-vibes1';
      (document.head || document.documentElement).appendChild(s);
    }
  } catch (e) { /* без вайбов приложение работает */ }
})();
