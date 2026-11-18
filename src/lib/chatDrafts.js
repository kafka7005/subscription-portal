const PREFIX='portal:chat-draft:';
const MAX_AGE=7*86400000;
const empty=()=>({text:'',files:[],note:false});
export function readChatDraft(key,storage,now=Date.now()) {
  if(!key||!storage)return empty();
  try {
    const draft=JSON.parse(storage.getItem(PREFIX+key)||'null');
    if(!draft||!Number.isFinite(draft.updated)||now-draft.updated>MAX_AGE){storage.removeItem(PREFIX+key);return empty();}
    return {text:typeof draft.text==='string'&&draft.text.length<=4000?draft.text:'',
      files:Array.isArray(draft.files)?draft.files.filter(x=>typeof x==='string'&&/^\/api\/web\/uploads\/[A-Za-z0-9_.-]+$/.test(x)&&!x.includes('..')).slice(0,10):[],note:draft.note===true};
  }catch{return empty();}
}
export function saveChatDraft(key,draft,storage,now=Date.now()) {
  if(!key||!storage)return false;
  try {
    if(!draft.text&&!draft.files.length)storage.removeItem(PREFIX+key);
    else storage.setItem(PREFIX+key,JSON.stringify({...draft,updated:now}));
    return true;
  }catch{return false;}
}
export function insertChatTemplate(text,body,selection) {
  const a=Math.min(text.length,Math.max(0,selection?.start??text.length));
  const b=Math.min(text.length,Math.max(a,selection?.end??a));
  const next=text.slice(0,a)+body+text.slice(b);
  return next.length>4000?null:{text:next,caret:a+body.length};
}
