import test from 'node:test';
import assert from 'node:assert/strict';
import {incidentData} from './incident.js';

test('diagnostic labels omit user input and group the same failure', () => {
  const a=incidentData('request','/keys/example-private-id/renew?token=fixture',503,'build_42');
  const b=incidentData('request','/keys/another-private-id/renew',503,'build_42');
  assert.deepEqual(a,b);
  assert.equal(a.area,'keys');
  assert.match(a.code,/^[0-9A-F]{8}$/);
  assert.equal(incidentData('render','/private-id',999,'unsafe/path').version,'local');
});
