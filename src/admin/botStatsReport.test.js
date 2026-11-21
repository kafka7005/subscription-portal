import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBotStats } from './botStatsReport.js';

test('keeps exact values in aligned and single-space bot columns', () => {
  const { groups, updated } = parseBotStats('Подписки\n_____\n🔐 Подписки\n├ Клиентов   1 234\n├ За 24 часа 0\n├ Оплаты за месяц ~12 345 ₽\n├ Подписок 1 / 3\n└ Платящих 5 (3.2%)\nобновлено 21.11.26 11:00:00');
  assert.deepEqual(groups[0].rows.map(({label, value}) => [label,value]), [
    ['Клиентов','1 234'], ['За 24 часа','0'], ['Оплаты за месяц','~12 345 ₽'], ['Подписок','1 / 3'], ['Платящих','5 (3.2%)'],
  ]);
  assert.equal(updated,'обновлено 21.11.26 11:00:00');
});

test('preserves tariff nesting, module statistics and free text', () => {
  const { groups } = parseBotStats('📦 По тарифам\n├ Группа  2\n└──── Тариф 10: 2\nМодуль\nУчастников: 20\nℹ️ Кто это\nПроизвольный текст.');
  assert.equal(groups[0].rows[1].depth,2);
  assert.equal(groups[0].rows[1].label,'Тариф 10');
  assert.equal(groups[1].title,'Модуль');
  assert.deepEqual(groups[2].rows,[{text:'Произвольный текст.'}]);
});

test('reads digit-ending tariff labels and unwraps bot notes', () => {
  const { groups } = parseBotStats('📦 По тарифам\n└──── Тариф 10 2\nℹ️ Кто это\nХолодные —\nновые клиенты.');
  assert.deepEqual(groups[0].rows[0],{label:'Тариф 10',value:'2',depth:2});
  assert.equal(groups[1].rows[0].text,'Холодные — новые клиенты.');
});
