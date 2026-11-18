import test from 'node:test';
import assert from 'node:assert/strict';
import { insertChatTemplate, readChatDraft, saveChatDraft } from './chatDrafts.js';

function storage(){const data=new Map();return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};}
test('template inserts at caret or replaces selection while preserving surrounding text',()=>{
  assert.deepEqual(insertChatTemplate('Hello world','new ',{start:6,end:6}),{text:'Hello new world',caret:10});
  assert.deepEqual(insertChatTemplate('Hello world','friend',{start:6,end:11}),{text:'Hello friend',caret:12});
  assert.deepEqual(insertChatTemplate('Before',' after'),{text:'Before after',caret:12});
  assert.equal(insertChatTemplate('a'.repeat(4000),'b',{start:0,end:0}),null);
});
test('draft restores text, note and uploaded attachments only for its account and ticket',()=>{
  const local=storage(),draft={text:'Draft',note:true,files:['/api/web/uploads/image.png']};
  assert.equal(saveChatDraft('a:agent:ticket1',draft,local,1000),true);
  assert.deepEqual(readChatDraft('a:agent:ticket1',local,1001),draft);
  assert.equal(readChatDraft('b:agent:ticket1',local,1001).text,'');
  assert.equal(readChatDraft('a:agent:ticket2',local,1001).text,'');
  assert.equal(readChatDraft('a:client:ticket1',local,1001).text,'');
});
test('cleared draft stays cleared, and old drafts expire after seven days',()=>{
  const local=storage();saveChatDraft('key',{text:'Draft',files:[],note:false},local,1000);
  assert.equal(readChatDraft('key',local,1001+7*86400000).text,'');
  saveChatDraft('key',{text:'Draft',files:[],note:false},local,2000);
  saveChatDraft('key',{text:'',files:[],note:false},local,2001);
  assert.equal(readChatDraft('key',local,2002).text,'');
});
test('corrupt storage, unavailable storage and invalid attachment links do not break the composer',()=>{
  const local=storage();local.setItem('portal:chat-draft:key','bad json');
  assert.equal(readChatDraft('key',local,1000).text,'');
  saveChatDraft('key',{text:'Keep',files:['https://outside.test/image.png','/api/web/uploads/..','/api/web/uploads/good.png'],note:false},local,1000);
  assert.deepEqual(readChatDraft('key',local,1001).files,['/api/web/uploads/good.png']);
  assert.equal(saveChatDraft('key',{text:'Keep',files:[],note:false},{setItem(){throw Error('denied');}},1000),false);
});
