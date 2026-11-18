import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';

export function useSupportPresence(ticketId,enabled) {
  const sessionId=useMemo(()=>crypto.randomUUID(),[ticketId]);
  const [others,setOthers]=useState([]);
  const [available,setAvailable]=useState(null);
  const typed=useRef(0),lastPing=useRef(0),pingRef=useRef(null);
  useEffect(()=>{
    setOthers([]);setAvailable(null);typed.current=0;
    if(!enabled)return;
    let active=true,busy=false,controller;
    const path=`/portal/support/tickets/${ticketId}/presence`;
    const ping=async()=>{
      if(!active||busy||document.hidden)return;
      busy=true;lastPing.current=Date.now();controller=new AbortController();
      try{
        const response=await api.post(path,{session_id:sessionId,typing:Date.now()-typed.current<6000},{signal:controller.signal});
        if(active){setOthers(response.others||[]);setAvailable(true);}
      }catch(err){if(active&&err.name!=='AbortError')setAvailable(false);}finally{busy=false;}
    };
    pingRef.current=ping;ping();
    const id=setInterval(ping,5000);
    const visible=()=>{if(!document.hidden)ping();};
    document.addEventListener('visibilitychange',visible);
    return()=>{active=false;pingRef.current=null;controller?.abort();clearInterval(id);document.removeEventListener('visibilitychange',visible);api.del(`${path}/${sessionId}`).catch(()=>{});};
  },[ticketId,sessionId,enabled]);
  const onTyping=useCallback(()=>{typed.current=Date.now();if(Date.now()-lastPing.current>2000)pingRef.current?.();},[]);
  const stopTyping=useCallback(()=>{typed.current=0;pingRef.current?.();},[]);
  return {others,available,onTyping,stopTyping};
}
