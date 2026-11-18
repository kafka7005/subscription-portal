import countryCodes from './countryCodes.json' with { type: 'json' };

const normalize = (value) => String(value || '').toLocaleLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const displayNames = ['ru','en'].map(locale => new Intl.DisplayNames([locale],{type:'region'}));
const localized = countryCodes.flatMap(code => displayNames.map(names => [code, normalize(names.of(code))])).sort((a,b) => b[1].length-a[1].length);
const COUNTRIES = [
  ['NL', /нидерланд|голлан|netherlands|holland/i], ['DE', /герман|germany|deutsch/i],
  ['FI', /финлянд|finland/i], ['FR', /франц|france/i], ['RU', /росси|russia/i],
  ['US', /сша|соедин.нные штаты|united states|\busa\b/i], ['GB', /британ|великобрит|united kingdom|\buk\b|england/i],
  ['SE', /швеци|sweden/i], ['NO', /норвег|norway/i], ['DK', /дани[яи]|denmark/i],
  ['CH', /швейцар|switzerland/i], ['PL', /польш|poland/i], ['EE', /эстон|estonia/i],
  ['LV', /латви|latvia/i], ['LT', /литв|lithuania/i], ['UA', /украин|ukraine/i],
  ['TR', /турци|turkey|türkiye/i], ['JP', /япони|japan/i], ['IT', /итали|italy/i],
  ['AT', /австри|austria/i], ['BE', /бельги|belgium/i], ['IE', /ирланд|ireland/i],
  ['RO', /румын|romania/i], ['BG', /болгар|bulgaria/i], ['HU', /венгр|hungary/i],
];
export function countryForNode(node) {
  const name = String(node.name || '');
  const flag = name.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u)?.[0];
  if (flag) return Array.from(flag, x => String.fromCharCode(x.codePointAt(0) - 0x1F1E6 + 65)).join('');
  const explicit = String(node.country_code || node.country || '').toUpperCase();
  if (countryCodes.includes(explicit)) return explicit;
  const text = ` ${normalize(`${name} ${node.country || ''}`)} `;
  const fullName = localized.find(([,label]) => label && text.includes(` ${label} `))?.[0];
  if (fullName) return fullName;
  const known = COUNTRIES.find(([code,pattern]) => pattern.test(name) || new RegExp(`(?:^|[\\s|_()\\[\\]-])${code}(?=$|[\\s|_()\\[\\]0-9-])`, 'i').test(name))?.[0];
  return known || countryCodes.find(code => new RegExp(`(?:^|[\\s|_()\\[\\]-])${code}(?=$|[\\s|_()\\[\\]0-9-])`).test(name)) || null;
}
export function nodeName(node) { return String(node.name || 'Локация').replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, '').trim() || 'Локация'; }
