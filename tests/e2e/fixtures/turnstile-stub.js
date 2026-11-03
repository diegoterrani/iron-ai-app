// Imitação do Turnstile para testes (sem rede): o modo automático só age no load;
// reset/remove num contêiner sem widget lançam erro, como o script real.
(function(){
  const widgets = new Map(); let n = 0;
  function mount(el){ if(!el||el.querySelector('input[name=cf-turnstile-response]')) return; const id='w'+(++n); const i=document.createElement('input'); i.type='hidden'; i.name='cf-turnstile-response'; i.value='TOKEN-'+id; el.appendChild(i); widgets.set(id, el); return id; }
  function find(x){ if(typeof x==='string' && widgets.has(x)) return x; for (const [id,el] of widgets) if(el===x) return id; return null; }
  window.turnstile = {
    render: (el) => mount(typeof el==="string"?document.querySelector(el):el),
    reset: (x) => { const id=find(x); if(!id) throw new Error('[Cloudflare Turnstile] Nothing to reset found for provided container.'); const el=widgets.get(id); const i=el.querySelector('input[name=cf-turnstile-response]'); if(i) i.value='TOKEN-'+id+'-r'; },
    remove: (x) => { const id=find(x); if(!id) throw new Error('[Cloudflare Turnstile] Nothing to remove found for provided container.'); widgets.get(id).querySelector('input[name=cf-turnstile-response]')?.remove(); widgets.delete(id); },
    getResponse: (x) => { const id=find(x); return id ? widgets.get(id).querySelector('input')?.value : undefined; },
  };
  const explicit = /render=explicit/.test((document.currentScript||{}).src||'');
  if(!explicit) document.querySelectorAll('.cf-turnstile').forEach(el=>mount(el));
})();
