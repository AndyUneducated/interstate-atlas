# 数据来源与决策

本文件是 [DATA-SOURCES.md](../DATA-SOURCES.md) 第 2 至 6 节的中文版，供网站「数据与来源」页面使用。两份文件逐表逐行对应，`tools/build-docs.mjs` 会检查二者的结构与编号是否一致，英文版为准。

---

## 2. 来源必须满足的标准

| 标准 | 规则 | 不满足时 |
| --- | --- | --- |
| **权威性** | 发布者是拥有、统计或认定这条道路的机构：联邦或省级主管部门、统计机构，或运营方。 | 不采用。商业道路指南和百科全书只用来寻找一手来源，从不作为来源本身。 |
| **可批量机读** | 覆盖整个辖区的文件或查询接口。 | 不采用，并列为来源缺口。交互式地图或逐点位的 PDF 不算。只有小而封闭的集合允许手工整理（加拿大七处收费设施、阿拉斯加四条州际公路、大事记），且每条事实各附来源。 |
| **有日期** | 已知版本、调查年份或截止日期。 | 只有把缺失记为 `null`、绝不猜测时才采用（RNC 没有注明版本年份）。 |
| **许可已知** | 使用条款随数据一并记录。 | 若数据由政府发布，且记录了"未声明许可"这一事实，则可采用（安大略交通量、魁北克高速公路名录、SICT 的 PDF）。 |
| **可按编号关联** | 每个数字都写明它描述的是哪条路线。 | 只能按位置关联的来源，仅用于放置点位（口岸、收费段端点、观测站），并记录距离。 |
| **说明覆盖范围** | 能算出一个数字覆盖了道路的多大比例。 | 不把这个数字当作整条路的数字展示。 |
| **不做推断** | 一个数字只用来回答它本来回答的问题。 | 拒绝：桥梁建成年份不能给道路定年；特许经营授予日期不是通车日期；运营方的出行次数不是日交通量。 |

---

## 3. 来源登记

**可复现**指重新运行抓取脚本能否得到 `data/` 中现有的数据。

### 美国

| 编号 | 来源 | 用途 | 版本 · 获取日期 | 许可 | 抓取脚本 → 存放位置 | 可复现 |
| --- | --- | --- | --- | --- | --- | --- |
| US-1 | [人口普查局 TIGER/Line](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html) 主要与次要道路，52 个文件 | 路线几何与编号 | 2025（`TIGER_YEAR`）· 首次构建时 | 公有领域 | 构建时由 `tiger.mjs` 读取 → `tools/src/tiger/` | 是，年份固定 |
| US-2 | [人口普查局地名库](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html) 地点 | 为美国路线起止点命名 | 2023 | 公有领域 | `fetch-source.mjs` → `tools/src/` | 是 |
| US-3 | [FHWA 路线名录与查找表](https://www.fhwa.dot.gov/planning/national_highway_system/interstate_highway_system/routefinder/)，表 1 和表 2 | 各州州际公路官方里程、途经城区 | 2026 年 1 月 · 2026-09-15 | 美国政府作品 | `fetch-fhwa.mjs` → `fhwa-mileage.json` | 否，页面原地更新 |
| US-4 | [FHWA《各州际公路估算造价》](https://www.fhwa.dot.gov/highwayhistory/data/page03.cfm) | 每条路线的官方造价 | 1991 年州际公路造价估算 · 2026-09-15 | 美国政府作品 | `fetch-fhwa.mjs` → `fhwa-cost.json` | 是，历史数据 |
| US-5 | [FHWA《州际公路建设进度》](https://www.fhwa.dot.gov/highwayhistory/data/page06.cfm) | 1960–1997 年建成里程曲线 | 截至 1997 年 | 美国政府作品 | 手工 → `interstate-mileage.json` | 是，历史数据 |
| US-6 | [FHWA HPMS](https://data.transportation.gov/Roadways-and-Bridges/HPMS-Spatial-All-Sections-2024/42um-tgh5)《全部路段空间数据》，查询接口 | 交通量、货车、平整度、车辙、裂缝、车道、限速、收费、最近改善年份 | 2024（`HPMS_YEAR`）· 2026-09-16 | 美国政府作品 | `fetch-hpms.mjs` → `hpms.json` | 是，年份固定 |
| US-7 | 阿拉斯加交通与公共设施部《州际公路系统第 106 条豁免路线清单》及 FHWA | 认定阿拉斯加的 A-1 至 A-4 | 以文件中引注为准 | 公开 | 手工 → `alaska-interstates.json` | 是 |
| US-8 | FHWA 历史资料、第 101-427 号公法、AASHTO、各州交通部门 | 系统层面的大事记 | 以每条事件的引注为准 | 公开 | 手工 → `milestones.json` | 是 |
| US-10 | TIGER 道路名（US-1）对照 FHWA 路线名录（US-3） | TIGER 只记名称的高速公路中，哪些是挂牌路线（Natcher Parkway 即 I-165），哪些拼写指同一条路 | TIGER 2025，路线名录 2026 年 1 月 · 2026-10-10 | 公有领域 | 手工 → `us-named-freeways.json` | 是，每个别名都有引注 |
| US-9 | [BTS《过境入境数据》](https://data.bts.gov/Research-and-Statistics/Border-Crossing-Entry-Data/keg4-3bc2) | 核对加拿大口岸的定位 | 2026-10-04 | 公有领域 | `fetch-border-crossings.mjs`，仅用于核对 | 否 |

### 加拿大

| 编号 | 来源 | 用途 | 版本 · 获取日期 | 许可 | 抓取脚本 → 存放位置 | 可复现 |
| --- | --- | --- | --- | --- | --- | --- |
| CA-1 | [加拿大统计局国家道路网](https://www.statcan.gc.ca/en/lode/databases/odr)，13 个辖区 | 路线几何、编号、路线端点地名 | 各省不同，如 ON 18.0、QC 10.0、MB 6.0 · 2026-09-15 | 加拿大政府开放许可 | `fetch-canada.mjs` → `tools/src/ca/` | 否，网址无版本号；`tools/src/ca/editions.json` 记录版本 |
| CA-2 | 加拿大交通部国家公路系统地图服务 | NHS 等级认定（核心、支线、北部与偏远） | 2026-09-15 | 加拿大政府开放许可 | `fetch-canada-nhs.mjs` → `canada-nhs.json` | 否 |
| CA-3 | [交通部长理事会《NHS 2017 年度报告》](https://comt.ca/Reports/NHS%20Annual%202017.pdf) | NHS 路网里程与路况 | 截至 2017-12-31 | 公开 | `fetch-canada-nhs.mjs` → `canada-nhs.json` | 是 |
| CA-4 | [魁北克交通部《交通流量》](https://www.donneesquebec.ca/recherche/dataset/debit-de-circulation) | 年平均日交通量、重型车占比、季节、十年数据 | 每日更新的 WFS · 2026-09-22 | CC BY 4.0 | `fetch-canada-traffic.mjs` → `ca-traffic.json` | 否，每日更新 |
| CA-5 | [安大略交通部《省道交通量》](https://www.library.mto.gov.on.ca/SydneyPLUS/TechPubs/Portal/tp/tvSplash.aspx) | 年平均日交通量 | 2024 · 2026-09-22 | 未声明 | 同上 | 是，按版本 |
| CA-6 | [艾伯塔《路网各路段交通量》](https://open.alberta.ca/opendata/traffic-volumes-on-links-in-the-highway-network) | 加权年平均日交通量、商用车占比 | 2025 · 2026-09-22 | 艾伯塔开放许可 | 同上 | 是，按版本 |
| CA-7 | [新斯科舍《省道系统交通量》](https://data.novascotia.ca/Roads-Driving-and-Transport/Traffic-Volumes-Provincial-Highway-System/8524-ec3n) | 年平均日交通量、货车占比、85 百分位车速 | 2005–2025 · 2026-09-22 | 新斯科舍开放许可 | 同上 | 否 |
| CA-8 | [新不伦瑞克《点位年平均日交通量》](https://gnb.socrata.com/datasets/gdx2-xdus) | 年平均日交通量 | 2023 · 2026-09-22 | 新不伦瑞克开放许可 | 同上 | 是，按版本 |
| CA-9 | [爱德华王子岛《交通量》](https://www.princeedwardisland.ca/en/service/view-pei-traffic-volumes) | 年平均日交通量 | 2015–2018 · 2026-09-22 | 爱德华王子岛开放许可 | 同上 | 是 |
| CA-10 | [西北地区统计局《西北地区公路估算交通量》](https://www.statsnwt.ca/Transportation/) | 估算的年平均日交通量 | 2011–2024 · 2026-09-22 | 西北地区开放许可 | 同上 | 是，按版本 |
| CA-11 | [魁北克交通部《魁北克高速公路名录》](https://www.transports.gouv.qc.ca/fr/projets-infrastructures/info-reseau-routier/repertoire-autoroutes/Pages/repertoire-des-autoroutes.aspx) | 每段高速公路的通车年份 | 2026-09-20 | 未声明；© 魁北克政府 | `fetch-quebec-autoroutes.mjs` → `qc-autoroutes.json` | 否 |
| CA-12 | 《加拿大年鉴》，1951–1968 年及 1973 年 | 横加公路大事记 | 以每条事件的引注为准 | 加拿大统计局 | 手工 → `milestones.json` | 是，历史数据 |
| CA-13 | [加拿大边境服务局《办事处名录》](https://open.canada.ca/data/en/dataset/1018c301-d359-4077-8d9b-4e9fbe6a223f) | 加美口岸：提供公路或公路/大巴服务的 116 个办事处 | 2026-10-04 | 加拿大政府开放许可 | `fetch-border-crossings.mjs` → `border-crossings.json` | 否 |
| CA-14 | [加拿大自然资源部地理定位服务](https://geogratis.gc.ca/services/geolocation/en/locate) | 按地址定位边境服务局办事处和收费段端点 | 2026-10-04 | 加拿大政府开放许可 | 同上，缓存于 `tools/src/borders/` | 否 |
| CA-15 | 运营方、法规与联邦简报（407 ETR、IPC PO-1976 号令、加拿大交通部、议会预算官、104 号公路西线公司及其法规、各桥梁管理机构、密歇根交通部、联邦桥梁公司） | 七处收费设施的条款及注明日期的费率 | 每条事实在文件中注明日期 · 2026-10-04 | 以各发布者声明为准 | 手工 → `tolls-ca.json` | 是，每条事实都有引注 |
| CA-16 | [安大略交通部《桥梁状况》](https://data.ontario.ca/dataset/bridge-conditions) | 5,053 座附建成年份的结构物，绘于桥梁图层 | 2026-09-22 | 安大略开放许可 | `fetch-bridges.mjs` → `bridges.json` → `build-bridges.mjs` | 是，按版本 |
| CA-17 | [维基百科《横加公路》](https://en.wikipedia.org/wiki/Trans-Canada_Highway)，以及加拿大交通部[《横加公路背景介绍》](https://tc.canada.ca/en/corporate-services/policies/trans-canada-highway-backgrounder) | 哪些公路承载横加公路，以及 NRN 未命名处的起止立交（D-52） | 2026-10-11 | CC BY-SA 4.0；加拿大政府开放许可 | 手工 → `tch-routes.json` | 是，逐条列出 |

### 墨西哥

| 编号 | 来源 | 用途 | 版本 · 获取日期 | 许可 | 抓取脚本 → 存放位置 | 可复现 |
| --- | --- | --- | --- | --- | --- | --- |
| MX-1 | [INEGI / SICT / IMT《国家道路网》](https://www.inegi.org.mx/programas/rnc/)，`red_vial` | 几何、CODIGO 编号、管理机构、收费标记、车道、路面、是否分隔 | 未注明版本；2026-03-19 更新 · 2026-09-22 | INEGI 自由使用条款 | `fetch-mexico.mjs` → `tools/src/mx/` | 否，每年 12 月替换；`tools/src/mx/edition.json` 记录版本 |
| MX-2 | 同上，`plaza_cobro` | 1,376 个收费站，绘于收费图层 | 同上 | 同上 | 同上，由 `build-tolls.mjs` 读取 | 同上 |
| MX-3 | [SICT《道路数据》](https://www.datos.gob.mx/dataset/datos_viales)，调查数据与 2013–2024 年面板 | 12,263 个观测站的年平均日交通量与车型构成：2024 年，2024 版被截断的十二个州用 2023 年（D-40） | 最新 2024；门户 2026-04-16 更新 · 2026-10-10 | 墨西哥自由使用条款 | `fetch-mexico-traffic.mjs` → `mx-traffic.json` | 否 |
| MX-4 | [SICT《道路数据 2025》](https://micrs.sct.gob.mx/index.php/infraestructura/direccion-general-de-servicios-tecnicos/datos-viales/2025)，32 份分州 PDF 索引 | SICT 列出了哪些道路、它们的编号与名称 | 2025 · 2026-09-28 | PDF 上未声明 | `fetch-mexico-designations.mjs` → `mx-designations.json`（PDF 存于 `tools/src/mx/dv/`） | 是，按版本 |
| MX-5 | [SICT《特许经营权证书》](https://micrs.sct.gob.mx/infraestructura/direccion-general-de-desarrollo-carretero/titulos-de-concesion/) | 75 份联邦特许经营权证书 | 2026-10-05 | 未声明 | `fetch-mx-concessions.mjs` → `mx-concessions.json` | 否 |
| MX-6 | [INDAABIN《边境口岸》](https://www.datos.gob.mx/dataset/puertos_fronterizos_centros_atencion_transito_fronterizo) | 墨西哥南北边境口岸及坐标 | 2025 年清单 · 2026-10-04 | CC BY 4.0 | `fetch-border-crossings.mjs` → `border-crossings.json` | 否；较新的季度清单不含坐标 |
| MX-7 | [SICT《联邦免费公路网桥梁》](https://datos.gob.mx/dataset/puentes-de-la-red-federal-de-carreteras-libres-de-peaje) | 9,818 座附建成年份的联邦桥梁，绘于桥梁图层 | 2026-09-22 | 墨西哥自由使用条款 | `fetch-bridges.mjs` → `bridges.json` → `build-bridges.mjs` | 是 |

### 三国共用

| 编号 | 来源 | 用途 | 版本 · 获取日期 | 许可 | 抓取脚本 → 存放位置 | 可复现 |
| --- | --- | --- | --- | --- | --- | --- |
| X-1 | [Natural Earth](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/) 一级行政区，1:10m | 联邦路段位于墨西哥哪个州；到美国边境的距离 | 2026-09-22 | 公有领域 | 首次使用时由 `mx-states.mjs`、`border.mjs` 读取 → `tools/src/ne/` | 是 |
| X-2 | [AWS 地形瓦片](https://registry.opendata.aws/terrain-tiles/)，Terrarium，9 级 | 高程剖面 | 缓存于 `tools/cache/` | 开放数据 | `build-elevation.mjs` | 是 |
| X-3 | OpenFreeMap、AWS 地形瓦片、Esri World Imagery | 仅运行时的底图，不含本站自己的数据 | 实时 | 以各服务为准 | 浏览器 | — |

---

## 4. 各国覆盖情况

数据粒度参差不齐，因为来源本身如此。表中某格为空，表示没有发布者以符合[第 2 节](#2-what-a-source-must-meet)的形式发布该数据，除非注明*待做*。

| 数据类型 | 美国 | 加拿大 | 墨西哥 |
| --- | --- | --- | --- |
| 几何 | 逐州，TIGER 2025，全部同一年份 | 逐省，各省 NRN 版本不同 | 一个全国文件，RNC |
| 路线编号 | 全部挂牌系统 | NRN 中的全部编号，市县与省级不加区分 | 只有有编号的道路：SICT 统计的 711 条州道中有 265 条有编号 |
| 路线端点 | 人口普查局地名 | NRN 道路两侧的地名 | SICT 路段（tramo），无地名库 |
| 官方长度 | 仅州际公路，FHWA 名录 | NHS 路网总里程，不分路线 | 无 |
| 交通量 | HPMS 路段，按长度加权到路线，2024；田纳西未匹配 | 13 个辖区中的 7 个，年份从 2015–2018（爱德华王子岛）到 2025（艾伯塔），长度加权并附最繁忙点 | 观测站的中位数、最低与最高值；不取平均；2024，十二个州为 2023 |
| 路况、车道、限速 | HPMS，附覆盖比例 | NRN 的车道数与铺装比例 | RNC 的车道、路面、是否分隔；无限速 |
| 收费比例 | HPMS 收费标记 | 路面上无此属性；绘出 7 处设施 | RNC 逐段标记；绘出 1,376 个收费站；75 份特许经营权证书，关联 41 份 |
| 通车年份 | 有文献年份的州际公路（71 条），1960–1997 年建成曲线 | 魁北克高速公路逐段年份；《年鉴》中的横加公路事件 | 无 |
| 造价 | 州际公路，FHWA 1991 年估算 | 仅见于路线说明，限已公开者 | 无 |
| 附建成年份的桥梁 | 未读取（尚未读取 NBI） | 仅安大略，省道结构物与涵洞 | 联邦免费路网；不含收费路网 |
| 边境口岸 | 美方数据仅用于核对（BTS） | 116 个边境服务局公路办事处，经地理编码 | 北部 45 个及南部口岸，INDAABIN 坐标 |
| 路线说明 | 155 | 17 | 无 |
| 高程剖面 | 每条有路线说明的路线 | 每条有路线说明的路线 | 无，因为没有路线说明 |

### 登记数与已绘制数

各国自己的登记列出多少条路线、本站画了其中多少，以及其余每一条为什么缺。一条路线在它经过的每个州或省各计一次，因为所有登记都是这样记的：FHWA 在 I-95 经过的十五个州里各记它一次。「已绘制」指本站在该处有这个编号的路线。如果按另一个编号画出，原因里会写明，并计为缺失；墨西哥州道例外，因为 D-26 规定其编号以 INEGI 为准。

由 `tools/coverage-figures.mjs` 根据构建结果、两份交叉核对（`npm run check:us`、`npm run check:mx`）以及 `content/reference/coverage-gaps.json` 中手工确认的原因生成。`npm test` 会重写它，遇到没有原因的缺失就报错。

<!-- auto:coverage -->
<!-- /auto:coverage -->

---

## 5. 决策记录

每条决策写明决定了什么、为什么，以及否决了什么。**执行位置**指出维持这条规则的代码，修改决策就意味着修改这些代码。

### 适用于所有来源的规则

| 编号 | 决策 | 理由与被否决的方案 | 执行位置 |
| --- | --- | --- | --- |
| D-1 | 每个数字都属于实测、上报或公布三类之一，三者从不混用，也不互相填补。 | 混合值无法与任何一个来源核对。 | `build-data.mjs`、`build-content.mjs`、`detail.js` |
| D-2 | 上报数据按编号关联到路线，从不按位置。 | 空间关联会让错误的几何悄悄拿到正确的统计数。 | `build-data.mjs` 中的 `attachHpms`、`attachCanadianTraffic` |
| D-3 | 只覆盖部分路段的数字要注明覆盖比例。 | 把五分之一路段的测量值当作整条路的数字展示，等于捏造。 | 每项 HPMS 与省级指标上的 `cover` 字段 |
| D-4 | 来源没有说的，本站也不说：不填零，不估算。 | 零会被读成一次测量。 | `null` 一直保留到详情面板 |
| D-5 | 路线长度只量一次，沿着实际行驶的路径。 | 把每条中心线都加起来，401 号公路会量成 1,819 公里，实际为 828。 | `geo.mjs` 中的 `stitchRoute`、`drivenEdgeKm` |
| D-6 | 公布的数字必须附来源，或说明为何没有来源，中英文都要有。 | 没有来源的文字无法更正。 | `build-content.mjs` 让构建失败 |
| D-7 | 路线说明按系统、编号来指认道路，编号重复时再加一个锚点；从不使用构建分配的 id。 | 美国几何换来源时构建 id 发生变化，26 篇路线说明悄无声息地不再显示。 | `build-content.mjs` 中的 `resolve`；`build-elevation.mjs` 读取已发布的 id |
| D-8 | 路线说明里「无公开造价」的说法，在 FHWA 路线造价表有数字时被删除，并报告出来。 | 否则页面会把两者并排印出来。 | `build-content.mjs` |
| D-9 | README 中的数字由构建结果写入。 | 手打的数字会和它描述的数据渐渐脱节。 | `readme-figures.mjs`，由 `npm test` 运行 |
| D-10 | 缺失的版本或许可记为 `null` 或「未声明」，从不猜测。 | 猜测的版本会让一次重新抓取看起来像一次更正。 | 各抓取脚本 |
| D-41 | 最远点是支线尽头的环线，从路径两端各 5 公里内的节点闭合。 | 支线没有回头路，因此堪萨斯城的 I-435 在密苏里只量出 33 英里，堪萨斯那一半被算成支线；现在量得 81 英里，FHWA 为 80.74。只有 I-435 受影响。 | `geo.mjs` 中的 `ringFromNearEnds` |
| D-42 | 同一编号另有更长路段时，不足半英里的小段被丢弃；该编号只有这一段短路时保留，显示为「<1 mi」。拼接器的碎片阈值（美国 1.2 公里，加拿大和墨西哥 1.5 公里）同样只在该编号有更长路段时适用。美国州道编号若唯一的一段不足半英里，仍像阈值时期一样不收录。 | 被丢弃的十段是数字化残留，以 0 英里路线列出。它们的同号路线也去掉了只为区分二者才需要的 `-1` 后缀（`us-129-ga-1` 现为 `us-129`）。阈值还曾丢掉比它更短的完整道路：安大略的 7000 系列连接线、曼尼托巴通往 Emerson 边境的 29 号公路。在美国，它会新增约 1,200 条不足半英里的路线，几乎都是乡道或次要道路在立交处被 TIGER 归入较高等级的几百米，其余部分已被 D-47 排除。 | `geo.mjs` 中的 `stitchRoute`；`build-data.mjs`；`i18n.js` 中的 `lenNum`、`routeDist`；`check-data.mjs` |
| D-43 | `build-data.mjs` 会删除不再写出的分辖区几何文件；`npm test` 运行的 `check-data.mjs` 在索引、几何文件和所有引用路线的文件之间出现任何不一致时报错。 | 一个过期的 `DC.json` 比 DC 295 活得还久，而 TIGER 2025 已把它归为 I-295；一次构建里的 id 变化也会悄悄清空另一个文件里的引用。 | `build-data.mjs`、`check-data.mjs` |

### 美国

| 编号 | 决策 | 理由与被否决的方案 | 执行位置 |
| --- | --- | --- | --- |
| D-11 | TIGER/Line 年份固定。 | 构建可复现；人口普查局保留往年数据。 | `tiger.mjs` 中的 `TIGER_YEAR` |
| D-12 | 编号从道路名称中解析；历史线位（`Old US Hwy 395`、`Hst Rte 66`）不计；共线路段（`US Hwy 11/15`）两条路线都算。 | TIGER 没有路线编号字段。 | `tiger.mjs` |
| D-13 | HPMS 在服务器端查询和汇总，每条路线每个州一行，而不是下载全量。 | 全量为 1,950 万个路段、49 GB。 | `fetch-hpms.mjs` |
| D-14 | 跨州路线的 HPMS 数字按各州实测里程加权。 | 简单平均会让新罕布什尔 15 英里的 I-95 与佛罗里达 382 英里同等计数。 | `build-data.mjs` |
| D-15 | 得克萨斯、马萨诸塞和马里兰按 HPMS 的 `route_id` 匹配；田纳西不匹配。 | 这几个州的 `route_signing` 无法使用；田纳西没有可靠的键。 | `fetch-hpms.mjs` |
| D-16 | 阿拉斯加的 A-1 至 A-4 被声明为其叠加的州道加上两个端点。 | 它们不挂州际公路路牌，因此没有任何几何数据以此命名。 | `alaska-interstates.json`、`build-data.mjs` |
| D-17 | 造价采用 FHWA 1991 年估算：仅州际公路建设资金，截至 1989 年 12 月 31 日的拨款，未经通胀调整。 | 这是唯一逐条路线的联邦数字；未使用该资金建设的收费公路不在其中。 | `fhwa-cost.json`，附适用范围展示 |
| D-18 | 建成动画只点亮有文献通车年份的路线；曲线是 FHWA 的全国序列。 | 不存在逐条路线的通车记录。 | `build-content.mjs`、`timelapse.js` |
| D-47 | 美国路网为 TIGER 的主要与次要道路（MTFCC S1100 与 S1200），其上的所有挂牌路线都包括在内。TIGER 只归入地方道路的州道不在范围内：北卡罗来纳的次要路线、南卡罗来纳的 S 字头道路、得克萨斯的大部分农场到市场道路。 | HPMS 列出约 11,000 个本站没有的州道编号，几乎都是这类地方等级系统。为此读取 TIGER 全量道路文件被否决：它们相当于全国每一条街道，而乡间道路不是本站要画的东西。 | `tiger.mjs` 只读取 `PRISECROADS` |
| D-48 | 名称本身就是编号的，即使 TIGER 标为 `M` 也按编号读取：波多黎各以「PR」或「Carr」开头的名称、任何地方以「I-」开头的名称，以及得克萨斯的 loop 和 spur，包括没写「State」的（泰勒的 Loop 49、圣安吉洛的 Loop 250）。TIGER 的表按 UTF-8 读取。 | 其他地方 `M` 表示俗名并被排除，但 TIGER 把波多黎各所有 carretera 都标为 `M`，包括 PR-52，因此整个岛都缺失了，拉雷多的「I-69 W」和这两条得克萨斯 loop 也一样。按 Windows-1252 读取时，「Peña Blvd」会变成「PeÃ±a」。 | `tiger.mjs` 中的 `parseName`、`LOCAL.TX`、`readState` |
| D-49 | 有名称无编号的 TIGER 主要道路，若 0.4 公里内没有编号路线，就并入某条路线。FHWA 路线名录显示该路是挂牌路线时，并入那条路线（Natcher Parkway 即 I-165）；否则自成一条路线，以名称为题，路牌留空，并注明没有编号，前提是长度达到 1 英里；更短的仍作背景线。不挂牌的内部编号（肯塔基的 9000 系列、新泽西的 444 和 700、俄克拉何马的收费公路编号）不显示。 | S1100 是 TIGER 的限制出入等级，这些高速公路此前只画成背景细线：肯塔基的各条 parkway、John Kilpatrick 收费公路、波多黎各的快速路。更短的是普通干道上的立交（Jamboree Road、Cedar Avenue），不是高速公路。本站读取的来源都没有这些内部编号：HPMS 没有肯塔基 900x 或新泽西 444/700 的记录，它的俄克拉何马 375 长 209 英里，范围不同。 | `named-freeways.mjs`、`us-named-freeways.json` |
| D-53 | 能证明登记错位的路线名录数字，用 `fhwa-corrections.json` 替换，每条都附 FHWA 公布的原值；公布值一旦变化，构建即失败。无法找回正确值的数字予以撤下，该路线改用实测值（D-1）。第一例是田纳西：两张表里该州的里程列从 I-69 到 I-840 整体错了一行。 | 错位后的数值逐条吻合：I-640 公布 77.29 英里（即 I-840 的长度），实测 11；I-81 公布 1.96（I-124 的），实测 76；I-75 公布 75.63（I-81 的），实测 159，等于 142.23 加上与 I-40 共线的 19.60 英里。只剔除明显不合理的行被否决，因为那样会留下看似合理却错误的数字。 | `build-data.mjs` 中的 `correctMileage` |

### 加拿大

| 编号 | 决策 | 理由与被否决的方案 | 执行位置 |
| --- | --- | --- | --- |
| D-19 | 保留 NRN 中的市县编号，该等级命名为「省道与市县道」，每条路以地名区分。 | 文件不区分二者；靠猜会丢掉真正的省道。 | `canada.mjs`、等级名称 |
| D-20 | `RTNUMBER` 为 0 表示无编号；小数（`1.0`）去掉小数部分；纽芬兰的地方连接编号（`430-15`）排除。 | 每一种都曾产生假路线：一条 42,465 公里的「0 号公路」、2,504 条假的纽芬兰路线。 | `canada.mjs` |
| D-21 | 已由 D-52 取代。横加公路等级曾根据 NRN 的路段名称测定：承载它至少 25 公里且占全长 35% 的路线。 | BC 的黄头公路和整个魁北克都没有这个名称，因此都被画成普通路线；而达到门槛的路线又被整条画成横加公路：400 号公路和 11 号公路全线。 | — |
| D-52 | 横加公路是手工清单（`tch-routes.json`）上的路线：维基百科列出的主线与全部分支，十个省共 33 条。每条路线在横加公路终止处切开，只有承载它的那段画成横加公路，其余部分留在原来的等级。范围以省份记录的 NRN 路段名称为准，否则为整条路线（BC 1，其温哥华岛路段 NRN 未命名；BC 16、QC 85、QC 185）或两个立交之间的路段（ON 11，以免把 71 号公路以西一小段零散的命名路段画进去；以及 QC 40、25、20、117 和 15）。不在清单上的路线若带这个名称，是与清单路线共线的路面，忽略不计；`tch-crosscheck.json` 列出两类情况。渡轮航段不绘制。 | 该系统没有机读登记，因此作为小而封闭的集合，按[第 2 节](#2-what-a-source-must-meet)手工整理；加拿大交通部的背景介绍确认了主线和黄头公路，但没有列出分支，所以用百科全书来列举，这一点违背了权威性规则。只靠名称测定等级（D-21）因留下的缺口而被否决。 | `tch.mjs`、`build-data.mjs` 中的 `splitForTch` |
| D-22 | NHS 等级从加拿大交通部的服务读取。 | 加拿大统计局自己的 NHS 图层在西北地区和育空是空的。 | `fetch-canada-nhs.mjs` |
| D-23 | 交通量只从批量发布的辖区读取；每个数字是长度加权平均，并与最繁忙点并列显示。 | 地图和 PDF 不符合[第 2 节](#2-what-a-source-must-meet)；只给平均值会掩盖峰值。 | `fetch-canada-traffic.mjs`、`detail.js` |
| D-24 | 安大略的共线路面计量方式按原样保留；新斯科舍的单向计数相加为双向数字；407 号公路运营方的出行次数不作为交通量显示。 | 每一条都在路线面板上说明。 | `fetch-canada-traffic.mjs`、`ca.tr.note.*` |
| D-25 | 通车年份只取自魁北克的名录和《年鉴》中注明日期的事件。 | 其他省份都没有公布；桥梁年份被拒绝（D-36）。 | `build-content.mjs` |
| D-50 | NRN 没有给编号的省道不收录，也不从其他来源补入。已知案例：艾伯塔 12A 和 834A；新斯科舍 32、33、253、280、318、322 和 328；新不伦瑞克 151、189、194、195 和 197；安大略十条 7000 系列连接线（7087 至 7908）和 7187；NHS 登记中的萨斯喀彻温 10A、育空 97 和魁北克 720。每一条都列在 `coverage-gaps.json` 中。 | 省级统计和登记里有它们，但只有 NRN 以符合[第 2 节](#2-what-a-source-must-meet)的许可提供加拿大的几何；省级统计文件的路段无法提供国家文件没有的道路。 | `canada.mjs` |

### 墨西哥

| 编号 | 决策 | 理由与被否决的方案 | 执行位置 |
| --- | --- | --- | --- |
| D-26 | 路线编号以 INEGI 的 CODIGO 为准；SICT 的编号只做交叉核对，不合并。 | 两个机构各自为州道编号；合并会凭空造出路线。 | `mexico.mjs`、`check-mexico-numbers.mjs` → `mx-crosscheck.json` |
| D-27 | 只有有编号的道路才成为路线；2 公里以上的无编号联邦和州道作为淡色背景。 | 无编号的道路没有任何可以关联的编号。 | `mexico.mjs`、`build-data.mjs` |
| D-28 | MEX-15 与 MEX-15D 视为同一条路线；收费比例取自逐段标记。 | 文件几乎从不写 D 后缀。 | `mexico.mjs` |
| D-29 | 联邦路段所在的州按 Natural Earth 1:10m 确定。 | 文件把每个联邦路段的管辖方都记为联邦。 | `mx-states.mjs` |
| D-30 | 路线端点为其所在的 SICT 路段（tramo）。 | 墨西哥数据流程中没有地名库。 | `mexico.mjs`、`detail.js` |
| D-31 | `VELOCIDAD` 保留为 `routingSpeed`，从不作为限速显示。 | 它是路径规划参数，不是标示限速。 | `mexico.mjs` |
| D-32 | 年平均日交通量按路线显示观测站数量及其中位数、最低和最高值；不做长度加权平均。位于无编号道路或距其路线超过 5 公里的观测站不放置。SICT 为 2024 年推算的 2,206 个站点会加以说明，因为数据本身没有标记。 | 观测站是点；按长度加权会凭空制造覆盖。 | `build-data.mjs` 中的 `attachMexicanTraffic`、`mx-traffic.json` 的 `limitations` |
| D-40 | SICT 最新版中某州的行数不到上一年一半时，该州观测站改用十二年面板中上一年的数据。每个观测站带有年份，观测站跨两年的路线显示「2023–2024」。键为 `MEX-015D` 的观测站放在 MEX-015 上，因为 D-28 把二者视为同一路线。 | 2024 版在十二个州止于 99 行，两个资源都是如此（哈利斯科 99 行，2023 年为 734 行），这是截断而不是调查规模变小。全部改用 2023 年被否决，因为会丢掉完整的 2024 年州份。不做 D 后缀合并时，收费高速公路上有 2,000 多个观测站被丢弃。 | `fetch-mexico-traffic.mjs` 的 `limitations.truncated`、`attachMexicanTraffic` |
| D-51 | 只以 ramal、acceso 或偏移段命名的州道，若 SICT 2025 年索引在同一州为同名路段列出了同一编号，则保留。RNC 没有的 SICT 州道编号不放置。 | 一概排除这类路线（D-27 的理由，`isBranchOnly`）也会丢掉两个机构认定一致的道路：伊达尔戈的 HGO-017 Tepeji del Río–Tlahuelilpan、金塔纳罗奥的 QR-018。本站缺少的 122 个 SICT 州道编号中，大多是 RNC 编号不同（D-26）或按名称在其中找不到的道路；按位置放置它们被否决。 | `mexico.mjs` 中的 `loadListed`、`readRedVial` |
| D-44 | 没有任何路段落在某州概化边界内的联邦路线，归入最近的州；其分州里程留空。 | `mex-174`（华雷斯城）和 MEX-15 在索诺拉的一段曾被归入「MX」。把它们的路段塞进最近州的里程被否决，因为 D-29 让这类路段不归属任何州。 | `mx-states.mjs` 中的 `locate.nearest` |
| D-56 | 墨西哥路线的断点，除从死端出发外，也从每一段的两个地理端点出发跨接。只写在路段名称里的联邦编号不予读取。 | RNC 把分隔的联邦公路画成两条单向车道，它们在每段的端点汇合，因此那里没有死端，剩下的跨接只能从匝道残段出发：MEX-85 从曼特到维多利亚跳过 117 公里，而它自己的一段 119 公里路就在两端 3 公里外，被画成分支，不计入长度。这些段断在另一编号的 CODIGO 接管共线路段之处（曼特的 MEX-80、新拉雷多的 MEX-2），因为该字段只能写一个编号。从 NOMBRE 读编号被否决：名称中写着联邦编号的路段共约 1,100 公里，几乎都是以所岔出的交叉口命名的州道（"E.C. México 15 – Ocoroni"），少数确实是该公路本身的是城市街道。 | `geo.mjs` 中的 `bridgeFromExtremities`、`buildMexico` |

### 图层与剖面

| 编号 | 决策 | 理由与被否决的方案 | 执行位置 |
| --- | --- | --- | --- |
| D-33 | 边境服务局办事处只有在其所在省有候选点距美国 5 公里以内时，才按 NRCan 地理编码放置；否则放在其地址中的公路与边境的交点；并以 25 公里为限与对面的 BTS 口岸核对。每个都记录定位精度。 | 边境服务局只给地址，不给坐标。 | `fetch-border-crossings.mjs`、`build-crossings.mjs` |
| D-34 | 墨西哥口岸采用 INDAABIN 的清单；不偏向任何一种北部边境的计数。 | INDAABIN（45）、IMT（52）和北美开发银行（59）统计的是不同的东西。 | `border-crossings.json` 的 `counts` |
| D-35 | 口岸只按距离列出 2 公里内的路线。 | 两份登记都没说口岸在哪条路上。 | `build-crossings.mjs` |
| D-36 | 桥梁建成年份从不用来给它所承载的道路定年。 | 老路上的新桥记录的是一次更换；道路也可能在结构物完工前通车。 | `fetch-bridges.mjs` 的 `notInferred` |
| D-37 | 加拿大收费段只有在测得长度与公布长度相差 10% 以内时才绘制；费率只与其生效日期一同显示。 | 长度不同的切段找错了路段；没有日期的费率无法核对。 | `build-tolls.mjs`、`tolls-ca.json` |
| D-38 | 特许经营权证书只有写明编号，或拟议的名称匹配标为 `approved: true` 时，才关联到路线。对于修建道路的证书，授予日期显示为道路最早可能通车的日期。特许经营段不绘制。 | 证书用文字指称道路；登记没说特许经营段从哪里开始、到哪里结束。 | `propose-mx-concession-matches.mjs`、`build-tolls.mjs` |
| D-39 | 高程沿主线取 220 个点，来自 9 级瓦片；低于海平面 30 米以上的读数视为水面。 | 瓦片含海底地形，桥梁和渡轮会读成海底。保留低于海平面但浅于 30 米的陆地（帝王谷）；死亡谷（−86 米）则不会被保留。 | `build-elevation.mjs` |
| D-45 | 墨西哥收费站按 RNC 绘为点，附运营方、收费制式及来源自己的定位等级；只有等级为 *definida* 的收费站不加注。 | 它是交费的地方，不是收费路段的起止点；封闭式收费在每个出入口都有一个，所以统计的是收费亭。 | `build-tolls.mjs`、`tolls.js` |
| D-46 | 桥梁图层按原样绘制两份清单，安大略有记录的涵洞也包括在内，按建成年份着色，每个弹窗都重申 D-36。图层说明它覆盖哪些路网。 | 美国（NBI）、墨西哥收费路网和十二个加拿大辖区都不在其中；不加说明的图层会被读成整个大陆。 | `build-bridges.mjs`、`bridges.js` |

---

## 6. 未解决的数据问题

2026-10-10 审查发现。每一条都是数据或流程中的问题，不是来源缺口；来源缺口见 [ACCURACY.md 第 6 节](ACCURACY.md#6-known-gaps)。修好后删除该行，并把由此产生的决策记入[第 5 节](#5-decision-log)。

| 编号 | 问题 | 证据 |
| --- | --- | --- |
| I-4 | 路线索引的长度混用了实测里程和官方里程。 | `index.json` 的 `mi` 在有 FHWA 数字时用 FHWA 的，否则用实测值（190 条州际公路两者不同；I-90 为 2,706，实测 3,076）。列表和统计页的最长路线都不加标注地显示它们，违反 D-1。 |
| I-5 | 部分路线说明给出的官方长度，与路线记录的范围不同。 | I-49 为 249.93，实测 559；I-295（新泽西）、I-69（印第安纳）、AK-3、US 95（内华达）、TX 71 也是如此。 |
| I-12 | 仍有浅水处的高程读数。 | 14 条剖面在桥梁和渡轮处仍下探到 −34 至 −96 英尺，比 D-39 的阈值浅。 |
| I-13 | 被拼成支线的路段已绘制，但不计入路线长度和分州里程。 | I-471 画进了肯塔基，量得 1 英里，全部算在俄亥俄，而 FHWA 记肯塔基 5.02 英里；I-295 在宾夕法尼亚的一段（FHWA 10.82 英里）被画成新泽西路线的支线，没有宾夕法尼亚里程。 |
| I-14 | 部分州际公路画得比路线名录的长度短，因为 TIGER 把其中一段登记在别的名称或等级下。 | 实绘对比 FHWA：I-35E（明尼苏达）18 / 39.34 英里，I-35W（明尼苏达）26 / 41.78，I-555 31 / 49.94，I-265（印第安纳）1 / 13.13，I-73 70 / 121.52，I-295（北卡）14 / 22.48，I-11 21 / 54.19。标题长度用 FHWA 的数字，地图上的线偏短。 |
| I-15 | 墨西哥联邦公路画得比公布长度短很多。 | 对照维基百科信息框长度（2026-10-11 抽样）：MEX-85 523 / 754 英里，MEX-2 941 / 1,235，MEX-180 1,095 / 1,392，MEX-15 1,172 / 1,469，MEX-45 802 / 927。拼接器记下了断点：杜兰戈的 MEX-45 有 20 处，缺口共 315 英里；锡那罗亚的 MEX-15 有 9 处，283 英里；伊达尔戈的 MEX-85 有 6 处，238 英里。同一抽样中，共线路段很少的州际公路（I-5、I-10、I-80、I-95）误差在 0.3% 以内。 |
| I-16 | 部分安大略 NHS 路线把相距很远的同号路段连成一条。 | ON 27 实绘 58 英里，跨 11 处断点、共 532 英里缺口；ON 24、15、12、19、5、10、9、6 和 8 各有 13 至 25 处断点、400 至 490 英里缺口。这些公路大多在 1997–98 年移交给各县；剩下的路段是 NRN 仍在编号的部分，而 NHS 拼接会在它们之间跨越最多 120 公里。 |
