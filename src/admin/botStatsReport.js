// API 1.3 sends Telegram's visible text. Keep values as supplied by the bot.
const headingIcon = /^\p{Extended_Pictographic}\uFE0F?\s+/u;
const branch = /^[│\s]*[├└](─*)\s*/u;
const numericValue = /^([~≈+−-]?\d+(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d+)?\s*(?:₽|%)?(?:\s*\/\s*\d+(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d+)?)?(?:\s*\([^)]*\))?)$/u;

function metric(line) {
  const tree = line.match(branch);
  const content = line.slice(tree?.[0].length || 0);
  // Prefer explicit delimiters, including padded columns for nested tariff names.
  const parts = content.match(/^(.+?):\s+(.+)$/u) || content.match(/^(.+?)\s{2,}(\S.*)$/u);
  if (parts && (tree || numericValue.test(parts[2]))) {
    return { label: parts[1].trim(), value: parts[2].trim(), depth: (tree?.[1].length || 0) / 2 };
  }
  if (tree) {
    // Bot columns have just one space after the widest label.
    // Labels such as "Динамика за 30 дней" can contain numbers themselves.
    for (const split of content.matchAll(/\s+(?=[~≈+−-]?\d)/gu)) {
      const value = content.slice(split.index).trim();
      if (numericValue.test(value)) return { label: content.slice(0, split.index), value, depth: tree[1].length / 2 };
    }
  }
  return null;
}

export function parseBotStats(text = '') {
  const lines = text.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  if (/^_{3,}$/u.test(lines[1] || '')) lines.splice(0, 2);
  const groups = [];
  let updated = '';
  if (/^обновлено\s+\d/iu.test(lines.at(-1) || '')) updated = lines.pop();
  let group;
  function start(title) {
    group = { title, rows: [] };
    groups.push(group);
  }
  for (const [index, line] of lines.entries()) {
    const row = metric(line);
    if (row) {
      if (!group) start('');
      group.rows.push(row);
    } else if (headingIcon.test(line) || (!branch.test(line) && metric(lines[index + 1] || '') && !line.includes(':'))) {
      start(line.replace(headingIcon, ''));
    } else {
      if (!group) start('');
      const previous = group.rows.at(-1);
      if (previous?.text && !/[.!?…]$/u.test(previous.text)) previous.text += ' ' + line;
      else group.rows.push({ text: line });
    }
  }
  return { groups, updated };
}
