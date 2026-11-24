// Only bounded diagnostic labels leave the browser. Query strings, raw error
// messages, stacks, route parameters and input values never enter the payload.
const areas = new Set(['auth','keys','tariffs','payment-links','partners','gifts','admin','web','checkout','subscriptions','support','broadcast']);
const reported = new Map();
export function incidentData(kind, path, status, release) {
  const segments = String(path).split(/[?#]/,1)[0].split('/').filter(Boolean);
  const area = segments.find(s => areas.has(s)) || 'site';
  const stage = kind === 'render' ? 'render' : 'request';
  const version = /^[a-zA-Z0-9_-]{4,32}$/.test(release || '') ? release : 'local';
  const http = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
  // A stable group code also works when the response to a report is lost.
  let hash = 2166136261;
  for (const ch of [version,stage,area,http].join('|')) hash = Math.imul(hash ^ ch.charCodeAt(0),16777619);
  const code = (hash >>> 0).toString(16).toUpperCase().padStart(8,'0');
  return {code, stage, area, status:http, version};
}

export function reportIncident(kind, path, status, requestId) {
  const file = new URL(import.meta.url).pathname.split('/').pop();
  const release = /-([\w-]{6,32})\.js$/.exec(file)?.[1];
  const data = incidentData(kind,path,status,release);
  if (/^[0-9a-f-]{8,64}$/i.test(requestId || '')) data.request_id = requestId;
  if (Date.now() - (reported.get(data.code) || 0) >= 60000) {
    reported.set(data.code,Date.now());
    fetch('/api/web/error-reports', {method:'POST', credentials:'omit', referrerPolicy:'no-referrer',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify({
        name:'PortalError', message:'Incident '+data.code, tag:data.stage, context:data,
      })}).catch(() => {});
  }
  return data.request_id ? data.code+' / '+data.request_id : data.code;
}
