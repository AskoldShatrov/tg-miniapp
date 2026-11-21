/* voice-nav.js — применение голосовой навигации в мини-апе.
   Загружается ПОСЛЕ index.html и views.js (anchor: pdf-hub.js).

   Публичный контракт (совместим с bots/voice_intent.py::as_nav):
     window.applyVoiceNav(nav)                       -> boolean
     window.dispatchEvent(new CustomEvent("miniapp:nav", {detail: nav}))
     window.VoiceNav = {version, apply, isOwner, currentUserId}

   nav = {v, intent, target:{tab,view,url,filters}, confidence,
          needs_confirm | need_confirm, options:[...], risk, explain, owner_only}

   Правила:
   - навигация ТОЛЬКО через существующий setTab(tab) — не sendData, не tg.close;
   - 9-й вкладки не создаём: tab проверяется против DOM .tab[data-tab] / 8 Known;
   - target.view -> открываем панель Виды (#vwLaunch) и жмём чип data-id;
   - need_confirm -> in-app диалог «Выполнить? Да/Отмена», мини-ап не закрывается;
   - unknown -> in-app чипы вариантов, nothing угадывается;
   - гость + confidential -> отказ без навигации;
   - если setTab недоступен — честный toast, молча не делаем вид, что сработало;
   - /voice/upload -> {ok:true,nav} подхватывается на уровне fetch-обёртки:
     существует минимальный путь без правки voiceFinish (в index.html одна вставка).
*/
(function(){
  "use strict";

  var VERSION = "20261121-0645";
  var OWNER_DEFAULT = "1869196044";
  var FALLBACK_TABS = ["chat","prompts","tree","sessions","atlas","live","questions","studio"];
  var UNKNOWN_OPTIONS = ["show_cards","open_prompts","show_work","help"];

  /* Намерения -> существующие вкладки. Не добавляем новых вкладок. */
  var INTENT_TAB = {
    "show_cards":"studio", "show_edges":"studio", "open_pdf_hub":"studio",
    "open_confidential":"studio", "studio":"studio",
    "search_prompts_3d":"prompts", "open_prompts":"prompts", "prompts":"prompts",
    "show_questions":"questions", "questions":"questions",
    "show_agents":"sessions", "sessions":"sessions",
    "stop_agent":"live", "open_pr":"live", "show_work":"live", "live":"live",
    "help":"chat", "chat":"chat", "tree":"tree", "atlas":"atlas"
  };

  function currentUserId(){
    try{
      var wa = window.Telegram && window.Telegram.WebApp;
      var u = wa && wa.initDataUnsafe && wa.initDataUnsafe.user;
      if(u && u.id != null) return String(u.id);
    }catch(e){}
    try{ if(typeof userID !== "undefined" && userID) return String(userID); }catch(e){}
    return "0";
  }

  function ownerIds(){
    var out = {};
    out[OWNER_DEFAULT] = true;
    try{ if(typeof OWNER_ID !== "undefined" && OWNER_ID) out[String(OWNER_ID)] = true; }catch(e){}
    var extra = window.VOICE_NAV_OWNER_IDS;
    if(Array.isArray(extra)) extra.forEach(function(x){ out[String(x)] = true; });
    else if(typeof extra === "string") extra.split(",").forEach(function(x){
      x = x.trim(); if(x) out[x] = true;
    });
    return out;
  }
  function isOwner(){ return !!ownerIds()[currentUserId()]; }

  function validTabs(){
    var found = [];
    try{
      var nodes = document.querySelectorAll(".tab[data-tab]");
      for(var i=0;i<nodes.length;i++){
        var t = nodes[i] && nodes[i].getAttribute && nodes[i].getAttribute("data-tab");
        if(t) found.push(String(t));
      }
    }catch(e){}
    return found.length ? found : FALLBACK_TABS;
  }

  function normalize(nav){
    if(!nav || typeof nav !== "object") return null;
    var target = (nav.target && typeof nav.target === "object") ? nav.target : {};
    var intent = String(nav.intent || "");
    var url = String(target.url || "");
    return {
      intent: intent,
      target: target,
      risk: String(nav.risk || "low"),
      explain: String(nav.explain || ""),
      needs_confirm: !!(nav.needs_confirm || nav.need_confirm),
      options: Array.isArray(nav.options) ? nav.options.slice(0, 6) : [],
      owner_only: !!(nav.owner_only || intent === "open_confidential" || /\/private\//.test(url))
    };
  }

  function tabOf(nav){
    if(!nav) return null;
    var valid = validTabs();
    var want = nav.target.tab || INTENT_TAB[nav.intent] ||
      (valid.indexOf(nav.intent) >= 0 ? nav.intent : null);
    if(want && valid.indexOf(String(want)) >= 0) return String(want);
    return null;
  }

  function toastMsg(msg){
    var text = "Голосовая навигация: " + String(msg);
    try{ if(typeof window.toast === "function"){ window.toast(text); return; } }catch(e){}
    try{ if(typeof toast === "function"){ toast(text); return; } }catch(e){}
    try{ if(window.console && console.warn) console.warn(text); }catch(e){}
  }

  function clickLike(el){
    if(!el) return false;
    try{
      if(typeof el.click === "function"){ el.click(); return true; }
      if(typeof el.dispatchEvent === "function"){
        el.dispatchEvent({type:"click", target:el, bubbles:true}); return true;
      }
    }catch(e){}
    return false;
  }

  function viewChips(){
    var out = [];
    try{
      var nodes = document.querySelectorAll(
        '#vwSelect [data-role="view"], [data-role="view"][data-id], .vw-vchip[data-id]');
      for(var i=0;i<nodes.length;i++) out.push(nodes[i]);
    }catch(e){}
    return out;
  }

  /* Открыть панель Виды и выбрать вид по data-id (views.js держит selectView в IIFE,
     поэтому идём через его собственные DOM-хуки: #vwLaunch и [data-role=view]). */
  function openViews(view){
    if(!view) return false;
    var launch = document.getElementById && document.getElementById("vwLaunch");
    if(!launch){ toastMsg("панель «Виды» (#vwLaunch) ещё не загружена"); return false; }
    clickLike(launch);
    var want = String(view), tries = 0;
    function pick(){
      var chips = viewChips();
      for(var i=0;i<chips.length;i++){
        var c = chips[i];
        var id = c && c.getAttribute && c.getAttribute("data-id");
        var txt = c && c.textContent ? String(c.textContent) : "";
        if(id === want || (want && txt.indexOf(want) >= 0)){ clickLike(c); return true; }
      }
      return false;
    }
    if(pick()) return true;
    /* views.json грузится асинхронно — ждём появления чипа до ~2 с. */
    try{
      var iv = setInterval(function(){ if(pick() || ++tries >= 20) clearInterval(iv); }, 100);
    }catch(e){}
    return true;
  }

  function removeNode(id){
    try{
      var el = document.getElementById && document.getElementById(id);
      if(el && el.parentNode) el.parentNode.removeChild(el);
    }catch(e){}
  }

  function host(){
    return (document.body || document.documentElement || document.head);
  }

  function showConfirm(nav, onYes){
    removeNode("vnConfirm");
    var box = document.createElement("div");
    box.id = "vnConfirm"; box.className = "vn-dialog";
    box.setAttribute("role","dialog");
    var title = document.createElement("div");
    title.className = "vn-dlg-title"; title.textContent = "Выполнить?";
    var body = document.createElement("div");
    body.className = "vn-dlg-body"; body.textContent = nav.explain || nav.intent || "";
    var yes = document.createElement("button");
    yes.type = "button"; yes.className = "vn-dlg-yes"; yes.textContent = "Да";
    var no = document.createElement("button");
    no.type = "button"; no.className = "vn-dlg-no"; no.textContent = "Отмена";
    yes.addEventListener("click", function(){ removeNode("vnConfirm"); onYes(); });
    no.addEventListener("click", function(){ removeNode("vnConfirm"); toastMsg("отменено — мини-ап остался открытым"); });
    box.appendChild(title); box.appendChild(body); box.appendChild(yes); box.appendChild(no);
    host().appendChild(box);
    return box;
  }

  function showChips(nav, options){
    removeNode("vnChips");
    var opts = (options && options.length) ? options : UNKNOWN_OPTIONS;
    var box = document.createElement("div");
    box.id = "vnChips"; box.className = "vn-chips";
    var hint = document.createElement("div");
    hint.className = "vn-chips-hint";
    hint.textContent = nav.explain || "Не понял фразу — выбери вариант:";
    box.appendChild(hint);
    opts.forEach(function(o){
      var b = document.createElement("button");
      b.type = "button"; b.className = "vn-chip";
      b.setAttribute("data-intent", String(o)); b.textContent = String(o);
      b.addEventListener("click", function(){
        removeNode("vnChips");
        applyVoiceNav({intent:String(o), target:{}, needs_confirm:false});
      });
      box.appendChild(b);
    });
    host().appendChild(box);
    return box;
  }

  function perform(nav){
    var setTab = window.setTab;
    if(typeof setTab !== "function"){
      toastMsg("недоступно: setTab не найден — вкладки не переключаются");
      return false;
    }
    var tab = tabOf(nav);
    if(!tab){
      toastMsg("нет подходящей вкладки для «" + nav.intent + "»");
      showChips(nav, nav.options);
      return false;
    }
    try{ setTab(tab); }
    catch(e){
      toastMsg("ошибка setTab: " + ((e && e.message) || String(e)));
      return false;
    }
    if(nav.target.view) openViews(nav.target.view);
    toastMsg(nav.explain || ("открыта вкладка " + tab));
    return true;
  }

  function applyVoiceNav(nav){
    var n = normalize(nav);
    if(!n){ toastMsg("пустой payload"); return false; }

    if(n.owner_only && !isOwner()){
      toastMsg("отказ: «" + n.intent + "» доступно только владельцу — навигация не применена");
      return false;
    }
    if(n.intent === "unknown" || !tabOf(n)){
      if(n.intent !== "unknown") toastMsg("неизвестный адрес: " + n.intent);
      showChips(n, n.options);
      return false;
    }
    if(n.needs_confirm){
      showConfirm(n, function(){ perform(n); });
      return true; /* диалог показан, применение отложено до «Да» */
    }
    return perform(n);
  }

  /* Минимальный рабочий путь для голоса: voiceFinish в index.html уже шлёт
     POST /voice/upload и не читает тело ответа. Перехватываем ответ на уровне
     fetch, клонируем его и применяем nav — без правки самого voiceFinish. */
  function readNavFromResponse(input, init, resp){
    try{
      var url = (typeof input === "string") ? input : ((input && input.url) || "");
      if(!init || String(init.method || "").toUpperCase() !== "POST") return;
      if(url.indexOf("/voice/upload") < 0) return;
      if(!resp || !resp.ok || typeof resp.clone !== "function") return;
      resp.clone().json().then(function(data){
        if(data && data.ok === true && data.nav) applyVoiceNav(data.nav);
      }).catch(function(){});
    }catch(e){}
  }

  function hookFetch(){
    if(window.__voiceNavFetchHooked) return;
    var orig = window.fetch;
    if(typeof orig !== "function") return;
    window.fetch = function(input, init){
      var p;
      try{ p = orig.apply(this, arguments); }catch(e){ throw e; }
      if(!p || typeof p.then !== "function") return p;
      return p.then(function(resp){ readNavFromResponse(input, init, resp); return resp; });
    };
    window.__voiceNavFetchHooked = true;
  }

  /* Публичный API и события. */
  window.VoiceNav = {
    version: VERSION,
    apply: applyVoiceNav,
    isOwner: isOwner,
    currentUserId: currentUserId
  };
  window.applyVoiceNav = applyVoiceNav;

  function onNavEvent(e){
    if(!e || e.__voiceNavHandled) return;
    e.__voiceNavHandled = true;
    applyVoiceNav(e.detail);
  }
  window.addEventListener("miniapp:nav", onNavEvent);
  if(document.addEventListener) document.addEventListener("miniapp:nav", onNavEvent);

  hookFetch();
})();
