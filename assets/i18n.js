/* Interface strings. Route dossiers carry their own bilingual prose in
   data/dossiers/; this file covers the chrome only.

   Placeholders look like {n} and are filled positionally by t(). */

export const STRINGS = {
  en: {
    'app.name': 'HIGHWAY ATLAS',
    'app.tagline': 'the highway network of North America',
    'boot.title': 'HIGHWAY ATLAS',
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
    'sys.country.us': 'United States',
    'sys.country.ca': 'Canada',
    'sys.interstate': 'Interstate Highways',
    'sys.us': 'US Numbered Routes',
    'sys.state': 'State Routes',
    'sys.tch': 'Trans-Canada Highway',
    'sys.nhs': 'National Highway System',
    // "Municipal" is in the name because it is in the data: the national road
    // file records county and municipal route numbers in the same field as
    // provincial highway numbers, and they cannot be told apart by road class.
    // Ontario numbers thirty-five county roads 4, alongside its Highway 4.
    'sys.provincial': 'Provincial & Municipal Routes',
    'sys.interstate.meta': 'grade-separated freeway network',
    'sys.us.meta': 'the pre-1956 national grid',
    'sys.state.meta': 'load by state',
    'sys.tch.meta': 'one road, a different number in each province',
    'sys.nhs.meta': 'the designated national network',
    'sys.provincial.meta': 'every numbered route, load by province',
    'sys.routes': '{n} routes',
    'sys.miles': '{n} mi',
    'sub.state': 'one state',
    'sub.states': '{n} states',
    'sys.pickState': 'Choose a state',
    'sys.allStates': 'All states',
    'sys.pickProvince': 'Choose a province',

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
    'dt.provinces': 'Provinces',
    'dt.unsigned': 'Unsigned designation',
    'dt.unsignedWhy': 'Federally designated as part of the Interstate System, but carries no Interstate markers and appears on no road atlas. Alaskans know these roads by their names.',

    // Canada
    'ca.nhs': 'National Highway System',
    'ca.nhs.core': 'Core route',
    'ca.nhs.feeder': 'Feeder route',
    'ca.nhs.northern': 'Northern and remote route',
    'ca.nhs.none': 'Not designated',
    'ca.nhs.coreWhy': 'A key interprovincial or international corridor.',
    'ca.nhs.feederWhy': 'A link to the core network from another population or economic centre.',
    'ca.nhs.northernWhy': 'A primary means of access to northern areas, communities and resources.',
    'ca.tch': 'Trans-Canada Highway',
    'ca.tchShare': 'Carries the Trans-Canada for {km} km of its length ({pct}%).',
    'ca.tchAll': 'Trans-Canada Highway for its entire length.',
    'ca.lanes': 'Lanes',
    'ca.lanesVal': '{n} on average',
    'ca.speed': 'Posted speed',
    'ca.speedVal': '{n} km/h on average',
    'ca.paved': 'Paved',
    'ca.coverage': 'measured over {pct}% of the route',
    'ca.named': 'Also named',
    'ca.tolls': 'The national road file records toll points as a separate layer and puts no toll attribute on the roadway itself, so no toll share is shown for Canadian routes.',
    'ca.note.derived': 'Length, endpoints, provincial distances, lane counts, posted speeds and pavement status on this page come from Statistics Canada’s National Road Network, surveyed to about 10 m and generalised here for drawing. Designation comes from Transport Canada’s National Highway System.',
    'ca.municipalWhy': 'Canada’s national road file records county and municipal route numbers in the same field as provincial highway numbers, and nothing in it distinguishes the two. Both are here rather than guessed at: Ontario numbers about thirty-five county roads 4, alongside its Highway 4, so a number can return several unrelated roads. Each one is listed with the place that tells it apart.',
    'ca.inv.title': 'The national network, as reported',
    'ca.inv.sub': 'Canada publishes its highway inventory by network tier and province rather than per route, so these are the figures for the network this road belongs to — not for this road.',

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
    // Canada's breaks are as often water as missing data: Highway 1 crosses to
    // Vancouver Island by ferry and Route 138 reaches the Lower North Shore the
    // same way, and calling those a filing error would be wrong.
    'note.gaps.ca': 'The route comes through in {n} piece(s), with {mi} mi unaccounted for between them. Some of that is road filed under another classification in the source; some of it is water, since designated routes cross to Vancouver Island and along the Lower North Shore by ferry. Neither is drawn, and neither is in the length above.',
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
    'tl.play': 'Play',
    'tl.pause': 'Pause',

    'tlx.open': 'Open to traffic',
    'tlx.ofSystem': 'of the designated system',
    'tlx.shown': 'Drawn on the map',
    'tlx.shownOf': 'of {n} dated routes',
    'tlx.why': 'What these two figures mean',
    'tlx.close': 'Leave the buildout view',
    'tlx.note': 'The mileage and the curve are FHWA’s figures for the whole Interstate System, recorded at the end of every year from 1960 to 1997. The map can show less than that: nobody published an opening date for each individual route, so only the {n} routes whose completion year is documented in this atlas appear, out of {total}. The curve is the system; the map is the documented part of it. The gap between them is missing records, not missing road.',
    'tlx.unavailable': 'The buildout data has not been built yet.',
    'tlx.before': 'not reported',
    'tlx.more': '{n} more that year',

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
    'jump.na': 'North America',
    'jump.l48': 'Lower 48',
    'jump.ak': 'Alaska',
    'jump.hi': 'Hawaii',
    'jump.pr': 'Puerto Rico',
    'jump.ca': 'Canada',
    'jump.cawest': 'Western Canada',
    'jump.caeast': 'Eastern Canada',
    'jump.canorth': 'The territories',
    'jump.us.group': 'United States',
    'jump.ca.group': 'Canada',
    'base.dark': 'Dark base map',
    'base.relief': 'Shaded relief',
    'base.satellite': 'Satellite imagery',
    'base.tilt': 'Tilt into 3D',
    'toast.base.dark': 'Dark base map',
    'toast.base.relief': 'Shaded relief — elevation from Mapzen terrain tiles',
    'toast.base.satellite': 'Satellite imagery — Esri, Maxar, Earthstar Geographics',
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
    'app.name': '北美公路图谱',
    'app.tagline': '北美国家公路网',
    'boot.title': '北美公路图谱',
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
    'sys.country.us': '美国',
    'sys.country.ca': '加拿大',
    'sys.interstate': '州际公路',
    'sys.us': '美国国道',
    'sys.state': '州级公路',
    'sys.tch': '横加公路',
    'sys.nhs': '国家公路系统',
    'sys.provincial': '省级及地方编号公路',
    'sys.interstate.meta': '全立体交叉高速公路网',
    'sys.us.meta': '1956 年之前的国家路网',
    'sys.state.meta': '按州加载',
    'sys.tch.meta': '同一条路，每个省一个编号',
    'sys.nhs.meta': '联邦与各省共同划定的国家路网',
    'sys.provincial.meta': '收录全部编号路线，按省加载',
    'sys.routes': '{n} 条',
    'sys.miles': '{n} 英里',
    'sub.state': '1 个州',
    'sub.states': '{n} 个州',
    'sys.pickState': '选择州',
    'sys.allStates': '全部州',
    'sys.pickProvince': '选择省份',

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
    'dt.provinces': '途经省份',
    'dt.unsigned': '无标牌编号',
    'dt.unsignedWhy': '这几条路在联邦层面被正式列入州际公路系统，但沿线不设任何州际公路盾形标志，任何公路地图上也查不到它们的编号。阿拉斯加人只用路名称呼它们。',

    // Canada
    'ca.nhs': '国家公路系统',
    'ca.nhs.core': '核心线路',
    'ca.nhs.feeder': '集散线路',
    'ca.nhs.northern': '北部与偏远线路',
    'ca.nhs.none': '未列入',
    'ca.nhs.coreWhy': '连接省际或跨国的关键干线走廊。',
    'ca.nhs.feederWhy': '把其他人口或经济中心接入核心路网的联络线。',
    'ca.nhs.northernWhy': '通往北部地区、社区与资源产地的主要通道。',
    'ca.tch': '横加公路',
    'ca.tchShare': '全线中有 {km} 公里承担横加公路（占 {pct}%）。',
    'ca.tchAll': '全线均为横加公路。',
    'ca.lanes': '车道数',
    'ca.lanesVal': '平均 {n} 条',
    'ca.speed': '限速',
    'ca.speedVal': '平均 {n} 公里/小时',
    'ca.paved': '铺装路面',
    'ca.coverage': '基于全线 {pct}% 的路段量得',
    'ca.named': '别名',
    'ca.tolls': '加拿大国家道路网数据把收费站单独作为一个图层，路段本身不带收费属性，因此加拿大路线不显示收费里程占比。',
    'ca.note.derived': '本页的长度、起止点、各省里程、车道数、限速与铺装状况，均来自加拿大统计局《国家道路网》（测绘精度约 10 米，本站为绘图做了简化）。路线等级来自加拿大交通部《国家公路系统》。',
    'ca.municipalWhy': '加拿大国家道路网数据把县道、市镇道路的编号与省级公路编号记在同一字段，数据本身无法区分两者。本站两类都收录，而不作猜测：安大略省约有三十五条县道编号为 4，与该省 4 号公路并存，因此同一个编号可能对应多条互不相干的道路。列表中会用地名加以区分。',
    'ca.inv.title': '国家路网的公开统计',
    'ca.inv.sub': '加拿大的公路统计是按路网等级和省份发布的，而非逐条公路发布。因此以下数字描述的是这条路所属的那一层路网，而不是这条路本身。',

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
    'note.gaps.ca': '本路线由 {n} 段构成，段与段之间另有约 {mi} 英里无法计入。其中一部分是在原始数据中被归入其他分类的路段，另一部分则是水域——获得指定的路线要靠渡轮前往温哥华岛，以及沿下北岸通行。两者都不绘制，也都不计入上方的长度。',
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
    'tl.play': '播放',
    'tl.pause': '暂停',

    'tlx.open': '已通车里程',
    'tlx.ofSystem': '占规划系统',
    'tlx.shown': '地图已绘出',
    'tlx.shownOf': '共 {n} 条有年份记载',
    'tlx.why': '这两个数字的区别',
    'tlx.close': '退出建成过程视图',
    'tlx.note': '里程与曲线取自联邦公路管理局对整个州际公路系统的统计，1960 至 1997 年逐年记录。地图能显示的少于此数：逐条公路的通车日期从未公开发布，因此只有本站收录了确切建成年份的 {n} 条路线会出现，而系统共有 {total} 条。曲线代表整个系统，地图只代表其中有据可查的部分。两者之差是记载的缺失，不是公路的缺失。',
    'tlx.unavailable': '建成过程数据尚未生成。',
    'tlx.before': '未公布',
    'tlx.more': '该年另有 {n} 条记载',

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
    'jump.na': '北美全域',
    'jump.l48': '本土四十八州',
    'jump.ak': '阿拉斯加',
    'jump.hi': '夏威夷',
    'jump.pr': '波多黎各',
    'jump.ca': '加拿大',
    'jump.cawest': '加拿大西部',
    'jump.caeast': '加拿大东部',
    'jump.canorth': '北部三地区',
    'jump.us.group': '美国',
    'jump.ca.group': '加拿大',
    'base.dark': '深色底图',
    'base.relief': '地形晕渲',
    'base.satellite': '卫星影像',
    'base.tilt': '倾斜为三维视角',
    'toast.base.dark': '深色底图',
    'toast.base.relief': '地形晕渲——高程数据来自 Mapzen 地形瓦片',
    'toast.base.satellite': '卫星影像——来自 Esri、Maxar、Earthstar Geographics',
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

// Canadian provinces and territories. Kept separate from the states so the
// interface can tell which country a jurisdiction belongs to from its code
// alone, which is how the panel groups itself and how the right shield gets
// drawn. No province code collides with a state code.
export const PROVINCE_LABEL = {
  BC: ['British Columbia', '不列颠哥伦比亚'], AB: ['Alberta', '艾伯塔'],
  SK: ['Saskatchewan', '萨斯喀彻温'], MB: ['Manitoba', '马尼托巴'],
  ON: ['Ontario', '安大略'], QC: ['Quebec', '魁北克'],
  NB: ['New Brunswick', '新不伦瑞克'], NS: ['Nova Scotia', '新斯科舍'],
  PE: ['Prince Edward Island', '爱德华王子岛'],
  NL: ['Newfoundland and Labrador', '纽芬兰与拉布拉多'],
  YT: ['Yukon', '育空'], NT: ['Northwest Territories', '西北地区'],
  NU: ['Nunavut', '努纳武特'],
};

export function isProvince(code) { return Object.hasOwn(PROVINCE_LABEL, code); }

/**
 * Both names for a jurisdiction, for the search haystack.
 *
 * The haystack is built once when the index loads, so it cannot depend on the
 * current language or switching languages would break search. Carrying both
 * names costs nothing and means "ontario" and "安大略" both work either way.
 */
export function jurisdictionNames(code) {
  const pair = STATE_LABEL[code] || PROVINCE_LABEL[code];
  return pair ? `${pair[0]} ${pair[1]}` : code;
}

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

/** The name of a state, province or territory, in the current language. */
export function stateName(code) {
  const pair = STATE_LABEL[code] || PROVINCE_LABEL[code];
  if (!pair) return code;
  return lang === 'zh' ? pair[1] : pair[0];
}

/**
 * What to call the body a route belongs to.
 *
 * For the two numbered-by-jurisdiction tiers the useful name is the state or
 * province, because "State Routes" says nothing about which one. For the
 * national systems it is the system itself. This is the line under every
 * search result, palette hit and table row, so it lives in one place.
 */
/**
 * What to name a route by, beside its number.
 *
 * Per-jurisdiction systems obviously want their jurisdiction. So do Canada's
 * two national tiers, which is less obvious: the Trans-Canada is a designation
 * carried by provincial highways and it changes number at nearly every border,
 * so five separate roads are all signed "TCH 1" and only the province tells
 * them apart. An American national route needs none of this, because its
 * number is unique and its name already says which system it belongs to.
 */
export function ownerLabel(sys, code) {
  if (sys === 'state' || sys === 'provincial' || isProvince(code)) return stateName(code);
  return t(`sys.${sys}`);
}

// Chinese keeps the mile as the unit of record because every published US
// highway figure is in miles; the kilometre equivalent rides alongside.
export function miles(n) {
  if (n == null) return '—';
  const s = Math.round(n).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US');
  return lang === 'zh' ? `${s} 英里` : `${s} mi`;
}

/**
 * A route's display label.
 *
 * Labels are built once, at build time, and are almost language-independent:
 * "I-95", "US 66", "ON 401" and "A-20" read the same either way, because the
 * number and the jurisdiction code are what is on the sign. The Trans-Canada
 * is the exception - it is a name rather than a code - so it translates.
 */
export function routeLabel(label) {
  if (lang === 'zh' && label?.startsWith('TCH ')) return `横加公路 ${label.slice(4)}`;
  return label ?? '';
}

export function num(n, digits = 0) {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}
