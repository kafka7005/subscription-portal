import test from 'node:test';
import assert from 'node:assert/strict';
import { countryForNode, nodeName } from './country.js';
import countryCodes from './countryCodes.json' with { type:'json' };
import { readFileSync } from 'node:fs';

test('node flags use explicit flags, codes or known country names; unknown stays unknown',()=>{
  for(const [name,code] of [['🇳🇱 Netherlands #1','NL'],['Германия','DE'],['Finland','FI'],['NL-01','NL'],['США','US'],['Sweden','SE'],['🇫🇷 Париж','FR']]) assert.equal(countryForNode({name}),code);
  assert.equal(countryForNode({name:'Локация',country_code:'jp'}),'JP');
  assert.equal(countryForNode({name:'Tunnel'}),null);
  assert.equal(nodeName({name:'🇳🇱 Нидерланды 1'}),'Нидерланды 1');
  for (const [name,code] of [['Казахстан','KZ'],['Канада','CA'],['🇦🇪 Dubai','AE'],['Singapore','SG'],['Испания #2','ES'],['CZ-01','CZ']]) assert.equal(countryForNode({name}),code);
});

test('every supported country has its local SVG asset',()=>{
  assert.ok(countryCodes.length >= 249);
  for(const code of countryCodes) assert.match(readFileSync(new URL(`../../public/assets/flags/${code.toLowerCase()}.svg`,import.meta.url),'utf8'),/<svg\b/);
});
