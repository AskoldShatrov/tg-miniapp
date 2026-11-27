/* Папка активных запросов из Telegram внутри вкладки «Ход».
   Источник: process_api /live/activity -> ~/.local/state/miniapp/live-progress.json.
   Ничего не отправляет и не меняет состояние — только чтение раз в 3 секунды. */
(function(){
  var host = null;

  function esc(value){
    return String(value == null ? "" : value).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  function render(rows){
    if(!host) return;
    if(!rows || !rows.length){
      host.innerHTML = '<div style="padding:10px 12px;color:var(--overlay2);font:600 12px/1.4 var(--ff)">' +
        'Активных запросов из Telegram сейчас нет — отправь сообщение боту.</div>';
      return;
    }
    host.innerHTML = rows.map(function(r){
      var key = String(r.key || r.id || "");
      var step = Number(r.step) || 0;
      var total = Number(r.total) || 0;
      var ts = Number(r.updated_at) || 0;
      var clock = ts ? new Date(ts * 1000).toLocaleTimeString("ru-RU",
        {hour:"2-digit",minute:"2-digit",second:"2-digit"}) : "—";
      return '<div class="tg-req" data-key="' + esc(key) + '" style="padding:9px 11px;margin-bottom:7px;' +
        'background:var(--surface0);border:1px solid var(--surface1);border-radius:10px;cursor:pointer">' +
        '<div style="font:700 13px/1.35 var(--ff);color:var(--text)">' +
          esc(r.title || r.label || key) + '</div>' +
        '<div style="margin-top:5px;color:var(--subtext0);font:600 10.5px/1.3 var(--fm)">' +
          esc(key) + (r.session_id ? " · " + esc(r.session_id) : "") + '</div>' +
        '<div style="margin-top:4px;color:var(--blue);font:700 10.5px/1.3 var(--fm)">' +
          'шаг ' + step + (total ? " / " + total : "") + ' · ' + esc(clock) + '</div>' +
        '</div>';
    }).join("");

    Array.prototype.forEach.call(host.querySelectorAll(".tg-req"), function(el){
      el.addEventListener("click", function(){
        var key = el.getAttribute("data-key");
        var row = rows.filter(function(x){ return String(x.key || x.id) === key; })[0];
        if(row && window.TaskTree && window.TaskTree.open){
          window.TaskTree.open({id:key, title:row.title || row.label || key,
                                source:"telegram", raw:row});
        }
      });
    });
  }

  function poll(){
    // process_api сознательно отключён в статическом мини-апе; живые прогоны
    // публикуются в live.json:runs и доступны даже через GitHub Pages.
    fetch("live.json?ts=" + Date.now(), {cache:"no-store"})
      .then(function(r){ if(!r.ok) throw new Error("live.json HTTP " + r.status); return r.json(); })
      .then(function(data){ render(data && Array.isArray(data.runs) ? data.runs : []); })
      .catch(function(){ /* последний удачный список остаётся на экране */ });
  }

  function init(){
    host = document.getElementById("tgRequestsFolder");
    if(!host) return;
    poll();
    setInterval(poll, 3000);
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
