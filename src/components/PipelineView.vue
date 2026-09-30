<script setup>
import { computed, ref } from 'vue'
import { useHrStore } from '@/store/hr'

const store = useHrStore()

const stages = [
  { k: 'submitted', label: '投递', icon: '📥', color: '#5b8cff' },
  { k: 'screening', label: '筛选', icon: '🔍', color: '#a78bfa' },
  { k: 'interview', label: '面试', icon: '💬', color: '#4fc3f7' },
  { k: 'offer', label: 'Offer', icon: '📄', color: '#ffd166' },
  { k: 'hired', label: '录用', icon: '🎉', color: '#57d6a0' }
]
const stageLabel = Object.fromEntries(stages.map(s => [s.k, s.label]))
stageLabel.rejected = '淘汰'

const filter = ref('all')
const stageFilter = ref('all')
// snapshot=投递快照；event=进入当前阶段时快照；latest=最近一次显式重算；version=按指定策略版本回看
const scoreView = ref('event')
const selectedVersion = ref('all')
const traceAppId = ref(null)

const list = computed(() => store.applications.filter(a => a.stage !== 'rejected'))
const viewList = computed(() => list.value.filter(a =>
  (stageFilter.value === 'all' || a.stage === stageFilter.value) &&
  (filter.value === 'all' || a.position === filter.value)
))

// 只提供当前流程数据中出现过的策略版本，避免回看一个与候选人无关的版本
const versionOptions = computed(() => {
  const ids = new Set()
  store.applications.forEach(a => {
    if (a.matchSnapshot?.strategy_id != null) ids.add(a.matchSnapshot.strategy_id)
    if (a.match?.strategy_id != null) ids.add(a.match.strategy_id)
    ;(a.events || []).forEach(e => ids.add(e.strategy_id ?? e.scoreSnapshot?.strategy_id ?? 0))
  })
  const versions = store.strategyVersions
    .filter(v => ids.has(v.id))
    .map(v => ({ id: v.id, label: `v${v.id} · ${v.published_at}` }))
  if (ids.has(0)) versions.push({ id: 0, label: 'v0 · 系统默认策略' })
  return versions.sort((a, b) => b.id - a.id)
})

function changeVersion(v) {
  selectedVersion.value = String(v)
  if (selectedVersion.value !== 'all') scoreView.value = 'version'
}

const nextStage = s => ({ submitted: 'screening', screening: 'interview', interview: 'offer', offer: 'hired' }[s])
const nextStageLabel = s => ({ screening: '筛选', interview: '面试', offer: 'Offer', hired: '录用' }[nextStage(s)] || '')

const fmtTime = t => t ? String(t).replace('T', ' ').slice(0, 16) : ''
const scoreClass = s => s == null ? '' : s >= 75 ? 's-hi' : s >= 55 ? 's-mid' : 's-lo'
const versionTag = id => Number(id) ? `v${id}` : 'v0 默认'

function evidenceEvents(a) {
  return (a.events || []).map(e => ({
    ...e,
    snapshot: e.scoreSnapshot || {
      score: e.match_score,
      strategy_id: e.strategy_id,
      recalc_job_id: e.recalc_job_id,
      dims: [], reason: '', weakness: '', matched_at: e.event_at
    }
  })).sort((x, y) => x.id - y.id)
}
function currentEvent(a) {
  const events = evidenceEvents(a).filter(e => e.stage === a.stage)
  return events[events.length - 1] || evidenceEvents(a)[0] || null
}
function histEvidence(a) { return a.matchSnapshot || null }
function eventEvidence(a) { return currentEvent(a)?.snapshot || histEvidence(a) || a.match }
function latestEvidence(a) {
  if (!a.match) return null
  return { ...a.match, matched_at: a.match.computed_at }
}
function versionEvidence(a) {
  if (selectedVersion.value === 'all') return null
  const vid = Number(selectedVersion.value)
  const pool = [
    { ...(a.matchSnapshot || {}), source: '投递时评分' },
    ...evidenceEvents(a).map(e => ({ ...e.snapshot, source: `${stageLabel[e.stage] || e.stage}阶段` })),
    ...(a.match ? [{ ...a.match, matched_at: a.match.computed_at, source: '最新重算' }] : [])
  ].filter(x => Number(x.strategy_id) === vid)
  return pool[pool.length - 1] || null
}
function activeEvidence(a) {
  if (scoreView.value === 'snapshot') return histEvidence(a)
  if (scoreView.value === 'latest') return latestEvidence(a)
  if (scoreView.value === 'version') return versionEvidence(a)
  return eventEvidence(a)
}
function scoreOf(a, kind) {
  const ev = kind === 'hist' ? histEvidence(a) : kind === 'event' ? eventEvidence(a) : latestEvidence(a)
  return ev?.score ?? null
}
function scoreDelta(a, from, to) {
  const f = scoreOf(a, from), t = scoreOf(a, to)
  return f == null || t == null ? null : t - f
}
function evidenceTime(e) {
  return fmtTime(e?.event_at || e?.matched_at || e?.computed_at || '')
}
function jobInfo(id) {
  return store.recalcJobs.find(j => j.id === Number(id)) || null
}
function strategyInfo(id) {
  const vid = Number(id)
  if (!vid) return { weights: store.defaultStrategy.weights, keyword_cap: store.defaultStrategy.keywordCap, published_at: '', published_by: '系统默认' }
  return store.strategyVersions.find(v => v.id === vid) || null
}

const traceApp = computed(() => store.applications.find(a => a.id === traceAppId.value) || null)
const traceEvents = computed(() => {
  if (!traceApp.value) return []
  const rows = evidenceEvents(traceApp.value)
  if (selectedVersion.value === 'all') return rows
  const vid = Number(selectedVersion.value)
  return rows.filter(e => Number(e.snapshot?.strategy_id) === vid)
})
function openTrace(a) {
  traceAppId.value = a.id
}
function weightText(weights = {}) {
  return `技${Math.round((weights.skill ?? 0) * 100)}% · 年限${Math.round((weights.year ?? 0) * 100)}% · 薪${Math.round((weights.salary ?? 0) * 100)}% · 学历${Math.round((weights.edu ?? 0) * 100)}% · 城${Math.round((weights.city ?? 0) * 100)}%`
}
</script>

<template>
  <div class="pipeline">
    <div class="bar">
      <div class="filters">
        <select v-model="filter">
          <option value="all">全部职位</option>
          <option v-for="p in store.openPositions" :key="p.id" :value="p.name">{{ p.name }}</option>
        </select>
        <select v-model="stageFilter">
          <option value="all">全部阶段</option>
          <option v-for="s in stages" :key="s.k" :value="s.k">{{ s.label }}</option>
        </select>
      </div>
      <div class="score-tools">
        <label class="version-filter">
          策略版本
          <select :value="selectedVersion" @change="changeVersion($event.target.value)">
            <option value="all">全部版本</option>
            <option v-for="v in versionOptions" :key="v.id" :value="v.id">{{ v.label }}</option>
          </select>
        </label>
        <div class="score-toggle">
          <span class="muted">评分口径</span>
          <button :class="{ on: scoreView === 'snapshot' }" @click="scoreView = 'snapshot'">🕘 投递时</button>
          <button :class="{ on: scoreView === 'event' }" @click="scoreView = 'event'">🧭 当前阶段</button>
          <button :class="{ on: scoreView === 'latest' }" @click="scoreView = 'latest'">🆕 最新重算</button>
          <button v-if="selectedVersion !== 'all'" :class="{ on: scoreView === 'version' }" @click="scoreView = 'version'">{{ versionTag(selectedVersion) }}</button>
        </div>
      </div>
    </div>

    <div class="consistency card">
      <span>🔒 一致性：策略发布与批量重算、流程推进与阶段快照均在同一事务提交；重算只更新 <b>matches / recalc_items</b>，不会覆盖投递或阶段快照。</span>
    </div>

    <!-- Kanban -->
    <div class="kanban">
      <div class="kcol" v-for="s in stages" :key="s.k">
        <div class="khead" :style="{ borderColor: s.color }">
          <span>{{ s.icon }}</span><b>{{ s.label }}</b>
          <em class="tag">{{ viewList.filter(a => a.stage === s.k).length }}</em>
        </div>
        <div class="kbody">
          <div class="kcard card" v-for="a in viewList.filter(c => c.stage === s.k)" :key="a.id">
            <div class="khead-line">
              <div class="kname">{{ a.candidate }}</div>
              <button class="trace-btn" @click="openTrace(a)">🔗 追溯</button>
            </div>
            <div class="kpos muted">{{ a.position }} · {{ a.dept }}</div>
            <div class="kmatch" v-if="activeEvidence(a)">
              <div class="mscores">
                <span class="msc" :class="[scoreClass(scoreOf(a,'hist')), { dim: scoreView !== 'snapshot' }]" title="投递时评分">{{ scoreOf(a,'hist') ?? '—' }}</span>
                <span class="ms-arrow">→</span>
                <span class="msc" :class="[scoreClass(scoreOf(a,'event')), { dim: scoreView !== 'event' && scoreView !== 'version' }]" title="进入当前阶段时评分">{{ scoreOf(a,'event') ?? '—' }}</span>
                <span class="ms-arrow">→</span>
                <span class="msc" :class="[scoreClass(scoreOf(a,'latest')), { dim: scoreView !== 'latest' && scoreView !== 'version' }]" title="最新重算评分">{{ scoreOf(a,'latest') ?? '—' }}</span>
              </div>
              <div class="minfo">
                <div class="ms-labels">
                  <em :class="{ on: scoreView === 'snapshot' }">投递 {{ versionTag(histEvidence(a)?.strategy_id) }}</em>
                  <em :class="{ on: scoreView === 'event' }">{{ stageLabel[a.stage] }} {{ versionTag(eventEvidence(a)?.strategy_id) }}</em>
                  <em :class="{ on: scoreView === 'latest' }">最新 {{ versionTag(latestEvidence(a)?.strategy_id) }}</em>
                </div>
                <div class="mweak" v-if="activeEvidence(a).weakness && activeEvidence(a).weakness !== '无显著短板'">短板：{{ activeEvidence(a).weakness }}</div>
                <div class="mreason muted">{{ activeEvidence(a).reason || '暂无评分说明' }}</div>
                <div class="mtime muted">
                  <template v-if="scoreView === 'latest'">重算于 {{ evidenceTime(latestEvidence(a)) }}</template>
                  <template v-else-if="scoreView === 'version'">版本回看：{{ activeEvidence(a).source || '评分证据' }} · {{ evidenceTime(activeEvidence(a)) }}</template>
                  <template v-else-if="scoreView === 'snapshot'">投递评于 {{ fmtTime(a.matched_at) }}</template>
                  <template v-else>进入{{ stageLabel[a.stage] }}于 {{ evidenceTime(currentEvent(a)) }}</template>
                </div>
              </div>
            </div>
            <div class="delta-row">
              <span v-if="scoreDelta(a,'hist','event') != null" :class="scoreDelta(a,'hist','event') > 0 ? 'up' : 'down'">
                阶段分差 {{ scoreDelta(a,'hist','event') > 0 ? '+' : '' }}{{ scoreDelta(a,'hist','event') }}
              </span>
              <span v-if="scoreDelta(a,'event','latest') != null" :class="scoreDelta(a,'event','latest') > 0 ? 'up' : 'down'">
                最新分差 {{ scoreDelta(a,'event','latest') > 0 ? '+' : '' }}{{ scoreDelta(a,'event','latest') }}
              </span>
            </div>
            <div class="kskills"><span class="skill-chip" v-for="sk in (a.candSkills||[]).slice(0,4)" :key="sk.k">{{ sk.k }}</span></div>
            <div class="kfoot">
              <span class="muted">{{ a.city }}</span>
              <div class="ka">
                <button v-if="nextStage(a.stage)" class="primary" @click="store.advance(a.id)">→ {{ nextStageLabel(a.stage) }}</button>
                <span v-else class="succ-chip">✅ 已录用</span>
                <button class="danger" v-if="a.stage !== 'hired'" @click="store.reject(a.id)">淘汰</button>
              </div>
            </div>
          </div>
          <div class="muted empty-mini" v-if="!viewList.filter(c => c.stage === s.k).length">暂无</div>
        </div>
      </div>
    </div>

    <!-- 候选人评分追溯抽屉 -->
    <div class="modal" v-if="traceApp" @click.self="traceAppId = null">
      <div class="trace-box card">
        <div class="trace-head">
          <div>
            <h3>🔗 {{ traceApp.candidate }} · {{ traceApp.position }}</h3>
            <div class="muted">{{ traceApp.dept }} · {{ traceApp.city }} · 当前阶段：{{ stageLabel[traceApp.stage] || traceApp.stage }}</div>
          </div>
          <button class="ghost" @click="traceAppId = null">关闭</button>
        </div>

        <div class="trace-filter">
          <label>按策略版本回看
            <select :value="selectedVersion" @change="changeVersion($event.target.value)">
              <option value="all">全部版本</option>
              <option v-for="v in versionOptions" :key="v.id" :value="v.id">{{ v.label }}</option>
            </select>
          </label>
        </div>

        <div class="trace-latest" v-if="traceApp.match">
          <div>
            <b>🆕 最新重算结果 <span class="score-pill" :class="scoreClass(traceApp.match.score)">{{ traceApp.match.score }}</span></b>
            <div class="muted">{{ evidenceTime(traceApp.match) }} · {{ versionTag(traceApp.match.strategy_id) }}</div>
          </div>
          <div class="muted">
            批次 #{{ traceApp.match.recalc_job_id || '—' }}
            <template v-if="jobInfo(traceApp.match.recalc_job_id)">
              · {{ { strategy_publish: '策略发布', manual: '手动重算', startup: '启动迁移' }[jobInfo(traceApp.match.recalc_job_id).trigger_type] || jobInfo(traceApp.match.recalc_job_id).trigger_type }}
            </template>
          </div>
        </div>

        <div class="timeline">
          <div class="trace-event" v-for="e in traceEvents" :key="e.id" :class="{ current: e.stage === traceApp.stage, legacy: e.backfilled }">
            <div class="te-dot">{{ stages.find(s => s.k === e.stage)?.icon || '🏁' }}</div>
            <div class="te-body">
              <div class="te-head">
                <b>{{ stageLabel[e.stage] || e.stage }}</b>
                <span class="ver-tag">{{ versionTag(e.snapshot?.strategy_id) }}</span>
                <span class="job-tag" v-if="e.snapshot?.recalc_job_id">批次 #{{ e.snapshot.recalc_job_id }}</span>
                <span class="backfill-tag" v-if="e.backfilled">补录</span>
                <em class="muted">{{ fmtTime(e.event_at) }}</em>
              </div>
              <div class="te-grid">
                <div class="te-score" :class="scoreClass(e.snapshot?.score)">{{ e.snapshot?.score ?? '—' }}</div>
                <div class="te-detail">
                  <div class="muted">{{ e.snapshot?.reason || '暂无评分说明' }}</div>
                  <div class="te-weak" v-if="e.snapshot?.weakness && e.snapshot.weakness !== '无显著短板'">{{ e.snapshot.weakness }}</div>
                </div>
              </div>
              <div class="dims-line">
                <span v-for="d in (e.snapshot?.dims || [])" :key="d.k">{{ d.k }} <b>{{ d.score }}</b><i>/权重{{ Math.round((d.w || 0) * 100) }}%</i></span>
              </div>
              <div class="strategy-line muted" v-if="strategyInfo(e.snapshot?.strategy_id)">
                {{ weightText(strategyInfo(e.snapshot?.strategy_id).weights) }} · 关键词上限 +{{ e.snapshot?.keyword_cap ?? strategyInfo(e.snapshot?.strategy_id).keyword_cap }}
              </div>
            </div>
          </div>
          <div class="muted empty-mini" v-if="!traceEvents.length">该候选人没有所选策略版本的阶段评分证据。</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pipeline { display: flex; flex-direction: column; gap: 14px; }
.bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.filters, .score-tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.version-filter { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; }
.version-filter select { min-width: 150px; padding: 5px 8px; }
.score-toggle { display: flex; align-items: center; gap: 6px; }
.score-toggle button { padding: 5px 10px; font-size: 12px; opacity: .75; }
.score-toggle button.on { opacity: 1; border-color: var(--accent); background: rgba(91,140,255,.15); color: var(--accent); }
.consistency { padding: 9px 12px; font-size: 12px; color: var(--muted); background: rgba(87,214,160,.07); border-color: rgba(87,214,160,.28); }
.consistency b { color: var(--green); font-weight: 600; margin: 0 2px; }
.kanban { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
@media (max-width: 1200px) { .kanban { grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); } }
.kcol { background: rgba(19,25,44,.6); border-radius: 12px; padding: 10px; border: 1px solid var(--border); }
.khead { display: flex; align-items: center; gap: 8px; padding-bottom: 8px; border-bottom: 2px solid; margin-bottom: 10px; }
.khead b { font-size: 14px; }
.khead .tag { margin-left: auto; }
.kbody { display: flex; flex-direction: column; gap: 10px; min-height: 60px; }
.kcard { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.khead-line { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.kname { font-weight: 700; font-size: 14px; }
.trace-btn { padding: 3px 7px; font-size: 11px; }
.kpos { font-size: 12px; }
.kskills { display: flex; flex-wrap: wrap; }
.kmatch { display: flex; gap: 8px; align-items: flex-start; background: var(--panel2); border-radius: 8px; padding: 7px 8px; }
.kmatch .mscores { display: flex; align-items: center; gap: 3px; flex-shrink: 0; }
.kmatch .msc { min-width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 13px; }
.kmatch .msc.dim { opacity: .32; filter: grayscale(.6); }
.ms-arrow { color: var(--muted); font-size: 10px; }
.minfo { min-width: 0; display: flex; flex-direction: column; gap: 2px; flex: 1; }
.ms-labels { display: flex; gap: 7px; font-size: 10px; color: var(--muted); flex-wrap: wrap; }
.ms-labels em { font-style: normal; opacity: .6; }
.ms-labels em.on { opacity: 1; color: var(--accent); font-weight: 700; }
.delta-row { display: flex; gap: 8px; font-size: 11px; font-weight: 700; }
.delta-row .up { color: var(--green); }
.delta-row .down { color: var(--red); }
.mweak { font-size: 11px; color: var(--red); }
.mreason { font-size: 10.5px; line-height: 1.4; word-break: break-all; }
.mtime { font-size: 10px; opacity: .75; }
.kfoot { display: flex; flex-direction: column; gap: 8px; }
.ka { display: flex; gap: 6px; flex-wrap: wrap; }
.ka button { font-size: 11px; padding: 4px 8px; }
.succ-chip { color: var(--green); font-size: 12px; }
.empty-mini { font-size: 12px; padding: 10px; text-align: center; }
.modal { position: fixed; inset: 0; background: rgba(4,8,18,.68); z-index: 50; display: flex; justify-content: flex-end; }
.trace-box { width: min(680px, 100%); height: 100%; border-radius: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
.trace-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.trace-filter label { display: flex; gap: 8px; align-items: center; color: var(--muted); font-size: 13px; }
.trace-filter select { min-width: 220px; }
.trace-latest { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 10px 12px; background: rgba(91,140,255,.08); border: 1px solid rgba(91,140,255,.25); border-radius: 10px; font-size: 13px; }
.score-pill { padding: 2px 8px; border-radius: 10px; margin-left: 6px; }
.timeline { display: flex; flex-direction: column; gap: 12px; }
.trace-event { display: flex; gap: 10px; position: relative; }
.trace-event:not(:last-child)::before { content: ''; position: absolute; left: 17px; top: 38px; bottom: -14px; width: 2px; background: var(--border); }
.te-dot { width: 36px; height: 36px; border-radius: 50%; background: var(--panel2); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; z-index: 1; flex-shrink: 0; }
.trace-event.current .te-dot { border-color: var(--green); box-shadow: 0 0 0 3px rgba(87,214,160,.12); }
.trace-event.legacy { opacity: .86; }
.te-body { flex: 1; min-width: 0; background: var(--panel2); border: 1px solid var(--border); border-radius: 10px; padding: 10px; }
.trace-event.current .te-body { border-color: rgba(87,214,160,.35); }
.te-head { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-bottom: 8px; }
.te-head em { margin-left: auto; font-style: normal; font-size: 11px; }
.ver-tag, .job-tag, .backfill-tag { border-radius: 10px; padding: 2px 7px; font-size: 10px; border: 1px solid var(--border); color: var(--muted); }
.ver-tag { color: var(--purple); border-color: rgba(167,139,250,.35); background: rgba(167,139,250,.1); }
.backfill-tag { color: var(--accent2); border-color: rgba(255,209,102,.35); background: rgba(255,209,102,.1); }
.te-grid { display: grid; grid-template-columns: 54px 1fr; gap: 10px; align-items: start; }
.te-score { width: 48px; height: 48px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 900; }
.te-weak { color: var(--red); font-size: 12px; margin-top: 3px; }
.dims-line { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; font-size: 11px; color: var(--muted); }
.dims-line b { color: var(--text); margin: 0 2px; }
.dims-line i { font-style: normal; opacity: .7; }
.strategy-line { margin-top: 7px; font-size: 10.5px; }
</style>
