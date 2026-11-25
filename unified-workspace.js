/* unified-workspace.js — G2/G3 (I039+I007+I011): «Один экран, три зоны».
   Идея: верх — контекст отобранных карточек, центр — компактный диалог/треки,
   низ — единый инпут с quick-кнопками. Встроенный слой ВНУТРИ существующего
   #screen-studio: вкладки не удаляются, Студия и Чат не ломаются.

   Канал отправки — DeepSeek Harness через process_api:
     POST <process_api_url>/dsh/task {text, user_id, rid}
   Старый путь tg.sendData остаётся только явным фолбэком при недоступном API,
   чтобы задача не терялась молча. sendData для навигации НЕ используется;
   pairChat и генерацию rid бота НЕ трогаем.

   Треки «отправлено → думает → готово» обновляются через существующий polling
   replies.json: accessor на CHAT.replies ловит присваивание из refreshReplies()
   без нового setInterval. Фолбэк — один таймер с очисткой.

   Feature-флаг: window.MINIAPP_UNIFIED=0 выключает слой без правки кода. */
(function(){
  "use strict";
  if (typeof window === "undefined") return;

  if (window.MINIAPP_UNIFIED === undefined) window.MINIAPP_UNIFIED = 1;
  var enabled = !(window.MINIAPP_UNIFIED === 0 || window.MINIAPP_UNIFIED === "0" ||
                  window.MINIAPP_UNIFIED === false);

  if (!enabled){
    window.__UNIFIED_WS__ = { enabled:false, init:function(){ return false; } };
    return;
  }

  var tracks = [];            // {rid,text,q,ts,state,rep} state: sent|thinking|done
  var fallbackTimer = null;
  var MAX_TRACKS = 12;

  var QUICK = [
    { label:"👥 Кто в работе", text:"Кто сейчас в работе?" },
    { label:"📂 Что открыто", text:"Что сейчас открыто?" },
    { label:"✅ Решения",     text:"Какие решения приняты?" },
    { label:"⏳ Подожди",     text:"Подожди, уточняю детали" },
    { label:"🎤 Голос",       voice:true }
  ];

  var CSS = [
    "#uw-panel{margin:0 0 14px;border:1px solid var(--surface1);border-radius:var(--radius);overflow:hidden;",
      "background:linear-gradient(180deg,rgba(49,50,68,.38),rgba(17,17,27,.18))}",
    "#uw-head{display:flex;align-items:center;gap:8px;padding:10px 11px;cursor:pointer;user-select:none;",
      "background:rgba(203,166,247,.07);border-bottom:1px solid var(--surface1)}",
    "#uw-head b{font:700 11px/1 var(--ff);color:var(--lavender);letter-spacing:.4px}",
    "#uw-head .uw-badge{font:700 9px/1 var(--fm);color:var(--green);border:1px solid rgba(166,227,161,.4);",
      "border-radius:999px;padding:4px 7px;background:rgba(166,227,161,.08)}",
    "#uw-head .uw-tog{margin-left:auto;font:700 10px/1 var(--fm);color:var(--overlay1)}",
    "#uw-body{display:flex;flex-direction:column}",
    "#uw-panel.closed #uw-body{display:none}",
    ".uw-zone{padding:9px 11px;border-bottom:1px solid var(--surface0)}",
    ".uw-zone:last-child{border-bottom:0}",
    ".uw-lab{font:700 9px/1 var(--fm);letter-spacing:.7px;text-transform:uppercase;color:var(--overlay1);",
      "margin-bottom:6px;display:flex;align-items:center;gap:6px}",
    ".uw-lab i{width:6px;height:6px;border-radius:50%;background:var(--lavender)}",
    "#uw-context{font:500 11px/1.45 var(--ff);color:var(--subtext1);word-break:break-word;",
      "max-height:76px;overflow-y:auto}",
    "#uw-context.none{color:var(--overlay1);font-style:italic}",
    "#uw-dialog{max-height:210px;overflow-y:auto;display:flex;flex-direction:column;gap:6px}",
    ".uw-empty{font:500 11px/1.45 var(--ff);color:var(--overlay1);padding:4px 0}",
    ".uw-track{padding:7px 9px;border:1px solid var(--surface1);border-left:2px solid var(--yellow);",
      "border-radius:9px;background:var(--mantle)}",
    ".uw-track.done{border-left-color:var(--green)}",
    ".uw-track .uw-q{font:600 11px/1.4 var(--ff);color:var(--text);word-break:break-word}",
    ".uw-track .uw-steps{display:flex;align-items:center;gap:5px;margin-top:6px;font:700 9px/1 var(--fm)}",
    ".uw-track .uw-step{color:var(--overlay0)}",
    ".uw-track .uw-step.on{color:var(--yellow)}",
    ".uw-track.done .uw-step.on{color:var(--green)}",
    ".uw-track .uw-arrow{color:var(--surface2)}",
    ".uw-track .uw-ans{margin-top:6px;padding-top:6px;border-top:1px solid var(--surface1);",
      "font:500 11px/1.4 var(--ff);color:var(--subtext1);word-break:break-word}",
    ".uw-track .uw-in{margin-top:6px;font:600 10px/1.4 var(--ff);color:var(--overlay1)}",
    "#uw-inputrow{display:flex;gap:6px;align-items:center}",
    "#uw-input{flex:1;min-width:0;background:var(--surface0);color:var(--text);border:1px solid var(--surface1);",
      "border-radius:10px;padding:10px;font:500 12px/1.35 var(--ff);min-height:44px}",
    "#uw-input:focus{outline:none;border-color:var(--blue)}",
    "#uw-send{min-height:44px;min-width:52px;padding:0 12px;border:0;border-radius:10px;",
      "background:var(--blue);color:var(--crust);font:700 13px/1 var(--ff);cursor:pointer}",
    "#uw-quick{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}",
    "#uw-quick button{min-height:44px;padding:0 12px;border:1px solid var(--surface1);border-radius:9px;",
      "background:rgba(17,17,27,.32);color:var(--subtext1);font:700 10.5px/1 var(--fm);cursor:pointer}",
    "#uw-quick button:hover{border-color:var(--blue);color:var(--text)}"
  ].join("");

  function esc(x){
    return String(x==null?"":x).replace(/[&<>"']/g,function(c){
      return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c];
    });
  }
  function uid(){ return (typeof userID!=="undefined" && userID) ? userID : "0"; }
  function replies(){
    if (typeof CHAT==="undefined" || !CHAT || !CHAT.replies) return [];
    return CHAT.replies[uid()] || [];
  }
  function ctx(){
    if (typeof studioContext==="function"){
      try{ return studioContext() || {ids:[],text:""}; }catch(e){ return {ids:[],text:""}; }
    }
    return {ids:[],text:""};
  }

  /* --- зона 1: контекст отобранных карточек --- */
  function renderContext(){
    var el=document.getElementById("uw-context"); if(!el) return;
    var c=ctx(), txt=c.text||"";
    el.textContent=txt||"Контекст не выбран — раскрой карточки в Студии";
    if (el.className!==undefined) el.className="uw-ctx"+(txt?"":" none");
    if (el.setAttribute) el.setAttribute("data-count", String((c.ids||[]).length));
  }

  /* --- зона 2: компактный диалог + треки состояний --- */
  /* Переходы состояний происходят ТОЛЬКО на опросе replies.json:
     только что отправленный трек сразу виден как «отправлено». */
  function updateStates(){
    var reps=replies(), byRid={};
    reps.forEach(function(r){ var k=String((r&&r.rid)||""); if(k) byRid[k]=r; });
    tracks.forEach(function(t){
      var r=byRid[t.rid];
      if(r){ t.state="done"; t.rep=r; }
      else if(t.state==="sent"){ t.state="thinking"; }
    });
  }
  function renderTracks(){
    var el=document.getElementById("uw-dialog"); if(!el) return;
    var reps=replies();
    var known={}; tracks.forEach(function(t){ known[t.rid]=1; });
    var stray=reps.filter(function(r){ return r && r.rid && !known[String(r.rid)]; }).slice(-3);

    if(!tracks.length && !stray.length){
      el.innerHTML='<div class="uw-empty">Запросов нет — напиши в поле ниже или нажми quick.</div>';
      return;
    }
    var html=tracks.slice(-6).map(function(t){
      var s1="on", s2=(t.state!=="sent"?"on":""), s3=(t.state==="done"?"on":"");
      var ans=t.rep ? '<div class="uw-ans">'+esc(t.rep.text)+"</div>" : "";
      return '<div class="uw-track'+(t.state==="done"?" done":"")+'" data-rid="'+esc(t.rid)+'" data-state="'+t.state+'">'+
        '<div class="uw-q">'+esc(t.text)+"</div>"+
        '<div class="uw-steps">'+
          '<span class="uw-step '+s1+'">отправлено ✓</span><span class="uw-arrow">→</span>'+
          '<span class="uw-step '+s2+'">думает ⋯</span><span class="uw-arrow">→</span>'+
          '<span class="uw-step '+s3+'">готово ✓</span>'+
        "</div>"+ans+"</div>";
    }).join("");
    if(stray.length){
      html+=stray.map(function(r){
        return '<div class="uw-track" data-state="stray"><div class="uw-in">◈ входящее: '+esc(r.text)+"</div></div>";
      }).join("");
    }
    el.innerHTML=html;
  }

  function render(){ renderContext(); renderTracks(); }

  function onDataRefresh(){ try{ updateStates(); render(); }catch(e){} }

  /* --- подключение к существующему polling без нового setInterval --- */
  function hookPolling(){
    if (typeof CHAT==="undefined" || !CHAT) return false;
    var d;
    try{ d=Object.getOwnPropertyDescriptor(CHAT,"replies"); }catch(e){ return false; }
    if (d && typeof d.set==="function") return true;      // уже подключены
    var val=CHAT.replies;
    try{
      Object.defineProperty(CHAT,"replies",{
        configurable:true, enumerable:true,
        get:function(){ return val; },
        set:function(v){ val=v; onDataRefresh(); }
      });
      return true;
    }catch(e){ return false; }
  }
  function ensurePolling(){
    if (hookPolling()) return;                             // основной путь: refreshReplies → CHAT.replies=...
    if (fallbackTimer) return;                             // фолбэк ровно один таймер
    fallbackTimer=setInterval(function(){ onDataRefresh(); },5000);
  }
  function destroy(){
    if(fallbackTimer){ clearInterval(fallbackTimer); fallbackTimer=null; }
  }

  /* --- зона 3: единый инпут + quick; отправка тем же каналом miniapp_chat --- */
  function send(){
    var input=document.getElementById("uw-input");
    var q=((input && input.value)||"").trim();
    if(!q) return false;
    var prefix=ctx().text||"";
    var text=(prefix?prefix+" ":"")+q;
    var rid=Date.now().toString(36)+Math.random().toString(36).slice(2,6);

    /* Additive: та же запись, что делает sendChat — Чат и Студия продолжают работать. */
    if (typeof CHAT!=="undefined" && CHAT && Array.isArray(CHAT.sent)){
      CHAT.sent.push({text:text,t:new Date().toTimeString().slice(0,8),ts:Date.now(),
        rid:rid,source:"miniapp_chat"});
      CHAT.sent=CHAT.sent.slice(-50);
      try{ localStorage.setItem("miniapp_chat_v1",JSON.stringify(CHAT)); }catch(e){}
    }

    tracks.push({rid:rid,text:text,q:q,ts:Date.now(),state:"sent",rep:null});
    if(tracks.length>MAX_TRACKS) tracks=tracks.slice(-MAX_TRACKS);
    if(input) input.value="";
    renderTracks();

    var payload={source:"miniapp_chat",text:text,user_id:uid(),rid:rid,engine:"dsh"};
    /* Публичный Mini App работает через Telegram sendData. process_api_url
       намеренно не используется: старый кеш Pages мог вернуть мёртвый туннель,
       а fetch без таймаута тогда навсегда уходил в ожидание. */
    var apiBase="";
    var initData="";
    try{
      initData=(window.Telegram && window.Telegram.WebApp &&
                window.Telegram.WebApp.initData) ||
               (typeof tg!=="undefined" && tg && tg.initData) || "";
    }catch(e){}

    function legacyFallback(){
      if (typeof tg!=="undefined" && tg && typeof tg.sendData==="function"){
        tg.sendData(JSON.stringify(payload));
        if (typeof toast==="function") toast("API недоступен — задача ушла через OpenCode");
      } else if (typeof toast==="function"){
        toast("API недоступен и sendData нет — задача не отправлена");
      }
    }

    if (apiBase && typeof fetch==="function"){
      fetch(apiBase+"/dsh/task",{
        method:"POST",
        headers:{"Content-Type":"application/json","X-Telegram-Init-Data":initData},
        body:JSON.stringify(payload)
      }).then(function(r){ return r.json(); }).then(function(j){
        if(!j || !j.ok) throw new Error("dsh/task rejected");
        if (typeof toast==="function") toast("Задача принята DeepSeek Harness");
      }).catch(legacyFallback);
    } else {
      legacyFallback();
    }
    return rid;
  }

  function buildPanel(){
    var host=document.getElementById("screen-studio"); if(!host) return null;
    if (!document.getElementById("uw-style")){
      var st=document.createElement("style"); st.id="uw-style"; st.textContent=CSS;
      var head=document.head||document.documentElement;
      if(head && head.appendChild) head.appendChild(st);
    }
    var panel=document.createElement("div"); panel.id="uw-panel";
    panel.innerHTML=
      '<div id="uw-head"><b>◈ Рабочий стол</b>'+
        '<span class="uw-badge">1 экран · 3 зоны</span>'+
        '<span class="uw-tog" id="uw-toggle">свернуть</span></div>'+
      '<div id="uw-body">'+
        '<div class="uw-zone"><div class="uw-lab"><i></i>контекст</div>'+
          '<div id="uw-context"></div></div>'+
        '<div class="uw-zone"><div class="uw-lab"><i></i>диалог · треки</div>'+
          '<div id="uw-dialog"></div></div>'+
        '<div class="uw-zone"><div class="uw-lab"><i></i>ввод + quick</div>'+
          '<div id="uw-inputrow"><input id="uw-input" type="text" '+
            'placeholder="Спросить с контекстом Студии…" autocomplete="off">'+
            '<button id="uw-send" type="button">➤</button></div>'+
          '<div id="uw-quick"></div></div>'+
      '</div>';
    host.insertBefore(panel,host.firstChild);
    return panel;
  }

  function bindQuick(){
    var box=document.getElementById("uw-quick");
    var input=document.getElementById("uw-input");
    if(!box) return;
    QUICK.forEach(function(q){
      var b=document.createElement("button"); b.type="button";
      b.textContent=q.label; b.setAttribute("data-q",q.text||"voice");
      b.addEventListener("click",function(){
        if(q.voice){
          var vb=document.getElementById("sVoiceBtn");
          if(vb && typeof vb.click==="function") vb.click();
          return;
        }
        if(input) input.value=q.text;
        send();
      });
      box.appendChild(b);
    });
  }

  function bind(){
    var head=document.getElementById("uw-head");
    var panel=document.getElementById("uw-panel");
    if(head && panel){
      head.addEventListener("click",function(){
        var closed=panel.classList.toggle("closed");
        var tog=document.getElementById("uw-toggle");
        if(tog) tog.textContent=closed?"развернуть":"свернуть";
      });
    }
    var sendBtn=document.getElementById("uw-send");
    if(sendBtn) sendBtn.addEventListener("click",send);
    var input=document.getElementById("uw-input");
    if(input && input.addEventListener) input.addEventListener("keydown",function(e){
      if(e.key==="Enter"){ if(e.preventDefault) e.preventDefault(); send(); }
    });
    bindQuick();
    if (window.addEventListener) window.addEventListener("pagehide",destroy);
  }

  function init(){
    if(!document.getElementById("screen-studio")) return false;
    if(document.getElementById("uw-panel")) return true;
    buildPanel(); bind(); ensurePolling(); render();
    return true;
  }

  window.__UNIFIED_WS__={
    enabled:true, init:init, send:send, render:render, destroy:destroy,
    getTracks:function(){
      return tracks.map(function(t){ return {rid:t.rid,state:t.state,text:t.text}; });
    },
    /* тестовый хук: присваивание CHAT.replies проходит через accessor → треки обновляются */
    simulatePoll:function(repliesObj){
      if (typeof CHAT!=="undefined" && CHAT){ CHAT.replies=repliesObj; }
      else onDataRefresh();
    }
  };

  if (document.readyState==="loading") document.addEventListener("DOMContentLoaded",init);
  else init();
})();
