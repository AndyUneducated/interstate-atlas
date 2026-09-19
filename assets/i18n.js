/* Interface strings. Route dossiers carry their own bilingual prose in
   data/dossiers/; this file covers the chrome only.

   Placeholders look like {n} and are filled positionally by t(). */

export const STRINGS = {
  en: {
    'app.name': 'HIGHWAY ATLAS',
    'app.tagline': 'the highway network of North America',
    'app.taglineShort': 'North America',
    'boot.title': 'HIGHWAY ATLAS',
    'boot.sub': 'assembling the road network',
    'boot.step.index': 'reading route index',
    'boot.step.geo': 'loading interstate geometry',
    'boot.step.map': 'initialising map surface',
    'boot.step.ready': 'ready',

    // Not "Search": the sidebar has a search field, and two controls with the
    // same name doing different things is worse than an unfamiliar word. This
    // one reaches routes, views and jurisdictions alike.
    'nav.search': 'Jump to',
    'nav.numbering': 'Numbering',
    'nav.dashboard': 'Statistics',
    'nav.timeline': 'Timeline',
    'nav.planner': 'Trip',
    'nav.terrain': '3D terrain',
    'nav.lang': '中文',
    'nav.langTitle': 'Switch to Chinese',
    'nav.panel': 'Toggle panel',
    'nav.findRoute': 'Find a route',
    'nav.about': 'About',
    'nav.langTitle': 'Switch language',

    'sys.title': 'Route systems',
    'legend.title': 'On the map',
    'nav.zen': 'Hide the interface — Z',
    'nav.zenOut': 'Show the interface',
    'toast.zen': 'Interface hidden — press Z or Escape to bring it back',
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
    // Twenty-two separate Ontario roads carry the number 21.
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
    'search.colMi': 'Miles',
    'search.sortLong': 'Longest first',
    'search.sortLongWhy': 'With nothing typed, the list is every route in the systems you have switched on, longest first. Searching looks through all of them, switched on or not.',
    'search.sortMatch': 'Closest match first',
    'search.sortMatchWhy': 'An exact number comes first, then mainline routes ahead of their branches, then longer roads ahead of shorter ones.',

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
    'ca.speed': 'Posted speed',
    'ca.speedAvg': 'Averaged along the route by length, so it can fall between signed limits.',
    'ca.paved': 'Paved',
    'ca.coverage': 'measured over {pct}% of the route',
    'ca.tr.title': 'What the province measures',
    'ca.tr.sub': 'Counted by the province, {year}, {how}.',
    'ca.tr.weighted': 'averaged along the route by length',
    'ca.tr.stations': 'averaged across {n} count stations',
    'ca.tr.trucksVal': '{pct}% heavy vehicles',
    'ca.tr.speed': 'Speed',
    'ca.tr.speedWhy': '85th percentile — the speed most traffic is at or below, not the posted limit.',
    'ca.tr.note.ON': 'Where two Ontario highways share pavement, the ministry credits the volume to the lower-numbered one, or to the freeway where a freeway and a non-freeway meet. Highway 407 is absent from its figures: the tolled section runs under concession, and its operator reports average workday trips, which is not a daily volume.',
    'ca.tr.note.NS': 'Nova Scotia counts one direction at a time. Opposite directions are added here, each from the most recent time it was counted, to give a two-way volume comparable with the other provinces.',
    'ca.named': 'Also named',
    'ca.tolls': 'The national road file records toll points as a separate layer and puts no toll attribute on the roadway itself, so no toll share is shown for Canadian routes.',
    'ca.note.derived': 'Length, endpoints, provincial distances, lane counts, posted speeds and pavement status on this page come from Statistics Canada’s National Road Network, surveyed to about 10 m and generalised here for drawing. Designation comes from Transport Canada’s National Highway System.',
    'ca.municipalWhy': 'Canada’s national road file records county and municipal route numbers in the same field as provincial highway numbers, and nothing in it distinguishes the two. Both are here rather than guessed at: twenty-two separate Ontario roads are numbered 21, so a number can return several unrelated roads. Each one is listed with the place that tells it apart.',
    'ca.inv.title': 'The national network, as reported',
    'ca.inv.sub': 'Canada publishes its highway inventory by network tier and province rather than per route, so these are the figures for the network this road belongs to — not for this road.',
    'ca.inv.tier': '{tier} routes, as at the end of {asOf}.',
    'ca.inv.national': 'Canada',

    // What the states report to FHWA each year about every mile of the
    // federal-aid network. Unlike everything else on this page, these were
    // collected by driving the road rather than by drawing it.
    'hp.title': 'What the states measure',
    'hp.sub': 'Reported to FHWA for {year}, averaged along the route by length.',
    'hp.traffic': 'Traffic',
    'hp.trafficVal': '{n} vehicles a day',
    'hp.peak': 'busiest point {n} a day',
    'hp.trucks': 'Heavy trucks',
    'hp.trucksVal': '{n} a day, {pct}% of traffic',
    'hp.pavement': 'Pavement',
    'hp.iriVal': '{n} in/mi roughness',
    'hp.good': 'good',
    'hp.fair': 'fair',
    'hp.poor': 'poor',
    'hp.iriWhy': 'FHWA rates a road good below 95 in/mi and poor above 170.',
    'hp.wear': 'Wear',
    'hp.wearVal': '{rut} in rutting, {crack}% cracked',
    'hp.improved': 'Last improved',
    'hp.improvedVal': 'somewhere along the route in {n}',
    'hp.lanes': 'Lanes',
    'hp.speed': 'Speed limit',
    'hp.future': 'Projected',
    'hp.futureVal': '{n} a day at the busiest point',
    'hp.covWhy': 'A percentage beside a figure is the share of the route it was measured over.',
    'hp.partial': 'The states reported on {pct}% of this route’s length.',
    'hp.note': 'These are the states’ own measurements, reported to the Federal Highway Administration under the Highway Performance Monitoring System and averaged here along the route by length. Pavement condition is collected on the National Highway System and less consistently elsewhere, so each figure says what share of the road it was measured over. Nothing is filled in where a state reported nothing.',

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
    // Captions for the headline figure. Short, because they sit under a very
    // large number; the section further down gives both lengths and the gap.
    'len.heroOfficial': 'official length',
    'len.heroTiger': 'measured off the Census centreline',
    'len.heroNrn': 'measured off the national road network',
    'len.measuredSrc': 'End-to-end along the mapped centreline, counting each carriageway once',
    'len.delta': 'Difference',
    // The usual reason the two disagree is a rule, not an error, and saying so
    // is the difference between a figure a reader can use and one they distrust.
    'len.deltaWhy': 'Where two Interstates run on the same pavement, the official register credits those miles to one of them; measuring end to end counts them for both. Smaller differences are survey detail. The register also has known slips of its own.',

    'comp.Freeway': 'Freeway',
    'comp.Tollway': 'Tollway',
    'comp.Primary': 'Primary',
    'comp.Secondary': 'Secondary',
    'comp.Other Paved': 'Other paved',
    'comp.Unpaved': 'Unpaved',
    'comp.Ferry': 'Ferry',
    'comp.Trail': 'Trail',
    'comp.Paved': 'Paved',
    'comp.Local': 'Local road',
    'comp.Ramp': 'Ramp',
    'comp.Winter': 'Winter road',
    'comp.Unknown': 'Unclassified',

    'note.derived': 'Length, endpoints, state mileage and roadway class on this page are measured here from US Census TIGER/Line road geometry, surveyed and generalised for drawing. A divided highway is counted once, not once per carriageway.',
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
    'dash.freeway': 'Grade-separated miles',
    'dash.bySystem': 'By system',
    'dash.byState': 'By state',
    'dash.byClass': 'By roadway class',
    // The class is the source file's own, and the two road files do not
    // classify alike: the American one has no freeway class at all, so
    // American freeway mileage sits under Primary. Saying so is better than
    // showing a Freeway bar that looks like the whole continent has 4,000
    // miles of it.
    'dash.byClass.note': 'As classified by each road file. The American file has no freeway class, so US freeway mileage appears under Primary; grade separation is measured separately, above.',
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
    'tlx.note': 'The mileage and the curve are FHWA’s figures for the whole Interstate System, recorded at the end of every year from 1960 to 1997. The map can show less than that: nobody published an opening date for each individual route, so only the {n} routes whose completion year is documented in this atlas appear, out of {total}. The curve is the system; the map is the documented part of it. The gap between them is missing records, not missing road. The faint lines underneath are the network as it stands today, drawn so that a route lighting up can be placed on the continent — not a claim about what was open in the year on the playhead.',
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
    'unit.mph': 'mph',
  },

  zh: {
    'app.name': '北美公路图谱',
    'app.tagline': '北美国家公路网',
    'app.taglineShort': '北美公路网',
    'boot.title': '北美公路图谱',
    'boot.sub': '正在装配公路网',
    'boot.step.index': '读取路线索引',
    'boot.step.geo': '加载州际公路几何数据',
    'boot.step.map': '初始化地图',
    'boot.step.ready': '就绪',

    'nav.search': '快速跳转',
    'nav.numbering': '编号规则',
    'nav.dashboard': '统计',
    'nav.timeline': '建设时间轴',
    'nav.planner': '行程',
    'nav.terrain': '三维地形',
    'nav.lang': 'EN',
    'nav.langTitle': '切换到英文',
    'nav.panel': '收起面板',
    'nav.findRoute': '查找公路',
    'nav.about': '关于',
    'nav.langTitle': '切换语言',

    'sys.title': '路网系统',
    'legend.title': '当前图层',
    'nav.zen': '隐藏界面 — Z',
    'nav.zenOut': '显示界面',
    'toast.zen': '界面已隐藏 — 按 Z 或 Esc 键恢复',
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
    'search.colMi': '英里',
    'search.sortLong': '按里程由长到短',
    'search.sortLongWhy': '未输入内容时，列表显示已开启的路网系统中的全部路线，按里程由长到短排列。搜索则会检索所有路线，无论其所属系统是否开启。',
    'search.sortMatch': '按匹配度排序',
    'search.sortMatchWhy': '编号完全匹配的排在最前，其次是主线路线（优先于其支线），再次按里程由长到短。',

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
    'ca.speed': '限速',
    'ca.speedAvg': '按里程沿全线加权平均，因此可能落在实际限速值之间。',
    'ca.paved': '铺装路面',
    'ca.coverage': '基于全线 {pct}% 的路段量得',
    'ca.tr.title': '本省实测数据',
    'ca.tr.sub': '由本省采集，{year}，{how}。',
    'ca.tr.weighted': '按里程沿全线加权平均',
    'ca.tr.stations': '按 {n} 个观测点平均',
    'ca.tr.trucksVal': '重型车辆占 {pct}%',
    'ca.tr.speed': '车速',
    'ca.tr.speedWhy': '第 85 百分位车速，即 85% 的车辆行驶速度不超过此值，并非限速值。',
    'ca.tr.note.ON': '两条安大略公路共用同一段路面时，省交通厅只把车流量记在编号较小的那条名下；若高速公路与非高速公路共线，则记在高速公路名下。407 号公路不在其统计之内：收费路段由特许经营公司运营，而运营方公布的是工作日平均行程数，并非日均车流量。',
    'ca.tr.note.NS': '新斯科舍省每次只测一个方向。本站将两个方向各自最近一次的观测值相加，得出可与其他省份对比的双向车流量。',
    'ca.named': '别名',
    'ca.tolls': '加拿大国家道路网数据把收费站单独作为一个图层，路段本身不带收费属性，因此加拿大路线不显示收费里程占比。',
    'ca.note.derived': '本页的长度、起止点、各省里程、车道数、限速与铺装状况，均来自加拿大统计局《国家道路网》（测绘精度约 10 米，本站为绘图做了简化）。路线等级来自加拿大交通部《国家公路系统》。',
    'ca.municipalWhy': '加拿大国家道路网数据把县道、市镇道路的编号与省级公路编号记在同一字段，数据本身无法区分两者。本站两类都收录，而不作猜测：安大略省有二十二条互不相干的道路都编号为 21，因此同一个编号可能对应多条毫无关联的道路。列表中会用地名加以区分。',
    'ca.inv.title': '国家路网的公开统计',
    'ca.inv.sub': '加拿大的公路统计是按路网等级和省份发布的，而非逐条公路发布。因此以下数字描述的是这条路所属的那一层路网，而不是这条路本身。',
    'ca.inv.tier': '统计对象为{tier}，截至 {asOf} 年底。',
    'ca.inv.national': '全国',

    'hp.title': '各州实测数据',
    'hp.sub': '各州上报美国联邦公路管理局的 {year} 年数据，按里程沿全线加权平均。',
    'hp.traffic': '车流量',
    'hp.trafficVal': '日均 {n} 辆',
    'hp.peak': '最繁忙路段日均 {n} 辆',
    'hp.trucks': '重型卡车',
    'hp.trucksVal': '日均 {n} 辆，占车流 {pct}%',
    'hp.pavement': '路面状况',
    'hp.iriVal': '平整度 {n} 英寸/英里',
    'hp.good': '良好',
    'hp.fair': '一般',
    'hp.poor': '较差',
    'hp.iriWhy': '按联邦公路管理局标准，低于 95 为良好，高于 170 为较差。',
    'hp.wear': '损耗',
    'hp.wearVal': '车辙 {rut} 英寸，开裂 {crack}%',
    'hp.improved': '最近一次养护',
    'hp.improvedVal': '全线某处于 {n} 年',
    'hp.lanes': '车道数',
    'hp.speed': '限速',
    'hp.future': '预测车流',
    'hp.futureVal': '最繁忙路段日均 {n} 辆',
    'hp.covWhy': '数值旁的百分比表示该项实测覆盖了全线多少比例。',
    'hp.partial': '各州上报的数据覆盖本线路全长的 {pct}%。',
    'hp.note': '以上是各州自行实测、按《公路性能监测系统》上报给美国联邦公路管理局的数据，本站按里程沿全线加权平均。路面状况在国家公路系统上采集较全，其他道路则不够一致，因此每项数据都注明其覆盖了全线多少比例。凡州方未上报的，本站一律留空。',

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
    'len.heroOfficial': '官方公布里程',
    'len.heroTiger': '基于人口普查局路网中心线量得',
    'len.heroNrn': '基于国家道路网数据量得',
    'len.measuredSrc': '沿地图中心线端到端量算，分向车道只计一次',
    'len.delta': '差值',
    'len.deltaWhy': '两条州际公路共用同一段路面时，官方名录只把这段里程记在其中一条名下，而端到端量算会为两条都计入。较小的差值属于测绘细节。此外，官方名录本身也有已知的疏漏。',

    'comp.Freeway': '高速公路',
    'comp.Tollway': '收费公路',
    'comp.Primary': '主干道',
    'comp.Secondary': '次干道',
    'comp.Other Paved': '其他铺装路面',
    'comp.Unpaved': '未铺装',
    'comp.Ferry': '轮渡',
    'comp.Trail': '土路',
    'comp.Paved': '铺装路面',
    'comp.Local': '地方道路',
    'comp.Ramp': '匝道',
    'comp.Winter': '冬季道路',
    'comp.Unknown': '未分类',

    'note.derived': '本页的长度、起止点、各州里程与路段等级，均由本站依据美国人口普查局 TIGER/Line 道路几何数据实测得出（该数据为实测数据，本站为绘图做了简化）。分向行驶的公路只计一次，不会按每个方向各计一次。',
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
    'dash.freeway': '立体交叉里程',
    'dash.bySystem': '按系统',
    'dash.byState': '按州',
    'dash.byClass': '按路段等级',
    'dash.byClass.note': '等级取自各自的道路数据文件。美国的数据文件没有「高速公路」这一等级，因此美国的高速里程被归入「主干道」；是否立体交叉另行实测，见上方数字。',
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
    'tlx.note': '里程与曲线取自联邦公路管理局对整个州际公路系统的统计，1960 至 1997 年逐年记录。地图能显示的少于此数：逐条公路的通车日期从未公开发布，因此只有本站收录了确切建成年份的 {n} 条路线会出现，而系统共有 {total} 条。曲线代表整个系统，地图只代表其中有据可查的部分。两者之差是记载的缺失，不是公路的缺失。底层的暗色细线是今日路网的全貌，用于给亮起的路线提供地理参照，并不表示该年份已有这些路段通车。',
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
    'unit.mph': '英里/小时',
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
