// 色值仅解析一次；无色或十六进制色不创建 Canvas。
const journeyColourCache = new Map();
let journeyColourContext;
function normalizedJourneyColour(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  if (journeyColourCache.has(key)) return journeyColourCache.get(key);
  let colour = null;
  if (/^#[0-9a-f]{6}$/.test(key)) colour = key;
  else if (/^#[0-9a-f]{3}$/.test(key)) colour = '#' + [...key.slice(1)].map(c => c + c).join('');
  else if (key && !/^(inherit|initial|unset|revert|revert-layer|currentcolor)$/.test(key) &&
      !key.includes('(') && CSS.supports('color', key)) {
    journeyColourContext ||= document.createElement('canvas').getContext('2d');
    journeyColourContext.fillStyle = '#1976d2';
    journeyColourContext.fillStyle = key;
    if (/^#[0-9a-f]{6}$/i.test(journeyColourContext.fillStyle)) colour = journeyColourContext.fillStyle.toLowerCase();
  }
  journeyColourCache.set(key, colour);
  return colour;
}

// 行程段只提供备用色；实际颜色由每条轨道及其线路关系决定。
function journeyColour(leg, index = 0) {
  return ['#1976d2', '#8e44ad', '#00897b', '#e67e22', '#c0392b'][index % 5];
}
function trackJourneyColour(item, fallback) {
  const own = normalizedJourneyColour(item.meta?.tags?.colour);
  if (own) return own;
  const colours = new Set((item.meta?.relation_colours || []).map(normalizedJourneyColour).filter(Boolean));
  return colours.size === 1 ? [...colours][0] : fallback;
}

// 只拼接端点相同的轨道；分叉、缺口以及换乘段始终保持独立。
function journeyLines(items) {
  const lines = [];
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  for (const item of items) {
    if (item.coords.length < 2) continue;
    let points = item.coords.map(point => [...point]);
    const previous = lines[lines.length - 1];
    if (previous) {
      if (!same(previous.at(-1), points[0]) && !same(previous.at(-1), points.at(-1)) &&
          (same(previous[0], points[0]) || same(previous[0], points.at(-1)))) previous.reverse();
      if (same(previous.at(-1), points.at(-1))) points.reverse();
      if (same(previous.at(-1), points[0])) {
        previous.push(...points.slice(1));
        continue;
      }
    }
    lines.push(points);
  }
  return lines;
}

function journeyKml(data, scope, colours, title = '轨道行程') {
  const escapeXml = value => String(value).replace(/[<>&"']/g, c => ({
    '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&apos;'
  })[c]);
  const placemarks = data.legs.flatMap((leg, index) => {
    if (scope !== 'all' && Number(scope) !== index) return [];
    // 只合并连续同色部分，保持跨线顺序及各段独立几何。
    const runs = [];
    for (const item of data.total_path_coords.filter(item => item.leg === index)) {
      const colour = trackJourneyColour(item, colours[index]);
      if (runs.at(-1)?.colour !== colour) runs.push({colour, items:[]});
      runs.at(-1).items.push(item);
    }
    return runs.map(run => {
      const lines = journeyLines(run.items);
      const hex = run.colour.slice(1);
      const colour = 'ff' + hex.slice(4, 6) + hex.slice(2, 4) + hex.slice(0, 2);
      const geometry = lines.map(points => '<LineString><tessellate>1</tessellate><coordinates>' +
        points.map(([lat, lon]) => `${lon},${lat},0`).join(' ') + '</coordinates></LineString>').join('');
      return `<Placemark><name>${escapeXml(`第 ${index + 1} 段 · ${leg.name}`)}</name>` +
        `<description>${escapeXml(leg.transfer_label || '')}</description>` +
        `<Style><LineStyle><color>${colour}</color><width>4</width></LineStyle></Style>` +
        `<MultiGeometry>${geometry}</MultiGeometry></Placemark>`;
    });
  });
  return '<?xml version="1.0" encoding="UTF-8"?>' +
    `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${escapeXml(title)}</name>` +
    placemarks.join('') + '</Document></kml>';
}

function journeyEndpoints(data, scope) {
  const indices = data.legs.map((_, index) => index).filter(index => scope === 'all' || index === Number(scope));
  const lines = indices.flatMap(index => journeyLines(data.total_path_coords.filter(item => item.leg === index)));
  return lines.length ? [lines[0][0], lines.at(-1).at(-1)] : null;
}

// 保留换乘分组，删除一侧站名后仍能正确命名，不依赖输入框数量配对。
function groupedStationNames(entries) {
  const groups = [];
  for (const entry of entries) {
    const previous = groups.at(-1);
    if (previous && previous.group === entry.group) {
      if (!previous.names.includes(entry.name)) previous.names.push(entry.name);
    }
    else groups.push({group:entry.group, names:[entry.name]});
  }
  return groups.map(({names}) => names.length > 1 ? `${names[0]}（${names.slice(1).join('、')}）` : names[0]);
}

function stationFilename(...names) {
  const clean = value => Array.from(value.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ').trim()).slice(0, 60).join('') || '未命名站';
  return `${names.map(clean).join(' → ')}.kml`;
}

// 每段独立取两端；末端查询时将轨道顺序反转，以匹配端点所属线路。
function stationEndpoints(data, scope) {
  return data.legs.flatMap((leg, index) => {
    if (scope !== 'all' && Number(scope) !== index) return [];
    const points = journeyEndpoints(data, String(index));
    if (!points) return [];
    const ids = leg.path.map(item => item.way_id);
    return [{point:points[0], way_ids:[ids[0]]}, {point:points[1], way_ids:[ids.at(-1)]}];
  });
}

// 每次行程变化只重算坐标变化的轨道，汇总结果供所有段和总距离共同使用。
function createJourneyDistanceCache(distance) {
  let snapshot = null, totals = null, entries = [];
  return data => {
    if (snapshot === data) return totals;
    const legs = data.legs.map(() => 0);
    entries.length = Math.min(entries.length, data.total_path_coords.length);
    data.total_path_coords.forEach((item, index) => {
      const old = entries[index];
      const same = old && old.coords.length === item.coords.length &&
        old.coords.every((p, i) => p[0] === item.coords[i][0] && p[1] === item.coords[i][1]);
      let metres = same ? old.metres : 0;
      if (!same) {
        for (let i = 1; i < item.coords.length; i++) metres += distance(item.coords[i - 1], item.coords[i]);
      }
      entries[index] = {coords:item.coords, metres};
      legs[item.leg] += metres;
    });
    totals = {legs, total:legs.reduce((sum, value) => sum + value, 0)};
    snapshot = data;
    return totals;
  };
}

// 仅在用户查看或复制时生成查询，保留原始 way ID 去重和截断提醒。
function journeyOverpass(data, scope) {
  const path = !data ? [] : scope === 'all' ? data.total_path : data.legs[Number(scope)]?.path || [];
  const ids = [...new Set(path.map(item => item.way_id))];
  return {
    query: ids.length ? `[out:json][timeout:25];\n(\n${ids.map(id => `  way(${id});`).join('\n')}\n);\n(._;>;);\nout body;` : '',
    partial:path.some(item => item.span)
  };
}
