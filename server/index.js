import express from 'express'
import db, { ts, now, DEFAULT_WEIGHTS, DEFAULT_KEYWORD_CAP } from './db.js'

const app = express()
app.use(express.json())
const PORT = 4160

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }
const parseSkills = s => { try { return JSON.parse(s || '[]') } catch { return [] } }
const parseJSON = (s, d) => { try { return JSON.parse(s || '') ?? d } catch { return d } }
const parseDims = (s, d) => parseJSON(s, parseJSON(d, []))

const STAGES = ['submitted', 'screening', 'interview', 'offer', 'hired']
const NEXT_STAGE = { submitted: 'screening', screening: 'interview', interview: 'offer', offer: 'hired' }

// ---------------- 人岗匹配评分算法 ----------------
// 系统默认五维权重合计闭合为 1.0；每个职位可发布自己的策略（match_strategies）
const WEIGHT_KEYS = ['skill', 'year', 'salary', 'edu', 'city']

// 把前端传入的权重归一化为合计 1.0；允许将某维权重设为 0（如不看学历）
function normalizeWeights(input) {
  const raw = {}
  WEIGHT_KEYS.forEach(k => { raw[k] = Math.max(0, num(input?.[k], DEFAULT_WEIGHTS[k])) })
  const total = WEIGHT_KEYS.reduce((s, k) => s + raw[k], 0)
  if (total <= 0) return { ...DEFAULT_WEIGHTS }
  // 先保留两位小数，再把舍入残差补到权重最大的维度，保证合计严格为 1
  const w = {}
  WEIGHT_KEYS.forEach(k => { w[k] = Math.round(raw[k] / total * 100) / 100 })
  let rest = Math.round((1 - WEIGHT_KEYS.reduce((s, k) => s + w[k], 0)) * 100) / 100
  if (rest !== 0) {
    const maxK = WEIGHT_KEYS.reduce((a, b) => w[b] > w[a] ? b : a, WEIGHT_KEYS[0])
    w[maxK] = Math.round((w[maxK] + rest) * 100) / 100
  }
  return w
}

// 读取职位已发布的策略；未配置则回退系统默认
function getStrategy(posId) {
  const row = db.prepare('SELECT * FROM match_strategies WHERE position_id=?').get(num(posId))
  if (!row) {
    return { weights: { ...DEFAULT_WEIGHTS }, keywordCap: DEFAULT_KEYWORD_CAP, versionId: 0, publishedAt: '', isDefault: true }
  }
  const ver = db.prepare('SELECT id FROM strategy_versions WHERE position_id=? ORDER BY id DESC LIMIT 1').get(row.position_id)
  return {
    weights: normalizeWeights(parseJSON(row.weights, { ...DEFAULT_WEIGHTS })),
    keywordCap: Math.max(0, num(row.keyword_cap, DEFAULT_KEYWORD_CAP)),
    versionId: ver ? ver.id : 0,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    isDefault: false
  }
}

function computeMatch(cand, pos, strategy) {
  const W = strategy?.weights || DEFAULT_WEIGHTS
  const keywordCap = strategy?.keywordCap ?? DEFAULT_KEYWORD_CAP
  const cSkills = parseSkills(cand.skills)
  const pSkills = parseSkills(pos.skills)
  const dims = []

  // 技能匹配：候选者命中职位要求技能的熟练度按职位权重加权
  let skillScore = 0, matched = 0, skillWeightSum = 0
  pSkills.forEach(req => {
    const hit = cSkills.find(c => c.k === req.k)
    if (hit) { skillScore += Math.min(100, (num(hit.idx, 3) / 5) * 100) * req.w; matched++ }
    skillWeightSum += req.w
  })
  const skillCover = pSkills.length ? matched / pSkills.length : 1
  skillScore = pSkills.length ? (skillWeightSum ? skillScore / skillWeightSum : 0) : 70
  dims.push({ k: '技能', score: Math.round(skillScore), w: W.skill })

  // 年限匹配
  const ideal = num(pos.years, 0)
  const yearScore = num(cand.years, 0) >= ideal ? 90 : Math.max(30, 100 - (ideal - num(cand.years, 0)) * 15)
  dims.push({ k: '经验年限', score: Math.round(yearScore), w: W.year })

  // 薪资带宽匹配（先判低于带宽，再判高于带宽，避免分支被吞）
  const sal = num(cand.exp_salary, 0)
  let salScore, salNote, salOver = false, salOverMuch = false
  if (sal <= 0) { salScore = 70; salNote = '期望薪资未填写' }
  else if (sal < pos.salary_min) { salScore = 75; salNote = '期望薪资低于带宽' }
  else if (sal <= pos.salary_max) { salScore = 90; salNote = '期望薪资在带宽内' }
  else if (sal <= pos.salary_max * 1.15) { salScore = 70; salNote = '期望薪资略高于带宽'; salOver = true }
  else { salScore = 45; salNote = '期望薪资超出带宽'; salOver = true; salOverMuch = true }
  dims.push({ k: '薪资匹配', score: salScore, w: W.salary })

  // 学历匹配
  const eduRank = { '博士': 100, '硕士': 85, '本科': 70, '大专': 55 }
  const eduScore = eduRank[cand.edu] ?? 65
  dims.push({ k: '学历', score: eduScore, w: W.edu })

  // 城市匹配
  const cityHit = pos.city === '全国' || (!!cand.city && cand.city === pos.city)
  const cityScore = cityHit ? 90 : 65
  dims.push({ k: '城市地点', score: cityScore, w: W.city })

  // 简历关键词加分（在职位名/要求技能中命中，封顶，不计入维度权重；cap=0 关闭）
  const keywords = new Set([...pSkills.map(s => s.k), ...String(pos.name || '').split(/[\s/、,，]+/).filter(Boolean)])
  const tokens = String(cand.raw || '').split(/[,，。；;、/\s]+/).filter(Boolean)
  const hitKws = new Set([...keywords].filter(kw => tokens.some(t => t.includes(kw))))
  const keywordBonus = Math.min(keywordCap, hitKws.size * 1.5)

  // 五维加权（权重按职位策略，合计 1.0）+ 封顶关键词附加分
  const base = skillScore * W.skill
    + yearScore * W.year
    + salScore * W.salary
    + eduScore * W.edu
    + cityScore * W.city
  const score = Math.min(100, Math.round(base + keywordBonus))

  // 短板：覆盖技能/年限/薪资/学历/城市五个维度
  const weakness = []
  if (skillCover < 0.5) weakness.push('关键技能覆盖不足')
  if (yearScore < 65) weakness.push('经验年限偏低')
  if (salOverMuch) weakness.push('期望薪资超出带宽')
  else if (salOver) weakness.push('期望薪资略高于带宽')
  if (eduScore < 60) weakness.push('学历相对偏低')
  if (!cityHit) weakness.push('工作城市不匹配')

  const rating = score >= 80 ? '高匹配' : score >= 65 ? '匹配度良好' : score >= 55 ? '基本匹配' : '匹配度偏低'
  const cityNote = cityHit
    ? (pos.city === '全国' ? '城市全国可选' : `城市${cand.city}与职位一致`)
    : `城市${cand.city || '未知'}≠${pos.city}`
  const reason = [
    `技能覆盖${Math.round(skillCover * 100)}%`,
    `经验${cand.years}/${ideal}年`,
    salNote,
    `${cand.edu || '学历未知'}`,
    cityNote
  ].join('，') + `；综合${rating}${keywordBonus ? `（简历关键词+${keywordBonus.toFixed(1)}分）` : ''}`

  return { score, dims, reason, weakness: weakness.join('、') || '无显著短板' }
}

// 按职位当前已发布策略重算并落库为「最新结果」（不影响 applications 里的投递快照）
function upsertMatch(candId, posId) {
  const cand = db.prepare('SELECT * FROM candidates WHERE id=?').get(candId)
  const pos = db.prepare('SELECT * FROM positions WHERE id=?').get(posId)
  if (!cand || !pos) return null
  const strategy = getStrategy(posId)
  const m = computeMatch(cand, pos, strategy)
  const stamp = now()
  const existing = db.prepare('SELECT id FROM matches WHERE candidate_id=? AND position_id=?').get(candId, posId)
  if (existing) {
    db.prepare('UPDATE matches SET score=?,dims=?,reason=?,weakness=?,computed_at=?,strategy_id=? WHERE id=?')
      .run(m.score, JSON.stringify(m.dims), m.reason, m.weakness, stamp, strategy.versionId, existing.id)
  } else {
    db.prepare('INSERT INTO matches(candidate_id,position_id,score,dims,reason,weakness,computed_at,strategy_id) VALUES(?,?,?,?,?,?,?,?)')
      .run(candId, posId, m.score, JSON.stringify(m.dims), m.reason, m.weakness, stamp, strategy.versionId)
  }
  return {
    ...m, candidate_id: candId, position_id: posId,
    weights: strategy.weights, keyword_cap: strategy.keywordCap,
    strategy_id: strategy.versionId, strategy_is_default: strategy.isDefault,
    computed_at: stamp
  }
}

// 投递时的评分依据快照：锁定分数/维度/理由/短板及所用策略，后续重算不再改变
function buildSnapshot(m) {
  return {
    score: m.score, dims: m.dims, reason: m.reason, weakness: m.weakness,
    weights: m.weights, keyword_cap: m.keyword_cap,
    strategy_id: m.strategy_id, strategy_is_default: m.strategy_is_default,
    matched_at: now()
  }
}

// ---------------- 可追溯链路：事务 + 阶段进入留痕 ----------------
// 所有「写最新结果 / 固化阶段依据 / 推进流程」的组合操作都在一个立即事务里完成，
// 避免批量重算与流程推进交叉时出现「阶段已推进、评分依据还是旧策略」的不一致。
function tx(fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

// 从 upsertMatch 的返回值提取需要留痕的评分依据
function evidenceOf(m) {
  return {
    score: m.score, dims: m.dims, reason: m.reason, weakness: m.weakness,
    weights: m.weights, keyword_cap: m.keyword_cap,
    strategy_id: m.strategy_id, strategy_is_default: m.strategy_is_default
  }
}

// 候选人进入某阶段时固化一条评分依据；同一阶段只保留首次进入的一条（幂等）
function insertStageEvent({ appId, posId, candId, stage, fromStage, ev, basis = 'latest', backfilled = 0, created }) {
  const dup = db.prepare('SELECT id FROM stage_events WHERE application_id=? AND stage=?').get(appId, stage)
  if (dup) return null
  const stamp = created || ts()
  const r = db.prepare(`INSERT INTO stage_events
    (application_id,position_id,candidate_id,stage,from_stage,score,dims,reason,weakness,weights,keyword_cap,strategy_id,strategy_is_default,basis,backfilled,created)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    appId, posId, candId, stage, fromStage || '',
    num(ev.score), JSON.stringify(ev.dims || []), ev.reason || '', ev.weakness || '',
    JSON.stringify(ev.weights || {}), num(ev.keyword_cap, DEFAULT_KEYWORD_CAP),
    num(ev.strategy_id), ev.strategy_is_default === false ? 0 : 1,
    basis, backfilled ? 1 : 0, stamp
  )
  return Number(r.lastInsertRowid)
}

// ---------------- 状态汇总 ----------------
app.get('/api/state', (req, res) => {
  const positions = db.prepare('SELECT * FROM positions ORDER BY id').all().map(p => {
    const st = db.prepare('SELECT published_at, published_by FROM match_strategies WHERE position_id=?').get(p.id)
    return { ...p, skills: parseSkills(p.skills), strategy: st ? { published_at: st.published_at, published_by: st.published_by } : null }
  })
  const candidates = db.prepare('SELECT * FROM candidates ORDER BY id').all().map(c => ({ ...c, skills: parseSkills(c.skills) }))
  const apps = db.prepare('SELECT * FROM applications ORDER BY id DESC').all()
  const interviews = db.prepare('SELECT * FROM interviews ORDER BY id DESC').all()
  const offers = db.prepare('SELECT * FROM offers ORDER BY id DESC').all()
  const channels = db.prepare('SELECT * FROM channels ORDER BY id').all()
  const strategyVersions = db.prepare('SELECT * FROM strategy_versions ORDER BY id DESC').all().map(v => ({
    ...v, weights: parseJSON(v.weights, { ...DEFAULT_WEIGHTS }), keyword_cap: num(v.keyword_cap)
  }))
  const matches = db.prepare('SELECT * FROM matches ORDER BY id DESC').all().map(m => ({
    ...m,
    score: num(m.score),
    dims: parseDims(m.dims, '[]'),
    strategy_id: num(m.strategy_id)
  }))
  // 阶段进入留痕：按应聘记录聚合，供看板按阶段/按策略版本回看评分依据
  const stageEvents = db.prepare('SELECT * FROM stage_events ORDER BY id ASC').all().map(e => ({
    ...e,
    score: num(e.score),
    dims: parseDims(e.dims, '[]'),
    weights: parseJSON(e.weights, { ...DEFAULT_WEIGHTS }),
    keyword_cap: num(e.keyword_cap),
    strategy_id: num(e.strategy_id),
    strategy_is_default: !!e.strategy_is_default,
    backfilled: !!e.backfilled
  }))
  const eventsOfApp = appId => stageEvents.filter(e => e.application_id === appId)
  const matchOf = (cid, pid) => matches.find(m => m.candidate_id === cid && m.position_id === pid) || null
  const pipelines = apps.map(a => {
    const pos = positions.find(p => p.id === a.position_id)
    const cand = candidates.find(c => c.id === a.candidate_id)
    const its = interviews.filter(i => i.application_id === a.id)
    const of = offers.find(o => o.application_id === a.id) || null
    const mt = matchOf(a.candidate_id, a.position_id)
    // 投递时锁定的历史评分依据；兼容旧数据：无快照时置空由前端回退最新分
    const snap = parseJSON(a.match_snapshot, null)
    const latest = mt ? {
      score: mt.score, dims: mt.dims, reason: mt.reason, weakness: mt.weakness,
      computed_at: mt.computed_at, strategy_id: mt.strategy_id
    } : null
    return {
      ...a,
      position: pos ? pos.name : '', dept: pos ? pos.dept : '', city: pos ? pos.city : '',
      candidate: cand ? cand.name : '', candSkills: cand ? cand.skills : [],
      matchSnapshot: snap, matched_at: a.matched_at || '',
      match: latest,
      stageEvents: eventsOfApp(a.id),
      interviews: its, offer: of
    }
  })
  res.json({
    positions, candidates, applications: pipelines, interviews, offers, channels, matches,
    strategyVersions,
    defaultStrategy: { weights: { ...DEFAULT_WEIGHTS }, keywordCap: DEFAULT_KEYWORD_CAP }
  })
})

app.get('/api/summary', (req, res) => {
  const pos = db.prepare('SELECT status, COUNT(*) c FROM positions GROUP BY status').all()
  const apps = db.prepare('SELECT stage, COUNT(*) c FROM applications GROUP BY stage').all()
  const cand = db.prepare('SELECT COUNT(*) c FROM candidates').get().c
  return res.json({ positions: pos, applications: apps, candidates: cand })
})

// ---------------- 职位 ----------------
app.post('/api/positions', (req, res) => {
  const b = req.body || {}
  const r = db.prepare('INSERT INTO positions(name,dept,city,level,salary_min,salary_max,skills,years,slots,status,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(b.name, b.dept || '技术部', b.city || '上海', b.level || 'P5', num(b.salary_min, 15000), num(b.salary_max, 30000), JSON.stringify(b.skills || []), num(b.years, 2), num(b.slots, 1), 'open', ts())
  res.json({ ok: true, id: Number(r.lastInsertRowid) })
})

app.post('/api/positions/:id', (req, res) => {
  const id = num(req.params.id)
  const b = req.body || {}
  if (b.status) db.prepare('UPDATE positions SET status=? WHERE id=?').run(b.status, id)
  if (b.skills !== undefined) db.prepare('UPDATE positions SET skills=? WHERE id=?').run(JSON.stringify(b.skills), id)
  res.json({ ok: true })
})

// ---------------- 按职位配置/发布匹配策略 ----------------
// 读取某职位生效中的策略（未配置返回系统默认）
app.get('/api/positions/:id/strategy', (req, res) => {
  const id = num(req.params.id)
  const pos = db.prepare('SELECT id,name FROM positions WHERE id=?').get(id)
  if (!pos) return res.status(404).json({ ok: false })
  res.json({ ok: true, position: pos, strategy: getStrategy(id), defaults: { weights: { ...DEFAULT_WEIGHTS }, keywordCap: DEFAULT_KEYWORD_CAP } })
})

// 配置并发布策略：归一化权重 → 留痕版本 → upsert 生效配置
// body: { weights:{skill,year,salary,edu,city}, keyword_cap, reset, recalc, published_by }
app.post('/api/positions/:id/strategy', (req, res) => {
  const id = num(req.params.id)
  const pos = db.prepare('SELECT id FROM positions WHERE id=?').get(id)
  if (!pos) return res.status(404).json({ ok: false })
  const b = req.body || {}
  const stamp = ts()
  let weights, keywordCap
  if (b.reset) {
    weights = { ...DEFAULT_WEIGHTS }
    keywordCap = DEFAULT_KEYWORD_CAP
  } else {
    weights = normalizeWeights(b.weights || {})
    keywordCap = Math.max(0, Math.min(20, num(b.keyword_cap, DEFAULT_KEYWORD_CAP)))
  }
  // 版本留痕 → 生效配置 → 按新策略重算该职位全部推荐，单事务提交；
  // 期间该职位上的流程推进请求会在写锁处等待，不会读到「半发布」状态。
  let recalced = 0, versionId = 0
  tx(() => {
    const vr = db.prepare('INSERT INTO strategy_versions(position_id,weights,keyword_cap,published_at,published_by) VALUES(?,?,?,?,?)')
      .run(id, JSON.stringify(weights), keywordCap, stamp, b.published_by || 'HR')
    versionId = Number(vr.lastInsertRowid)
    db.prepare(`INSERT INTO match_strategies(position_id,weights,keyword_cap,published_at,published_by)
                VALUES(?,?,?,?,?)
                ON CONFLICT(position_id) DO UPDATE SET weights=excluded.weights,keyword_cap=excluded.keyword_cap,published_at=excluded.published_at,published_by=excluded.published_by`)
      .run(id, JSON.stringify(weights), keywordCap, stamp, b.published_by || 'HR')
    // 发布后按新策略批量重算该职位的全部推荐结果（默认开启）；只动 matches，不触碰已固化快照/阶段事件
    if (b.recalc !== false) recalced = recomputePosition(id)
  })
  res.json({ ok: true, strategy: { weights, keywordCap, versionId, publishedAt: stamp }, recalced })
})

// ---------------- 批量重算推荐结果 ----------------
// 单职位：全部候选人 × 该职位（含未投递候选人，保证推荐列表可用）
function recomputePosition(posId) {
  const pos = db.prepare('SELECT id FROM positions WHERE id=?').get(posId)
  if (!pos) return 0
  const cands = db.prepare('SELECT id FROM candidates').all()
  cands.forEach(c => upsertMatch(c.id, posId))
  return cands.length
}

app.post('/api/match/recompute', (req, res) => {
  const b = req.body || {}
  if (b.position_id) {
    const pos = db.prepare('SELECT id FROM positions WHERE id=?').get(num(b.position_id))
    if (!pos) return res.status(404).json({ ok: false })
  }
  let pairCount = 0, posCount = 0
  // 整批刷新在同一事务内：要么全部 matches 刷新成功，要么整体回滚；
  // 流程推进事务在写锁处排队，重算提交后它拿到的一定是最新策略结果。
  tx(() => {
    if (b.position_id) {
      pairCount = recomputePosition(num(b.position_id))
      posCount = 1
    } else {
      // 全局：所有在招职位 × 全部候选人；同时补上已关闭职位上已存在的匹配对
      const open = db.prepare("SELECT id FROM positions WHERE status='open'").all()
      open.forEach(p => { pairCount += recomputePosition(p.id); posCount++ })
      db.prepare("SELECT DISTINCT m.position_id FROM matches m JOIN positions p ON p.id=m.position_id WHERE p.status!='open'")
        .all().forEach(r => { pairCount += recomputePosition(r.position_id); posCount++ })
    }
  })
  res.json({ ok: true, positions: posCount, pairs: pairCount, recomputed_at: ts() })
})

// ---------------- 候选人 ----------------
app.post('/api/candidates', (req, res) => {
  const b = req.body || {}
  const r = db.prepare('INSERT INTO candidates(name,phone,skills,years,edu,school,city,exp_salary,channel,raw) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(b.name, b.phone || '', JSON.stringify(b.skills || []), num(b.years, 0), b.edu || '本科', b.school || '', b.city || '', num(b.exp_salary, 0), b.channel || '内推', b.raw || `候选人${b.name}的简历`)
  res.json({ ok: true, id: Number(r.lastInsertRowid) })
})

app.delete('/api/candidates/:id', (req, res) => {
  db.prepare('DELETE FROM candidates WHERE id=?').run(num(req.params.id))
  res.json({ ok: true })
})

// ---------------- 匹配 ----------------
app.get('/api/match/pos/:pid', (req, res) => {
  const posId = num(req.params.pid)
  const pos = db.prepare('SELECT * FROM positions WHERE id=?').get(posId)
  if (!pos) return res.status(404).json({ ok: false })
  const cands = db.prepare('SELECT * FROM candidates').all()
  const rows = cands.map(c => {
    // 每次匹配都按职位当前策略重算并落库，保证推荐结果与已落库的最新结果一致
    const m = upsertMatch(c.id, posId)
    return { candidate_id: c.id, name: c.name, skills: parseSkills(c.skills), years: c.years, edu: c.edu, city: c.city, exp_salary: c.exp_salary, score: m.score, dims: m.dims, reason: m.reason, weakness: m.weakness, computed_at: m.computed_at }
  })
  rows.sort((a, b) => b.score - a.score)
  const strategy = getStrategy(posId)
  res.json({ position: { ...pos, skills: parseSkills(pos.skills) }, candidates: rows, strategy })
})

app.get('/api/match/cand/:cid', (req, res) => {
  const candId = num(req.params.cid)
  const cand = db.prepare('SELECT * FROM candidates WHERE id=?').get(candId)
  if (!cand) return res.status(404).json({ ok: false })
  const poss = db.prepare("SELECT * FROM positions WHERE status='open'").all()
  const rows = poss.map(p => {
    // 与按职位推荐共用同一落库逻辑，保证分数/理由/短板完全一致
    const m = upsertMatch(candId, p.id)
    return { position_id: p.id, name: p.name, dept: p.dept, city: p.city, level: p.level, salary_min: p.salary_min, salary_max: p.salary_max, score: m.score, dims: m.dims, reason: m.reason, weakness: m.weakness, computed_at: m.computed_at, strategy_is_default: m.strategy_is_default }
  })
  rows.sort((a, b) => b.score - a.score)
  res.json({ candidate: { name: cand.name, skills: parseSkills(cand.skills), years: cand.years }, positions: rows })
})

// ---------------- 应聘流程 ----------------
app.post('/api/applications', (req, res) => {
  const b = req.body || {}
  const pid = num(b.position_id), cid = num(b.candidate_id)
  const dup = db.prepare('SELECT * FROM applications WHERE position_id=? AND candidate_id=?').get(pid, cid)
  if (dup) return res.json({ ok: false, msg: '该候选人已投递此职位' })
  const cand = db.prepare('SELECT * FROM candidates WHERE id=?').get(cid)
  const pos = db.prepare('SELECT * FROM positions WHERE id=?').get(pid)
  if (!cand || !pos) return res.status(404).json({ ok: false, msg: '职位或候选人不存在' })
  // 单事务：按职位策略重算最新结果 → 固化投递快照 → 写入「投递」阶段留痕 → 建单，四者原子提交
  const stamp = ts()
  const id = tx(() => {
    const m = upsertMatch(cid, pid)
    const snap = buildSnapshot(m)
    const r = db.prepare('INSERT INTO applications(position_id,candidate_id,stage,updated,recruiter,match_snapshot,matched_at) VALUES(?,?,?,?,?,?,?)')
      .run(pid, cid, 'submitted', stamp, b.recruiter || 'HR-Sandy', JSON.stringify(snap), snap.matched_at)
    const appId = Number(r.lastInsertRowid)
    insertStageEvent({
      appId, posId: pid, candId: cid, stage: 'submitted', fromStage: '',
      ev: evidenceOf(m), basis: 'snapshot'
    })
    return appId
  })
  res.json({ ok: true, id })
})

app.post('/api/applications/:id/advance', (req, res) => {
  const id = num(req.params.id)
  const a = db.prepare('SELECT * FROM applications WHERE id=?').get(id)
  if (!a) return res.status(404).json({ ok: false })
  const next = NEXT_STAGE[a.stage]
  if (!next) return res.json({ ok: false, msg: '已到最后阶段' })
  // 单事务保证一致性：先按当前策略刷新最新结果，再把「进入下一阶段时」的评分依据留痕，最后推进阶段。
  // 与批量重算并发时，事务行锁/写锁会把两者串行化，杜绝阶段与依据错配。
  let eventId = null, evidence = null
  tx(() => {
    const m = upsertMatch(a.candidate_id, a.position_id)
    evidence = evidenceOf(m)
    eventId = insertStageEvent({
      appId: id, posId: a.position_id, candId: a.candidate_id,
      stage: next, fromStage: a.stage, ev: evidence, basis: 'latest'
    })
    db.prepare('UPDATE applications SET stage=?, updated=? WHERE id=?').run(next, ts(), id)
  })
  res.json({ ok: true, stage: next, eventId, evidence })
})

app.post('/api/applications/:id/reject', (req, res) => {
  const id = num(req.params.id)
  const a = db.prepare('SELECT * FROM applications WHERE id=?').get(id)
  if (!a) return res.status(404).json({ ok: false })
  // 淘汰同样留痕：固化淘汰时刻的最新评分依据，便于事后复盘「为什么在该阶段淘汰」
  tx(() => {
    const m = upsertMatch(a.candidate_id, a.position_id)
    insertStageEvent({
      appId: id, posId: a.position_id, candId: a.candidate_id,
      stage: 'rejected', fromStage: a.stage, ev: evidenceOf(m), basis: 'latest'
    })
    db.prepare("UPDATE applications SET stage='rejected', updated=? WHERE id=?").run(ts(), id)
  })
  res.json({ ok: true })
})

// ---------------- 面试 ----------------
app.post('/api/applications/:id/interview', (req, res) => {
  const b = req.body || {}
  const r = db.prepare('INSERT INTO interviews(application_id,interviewer,time,round,eval,result) VALUES(?,?,?,?,?,?)')
    .run(num(req.params.id), b.interviewer || '面试官', b.time || ts(), b.round || '初试', b.eval || '', b.result || 'pending')
  res.json({ ok: true, id: Number(r.lastInsertRowid) })
})

app.post('/api/interviews/:id', (req, res) => {
  const b = req.body || {}
  const sets = [], vals = []
  if (b.result) { sets.push('result=?'); vals.push(b.result) }
  if (b.eval !== undefined) { sets.push('eval=?'); vals.push(b.eval) }
  if (!sets.length) return res.json({ ok: false })
  vals.push(num(req.params.id))
  db.prepare(`UPDATE interviews SET ${sets.join(',')} WHERE id=?`).run(...vals)
  res.json({ ok: true })
})

// ---------------- Offer ----------------
app.post('/api/applications/:id/offer', (req, res) => {
  const b = req.body || {}
  const r = db.prepare('INSERT INTO offers(application_id,salary,status,due,note) VALUES(?,?,?,?,?)')
    .run(num(req.params.id), num(b.salary, 20000), 'pending', ts(), b.note || '')
  res.json({ ok: true, id: Number(r.lastInsertRowid) })
})

app.post('/api/offers/:id', (req, res) => {
  const b = req.body || {}
  const of = db.prepare('SELECT * FROM offers WHERE id=?').get(num(req.params.id))
  if (!of) return res.status(404).json({ ok: false })
  if (b.status) {
    // Offer 接受/拒绝会驱动流程跳变到 hired/rejected，与阶段推进走同一套「留痕+推进」事务
    tx(() => {
      db.prepare('UPDATE offers SET status=? WHERE id=?').run(b.status, num(req.params.id))
      if (b.status === 'accepted' || b.status === 'rejected') {
        const a = db.prepare('SELECT * FROM applications WHERE id=?').get(of.application_id)
        const target = b.status === 'accepted' ? 'hired' : 'rejected'
        if (a && a.stage !== target) {
          const m = upsertMatch(a.candidate_id, a.position_id)
          insertStageEvent({
            appId: a.id, posId: a.position_id, candId: a.candidate_id,
            stage: target, fromStage: a.stage, ev: evidenceOf(m), basis: 'latest'
          })
          db.prepare('UPDATE applications SET stage=?, updated=? WHERE id=?').run(target, ts(), a.id)
        }
      }
    })
  }
  res.json({ ok: true })
})

// ---------------- 渠道 ----------------
app.post('/api/channels', (req, res) => {
  const b = req.body || {}
  db.prepare('INSERT INTO channels(name,cost) VALUES(?,?)').run(b.name, num(b.cost, 5000))
  res.json({ ok: true })
})

// 启动时按各职位当前策略重算全部已落库匹配，刷新「最新结果」（不影响投递快照）
function refreshAllMatches() {
  const rows = db.prepare('SELECT candidate_id, position_id FROM matches').all()
  rows.forEach(r => upsertMatch(r.candidate_id, r.position_id))
  if (rows.length) console.log(`[HR] refreshed ${rows.length} stored matches`)
}

// 兼容已有匹配记录：为升级前产生的投递记录回填评分快照（标记为迁移补录）
function backfillSnapshots() {
  const rows = db.prepare('SELECT id, candidate_id, position_id FROM applications WHERE match_snapshot IS NULL OR match_snapshot=?').all('')
  let n = 0
  rows.forEach(r => {
    const cand = db.prepare('SELECT * FROM candidates WHERE id=?').get(r.candidate_id)
    const pos = db.prepare('SELECT * FROM positions WHERE id=?').get(r.position_id)
    if (!cand || !pos) return
    const m = upsertMatch(r.candidate_id, r.position_id)
    const snap = { ...buildSnapshot(m), backfilled: true }
    db.prepare('UPDATE applications SET match_snapshot=?, matched_at=? WHERE id=?')
      .run(JSON.stringify(snap), snap.matched_at, r.id)
    n++
  })
  if (n) console.log(`[HR] backfilled match snapshots for ${n} legacy applications`)
}

// 为升级前的应聘记录补录阶段进入留痕：
// submitted 沿用投递快照依据；当前所处阶段按当前最新结果补一条（均标记 backfilled）。
// 幂等：已有 stage_events 的应聘记录跳过。
const PREV_STAGE = { rejected: 'offer', hired: 'offer', offer: 'interview', interview: 'screening', screening: 'submitted' }
function backfillStageEvents() {
  const apps = db.prepare('SELECT * FROM applications ORDER BY id').all()
  let n = 0
  tx(() => {
    apps.forEach(a => {
      const existed = db.prepare('SELECT COUNT(*) c FROM stage_events WHERE application_id=?').get(a.id).c
      if (existed > 0) return
      const cand = db.prepare('SELECT * FROM candidates WHERE id=?').get(a.candidate_id)
      const pos = db.prepare('SELECT * FROM positions WHERE id=?').get(a.position_id)
      if (!cand || !pos) return
      const snap = parseJSON(a.match_snapshot, null)
      const createdBase = a.updated || ts()
      // 1) 投递阶段：优先沿用投递快照，保证与看板「投递时评分」完全一致
      if (snap) {
        insertStageEvent({
          appId: a.id, posId: a.position_id, candId: a.candidate_id,
          stage: 'submitted', fromStage: '', ev: snap, basis: 'snapshot',
          backfilled: true, created: createdBase
        })
        n++
      }
      // 2) 当前阶段（非 submitted）：补录一条基于当前最新结果的留痕
      if (a.stage && a.stage !== 'submitted') {
        const m = upsertMatch(a.candidate_id, a.position_id)
        insertStageEvent({
          appId: a.id, posId: a.position_id, candId: a.candidate_id,
          stage: a.stage, fromStage: PREV_STAGE[a.stage] || 'submitted',
          ev: evidenceOf(m), basis: 'legacy',
          backfilled: true, created: createdBase
        })
        n++
      }
    })
  })
  if (n) console.log(`[HR] backfilled ${n} stage events for legacy applications`)
}
refreshAllMatches()
backfillSnapshots()
backfillStageEvents()

app.listen(PORT, () => console.log(`[HR] API running at http://localhost:${PORT}`))