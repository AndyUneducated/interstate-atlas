/* Interface strings. Route dossiers carry their own bilingual prose in
   data/dossiers/; this file covers the chrome only.

   Placeholders look like {n} and are filled positionally by t(). */

export const STRINGS = {
  en: {
    'app.name': 'INTERSTATE ATLAS',
    'app.tagline': 'the highway network of the United States',
    'boot.title': 'INTERSTATE ATLAS',
    'boot.sub': 'assembling the road network',
    'boot.step.index': 'reading route index',
    'boot.step.geo': 'loading interstate geometry',
    'boot.step.map': 'initialising map surface',
    'boot.step.ready': 'ready',

    'nav.search': 'Search',
    'nav.numbering': 'Numbering',
    'nav.dashboard': 'Statistics',
    'nav.timeline': 'Timeline',
    'nav.planner': 'Trip',
    'nav.terrain': '3D terrain',
    'nav.lang': '中文',
    'nav.langTitle': 'Switch to Chinese',
    'nav.panel': 'Toggle panel',
    'nav.about': 'About',

    'sys.title': 'Route systems',
    'sys.interstate': 'Interstate Highways',
    'sys.us': 'US Numbered Routes',
    'sys.state': 'State Routes',
    'sys.interstate.meta': 'grade-separated freeway network',
    'sys.us.meta': 'the pre-1956 national grid',
    'sys.state.meta': 'load by state',
    'sys.routes': '{n} routes',
    'sys.miles': '{n} mi',
    'sys.pickState': 'Choose a state',
    'sys.allStates': 'All states',

    'search.placeholder': 'Search I-95, US 66, California…',
    'search.results': 'Results',
    'search.none': 'Nothing matches that.',
    'search.hint': 'Type a route number, a name, or a state.',
    'search.count': '{n} of {total} routes',

    'pal.placeholder': 'Jump to a route, a state, or a view…',
    'pal.routes': 'Routes',
    'pal.views': 'Views',
    'pal.states': 'States',
    'pal.nav': 'navigate',
    'pal.open': 'open',
    'pal.close': 'dismiss',

    'dt.from': 'Southern / western end',
    'dt.to': 'Northern / eastern end',
    'dt.fromEW': 'Western end',
    'dt.toEW': 'Eastern end',
    'dt.fromNS': 'Southern end',
    'dt.toNS': 'Northern end',
    'dt.near': 'near {place}',
    'dt.nearBy': '{km} km from {place}',
    'dt.atPlace': '{place}',
    'dt.length': 'Length',
    'dt.states': 'States',
    'dt.straight': 'Direct span',
    'dt.gradeSep': 'Freeway',
    'dt.tolled': 'Tolled',
    'dt.divided': 'Divided',
    'dt.fly': 'Fly the route',
    'dt.addTrip': 'Add to trip',
    'dt.zoom': 'Zoom to fit',
    'dt.unknown': 'no public figure',

    'sect.character': 'Character and alignment',
    'sect.engineering': 'Roadway and engineering',
    'sect.history': 'How it came to be',
    'sect.money': 'What it cost, and who paid',
    'sect.condition': 'Condition and upkeep',
    'sect.traffic': 'Traffic and freight',
    'sect.drive': 'Driving it today',
    'sect.composition': 'Roadway classification',
    'sect.statesList': 'Mileage by state',
    'sect.elevation': 'Elevation profile',
    'sect.served': 'Places along the way',
    'sect.data': 'Where these numbers come from',
    'served.src': 'Urban areas of 5,000 or more served by this route, as listed in the FHWA Route Log and Finder List (January 2026).',
    'src.routelog': 'FHWA Route Log and Finder List, January 2026',
    'search.written': 'Has a written route dossier',
    'len.official': 'Official length',
    'len.measured': 'Measured here',
    'len.measuredSrc': 'End-to-end along the mapped centreline (Natural Earth 1:1,000,000)',
    'len.delta': 'Difference',
    'len.deltaWhy': 'Generalised geometry runs slightly short on curves. Larger gaps usually mean the official figure assigns shared mileage to the other route where two Interstates run together, or that the mapped alignment predates a renumbering.',

    'comp.Freeway': 'Freeway',
    'comp.Tollway': 'Tollway',
    'comp.Primary': 'Primary',
    'comp.Secondary': 'Secondary',
    'comp.Other Paved': 'Other paved',
    'comp.Unpaved': 'Unpaved',
    'comp.Ferry': 'Ferry',
    'comp.Trail': 'Trail',
    'comp.Paved': 'Paved',
    'comp.Unknown': 'Unclassified',

    'note.derived': 'Length, endpoints, state mileage and roadway class on this page are measured from the mapped geometry (Natural Earth, 1:1,000,000). Treat them as close rather than survey-exact.',
    'note.gaps': 'The source map has {n} break(s) along this route, {mi} mi in total, where the roadway is filed under another classification. Those stretches are missing from the drawn line and from the length above.',
    'note.noDossier': 'No written profile yet for this route. The figures above are measured from the map data.',

    'elev.none': 'No elevation profile generated for this route.',
    'elev.high': 'Highest point',
    'elev.low': 'Lowest point',
    'elev.climb': 'Total climb',
    'elev.at': '{ft} ft at mile {mi}',
    'elev.src': 'Sampled every {mi} mi from the Terrain Tiles open dataset. This is the height of the ground under the route, so a tunnel reads as the ridge above it and a long bridge as the water below.',

    'nb.title': 'How the numbers work',
    'nb.sub': 'The two national systems are numbered on deliberately opposite grids.',
    'nb.tab.i': 'Interstates',
    'nb.tab.us': 'US Routes',
    'nb.tab.aux': 'Three-digit routes',
    'nb.i.h': 'Interstates: low numbers south and west',
    'nb.us.h': 'US Routes: low numbers north and east',
    'nb.aux.h': 'Three digits: a child of a parent route',

    'dash.title': 'The network in numbers',
    'dash.sub': 'Measured from the mapped geometry across {n} routes.',
    'dash.totalMi': 'Mapped miles',
    'dash.routes': 'Routes',
    'dash.states': 'Jurisdictions',
    'dash.freeway': 'Freeway miles',
    'dash.bySystem': 'By system',
    'dash.byState': 'By state',
    'dash.byClass': 'By roadway class',
    'dash.longest': 'Longest routes',
    'dash.col.route': 'Route',
    'dash.col.mi': 'Miles',
    'dash.col.states': 'States',
    'dash.col.from': 'From',
    'dash.col.to': 'To',
    'dash.mostMiles': 'Most mapped miles',

    'tl.title': 'Building the Interstates',
    'tl.sub': 'Drag the year. Routes appear once their documented completion year has passed; routes without a documented year stay hidden.',
    'tl.year': 'Year',
    'tl.complete': 'Routes complete',
    'tl.miles': 'Miles open',
    'tl.events': 'That year',
    'tl.play': 'Play',
    'tl.pause': 'Pause',
    'tl.noEvents': 'Nothing documented for this year.',

    'tp.title': 'Plan a drive',
    'tp.sub': 'Chain routes together to see the combined distance. Add routes from any detail panel.',
    'tp.empty': 'No legs yet.\nOpen a route and choose “Add to trip”.',
    'tp.legs': 'Legs',
    'tp.total': 'Total mapped',
    'tp.clear': 'Clear',
    'tp.flyAll': 'Fly the whole trip',
    'tp.leg': 'Leg {n}',
    'tp.freeway': 'Freeway share',
    'tp.statesTouched': 'States touched',
    'tp.driveEst': 'Rough driving time',
    'tp.driveNote': 'Estimated at 65 mph on freeway miles and 45 mph elsewhere, before stops or traffic.',
    'tp.hours': '{h} h {m} min',

    'fly.speed': 'Speed',
    'fly.mile': 'Mile',
    'fly.remaining': 'Remaining',
    'fly.exit': 'Exit',
    'fly.restart': 'Restart',

    'about.title': 'About this atlas',
    'about.sub': 'What it is made of, and what it does not know.',

    'toast.terrainOn': '3D terrain on',
    'toast.terrainOff': '3D terrain off',
    'toast.loadingState': 'Loading {state} routes…',
    'toast.tripAdded': 'Added {route} to the trip',
    'toast.tripDup': '{route} is already in the trip',
    'toast.noPath': 'No traceable path for this route',
    'toast.copied': 'Link copied',

    'unit.mi': 'mi',
    'unit.km': 'km',
    'unit.ft': 'ft',
  },

  zh: {
    'app.name': '美国公路图谱',
    'app.tagline': '美国国家公路网',
    'boot.title': '美国公路图谱',
    'boot.sub': '正在装配公路网',
    'boot.step.index': '读取路线索引',
    'boot.step.geo': '加载州际公路几何数据',
    'boot.step.map': '初始化地图',
    'boot.step.ready': '就绪',

    'nav.search': '搜索',
    'nav.numbering': '编号规则',
    'nav.dashboard': '统计',
    'nav.timeline': '建设时间轴',
    'nav.planner': '行程',
    'nav.terrain': '三维地形',
    'nav.lang': 'EN',
    'nav.langTitle': '切换到英文',
    'nav.panel': '收起面板',
    'nav.about': '关于',

    'sys.title': '路网系统',
    'sys.interstate': '州际公路',
    'sys.us': '美国国道',
    'sys.state': '州级公路',
    'sys.interstate.meta': '全立体交叉高速公路网',
    'sys.us.meta': '1956 年之前的国家路网',
    'sys.state.meta': '按州加载',
    'sys.routes': '{n} 条',
    'sys.miles': '{n} 英里',
    'sys.pickState': '选择州',
    'sys.allStates': '全部州',

    'search.placeholder': '搜索 I-95、US 66、加利福尼亚…',
    'search.results': '结果',
    'search.none': '没有匹配的路线。',
    'search.hint': '可输入公路编号、名称或州名。',
    'search.count': '{total} 条路线中的 {n} 条',

    'pal.placeholder': '跳转到路线、州或视图…',
    'pal.routes': '路线',
    'pal.views': '视图',
    'pal.states': '州',
    'pal.nav': '选择',
    'pal.open': '打开',
    'pal.close': '关闭',

    'dt.from': '南端／西端',
    'dt.to': '北端／东端',
    'dt.fromEW': '西端起点',
    'dt.toEW': '东端终点',
    'dt.fromNS': '南端起点',
    'dt.toNS': '北端终点',
    'dt.near': '邻近 {place}',
    'dt.nearBy': '距 {place} {km} 公里',
    'dt.atPlace': '{place}',
    'dt.length': '总长',
    'dt.states': '途经州',
    'dt.straight': '直线距离',
    'dt.gradeSep': '高速比例',
    'dt.tolled': '收费比例',
    'dt.divided': '分隔车道',
    'dt.fly': '巡航此路线',
    'dt.addTrip': '加入行程',
    'dt.zoom': '缩放至全线',
    'dt.unknown': '无公开数据',

    'sect.character': '定位与走向',
    'sect.engineering': '路基与工程',
    'sect.history': '来历',
    'sect.money': '造价与出资方',
    'sect.condition': '现状与养护',
    'sect.traffic': '车流与货运',
    'sect.drive': '今天驾车体验',
    'sect.composition': '路段等级构成',
    'sect.statesList': '各州里程',
    'sect.elevation': '高程剖面',
    'sect.served': '沿途城镇',
    'sect.data': '这些数字的来源',
    'served.src': '本路线服务的 5,000 人以上城镇，取自美国联邦公路管理局《州际公路路线名录》（2026 年 1 月）。',
    'src.routelog': '美国联邦公路管理局《州际公路路线名录》，2026 年 1 月',
    'search.written': '已撰写详细介绍',
    'len.official': '官方里程',
    'len.measured': '本站实测',
    'len.measuredSrc': '沿地图中心线端到端量算（Natural Earth 1:1,000,000）',
    'len.delta': '差值',
    'len.deltaWhy': '简化后的几何在弯道处会略短。差距较大时，通常是因为两条州际公路共线时官方把重复里程记在了另一条路名下，或地图上的走向仍是改号前的旧线。',

    'comp.Freeway': '高速公路',
    'comp.Tollway': '收费公路',
    'comp.Primary': '主干道',
    'comp.Secondary': '次干道',
    'comp.Other Paved': '其他铺装路面',
    'comp.Unpaved': '未铺装',
    'comp.Ferry': '轮渡',
    'comp.Trail': '土路',
    'comp.Paved': '铺装路面',
    'comp.Unknown': '未分类',

    'note.derived': '本页的长度、起止点、各州里程与路段等级，均由地图几何数据（Natural Earth，1:1,000,000）实测得出，属接近值，并非测绘精度。',
    'note.gaps': '原始地图数据在本路线上有 {n} 处断口，合计约 {mi} 英里，这些路段在原始数据中被归入了其他分类。上方的长度和图上的线条都不包含这些路段。',
    'note.noDossier': '此路线暂无撰写好的详情。上方数字均由地图数据实测得出。',

    'elev.none': '此路线尚未生成高程剖面。',
    'elev.high': '最高点',
    'elev.low': '最低点',
    'elev.climb': '累计爬升',
    'elev.at': '{ft} 英尺，位于第 {mi} 英里',
    'elev.src': '每 {mi} 英里取样一次，数据来自 Terrain Tiles 开放数据集。取的是路线所在地面的高程，因此隧道读出的是其上方山脊的高度，长桥读出的是桥下水面的高度。',

    'nb.title': '编号是怎么排的',
    'nb.sub': '两套全国性系统，刻意采用了完全相反的编号方向。',
    'nb.tab.i': '州际公路',
    'nb.tab.us': '美国国道',
    'nb.tab.aux': '三位数路线',
    'nb.i.h': '州际公路：小号在南、在西',
    'nb.us.h': '美国国道：小号在北、在东',
    'nb.aux.h': '三位数：某条主路的“子路”',

    'dash.title': '用数字看路网',
    'dash.sub': '基于 {n} 条路线的地图几何实测结果。',
    'dash.totalMi': '制图里程',
    'dash.routes': '路线数',
    'dash.states': '行政区',
    'dash.freeway': '高速里程',
    'dash.bySystem': '按系统',
    'dash.byState': '按州',
    'dash.byClass': '按路段等级',
    'dash.longest': '最长的路线',
    'dash.col.route': '路线',
    'dash.col.mi': '英里',
    'dash.col.states': '州数',
    'dash.col.from': '起点',
    'dash.col.to': '终点',
    'dash.mostMiles': '制图里程最多',

    'tl.title': '州际公路的建成过程',
    'tl.sub': '拖动年份。路线在其有据可查的建成年份之后出现；没有确切年份记载的路线不会显示。',
    'tl.year': '年份',
    'tl.complete': '已建成路线',
    'tl.miles': '通车里程',
    'tl.events': '当年大事',
    'tl.play': '播放',
    'tl.pause': '暂停',
    'tl.noEvents': '该年份暂无收录的记载。',

    'tp.title': '规划一次自驾',
    'tp.sub': '把多条公路串起来，看合计里程。在任意详情面板中加入路线。',
    'tp.empty': '还没有行程段。\n打开一条路线，点「加入行程」。',
    'tp.legs': '行程段',
    'tp.total': '合计制图里程',
    'tp.clear': '清空',
    'tp.flyAll': '巡航整段行程',
    'tp.leg': '第 {n} 段',
    'tp.freeway': '高速占比',
    'tp.statesTouched': '途经州',
    'tp.driveEst': '粗略行车时间',
    'tp.driveNote': '按高速段 65 英里/小时、其余路段 45 英里/小时估算，未计入停车与拥堵。',
    'tp.hours': '{h} 小时 {m} 分',

    'fly.speed': '速度',
    'fly.mile': '里程',
    'fly.remaining': '剩余',
    'fly.exit': '退出',
    'fly.restart': '重新开始',

    'about.title': '关于本图谱',
    'about.sub': '它由什么构成，以及它不知道什么。',

    'toast.terrainOn': '三维地形已开启',
    'toast.terrainOff': '三维地形已关闭',
    'toast.loadingState': '正在加载 {state} 的公路…',
    'toast.tripAdded': '已将 {route} 加入行程',
    'toast.tripDup': '{route} 已在行程中',
    'toast.noPath': '此路线没有可追踪的连续路径',
    'toast.copied': '链接已复制',

    'unit.mi': '英里',
    'unit.km': '公里',
    'unit.ft': '英尺',
  },
};

// State names, needed in both languages for the state picker and route detail.
export const STATE_LABEL = {
  AL: ['Alabama', '亚拉巴马'], AK: ['Alaska', '阿拉斯加'], AZ: ['Arizona', '亚利桑那'],
  AR: ['Arkansas', '阿肯色'], CA: ['California', '加利福尼亚'], CO: ['Colorado', '科罗拉多'],
  CT: ['Connecticut', '康涅狄格'], DE: ['Delaware', '特拉华'], DC: ['District of Columbia', '华盛顿哥伦比亚特区'],
  FL: ['Florida', '佛罗里达'], GA: ['Georgia', '佐治亚'], HI: ['Hawaii', '夏威夷'],
  ID: ['Idaho', '爱达荷'], IL: ['Illinois', '伊利诺伊'], IN: ['Indiana', '印第安纳'],
  IA: ['Iowa', '艾奥瓦'], KS: ['Kansas', '堪萨斯'], KY: ['Kentucky', '肯塔基'],
  LA: ['Louisiana', '路易斯安那'], ME: ['Maine', '缅因'], MD: ['Maryland', '马里兰'],
  MA: ['Massachusetts', '马萨诸塞'], MI: ['Michigan', '密歇根'], MN: ['Minnesota', '明尼苏达'],
  MS: ['Mississippi', '密西西比'], MO: ['Missouri', '密苏里'], MT: ['Montana', '蒙大拿'],
  NE: ['Nebraska', '内布拉斯加'], NV: ['Nevada', '内华达'], NH: ['New Hampshire', '新罕布什尔'],
  NJ: ['New Jersey', '新泽西'], NM: ['New Mexico', '新墨西哥'], NY: ['New York', '纽约'],
  NC: ['North Carolina', '北卡罗来纳'], ND: ['North Dakota', '北达科他'], OH: ['Ohio', '俄亥俄'],
  OK: ['Oklahoma', '俄克拉何马'], OR: ['Oregon', '俄勒冈'], PA: ['Pennsylvania', '宾夕法尼亚'],
  PR: ['Puerto Rico', '波多黎各'], RI: ['Rhode Island', '罗德岛'], SC: ['South Carolina', '南卡罗来纳'],
  SD: ['South Dakota', '南达科他'], TN: ['Tennessee', '田纳西'], TX: ['Texas', '得克萨斯'],
  UT: ['Utah', '犹他'], VT: ['Vermont', '佛蒙特'], VA: ['Virginia', '弗吉尼亚'],
  WA: ['Washington', '华盛顿州'], WV: ['West Virginia', '西弗吉尼亚'], WI: ['Wisconsin', '威斯康星'],
  WY: ['Wyoming', '怀俄明'],
};

let lang = 'en';

export function setLang(next) {
  lang = STRINGS[next] ? next : 'en';
  document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : 'en';
  document.documentElement.dataset.lang = lang;
  return lang;
}

export function getLang() { return lang; }

export function t(key, vars) {
  const table = STRINGS[lang] || STRINGS.en;
  let s = table[key] ?? STRINGS.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

export function stateName(code) {
  const pair = STATE_LABEL[code];
  if (!pair) return code;
  return lang === 'zh' ? pair[1] : pair[0];
}

// Chinese keeps the mile as the unit of record because every published US
// highway figure is in miles; the kilometre equivalent rides alongside.
export function miles(n) {
  if (n == null) return '—';
  const s = Math.round(n).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US');
  return lang === 'zh' ? `${s} 英里` : `${s} mi`;
}

export function num(n, digits = 0) {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}
