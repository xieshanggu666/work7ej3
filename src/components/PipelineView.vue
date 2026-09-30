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
const STAGE_META = {
  submitted: { label: '投递', icon: '📥', color: '#5b8cff' },
  screening: { label: '筛选', icon: '🔍', color: '#a78bfa' },
  interview: { label: '面试', icon: '💬', color: '#4fc3f7' },
  offer: { label: 'Offer', icon: '📄', color: '#ffd166' },
  hired: { label: '录用', icon: '🎉', color: '#57d6a0' },
  rejected: { label: '淘汰', icon: '🚫', color: '#ef6b6b' }
}
const STAGE_ORDER = { submitted: 0, screening: 1, interview: 2, offer: 3, hired: 4, rejected: 5 }

const filter = ref('all')
const stageFilter = ref('all')
// scoreView: snapshot=投递时锁定的历史评分(默认), latest=按最新策略重算的结果
const scoreView = ref('snapshot')

const list = computed(() => store.applications.filter(a => a.stage !== 'rejected'))
const viewList = computed(() => list.value.filter(a =>
  (stageFilter.value === 'all' || a.stage === stageFilter.value) &&
  (filter.value === 'all' || a.position === filter.value)
))

const nextStage = s => ({ submitted: 'screening', screening: 'interview', interview: 'offer', offer: 'hired' }[s])
const nextStageLabel = s => ({ screening: '筛选', interview: '面试', offer: 'Offer' }[s] || '')

// 历史评分优先取投递快照；兼容升级前的旧记录（无快照）回退到当前最新分
function histScore(a) { return a.matchSnapshot?.score ?? a.match?.score ?? null }
function latestScore(a) { return a.match?.score ?? a.matchSnapshot?.score ?? null }
function activeMatch(a) {
  if (scoreView.value === 'latest') return a.match || a.matchSnapshot
  return a.matchSnapshot || a.match
}
function scoreDelta(a) {
  const h = histScore(a), l = latestScore(a)
  return h == null || l == null ? null : l - h
}
const fmtTime = t => t ? String(t).replace('T', ' ').slice(0, 16) : ''

// 当前评分口径对应的策略版本号（卡片角标用）
function activeStrategyId(a) {
  const m = activeMatch(a)
  if (!m) return null
  // 快照上带 strategy_id；最新结果在 a.match 上
  if (scoreView.value === 'latest') return a.match?.strategy_id ?? m.strategy_id ?? null
  return a.matchSnapshot?.strategy_id ?? m.strategy_id ?? null
}
const versionTag = id => id === 0 || id == null ? '默认策略' : `v${id}`

// ---------------- 评分依据轨迹（按阶段 + 按策略版本回看） ----------------
const traceApp = ref(null)
const versionFilter = ref('all')

function openTrace(a) {
  traceApp.value = a
  versionFilter.value = 'all'
}
function closeTrace() { traceApp.value = null }

// 该职位发布过的策略版本（含系统默认 v0）
const versionMap = computed(() => {
  const map = new Map(store.strategyVersions.map(v => [v.id, v]))
  map.set(0, { id: 0, default: true })
  return map
})
function versionInfo(id) { return versionMap.value.get(id) || null }
function versionText(id) {
  if (!id) return '系统默认策略'
  const v = versionInfo(id)
  return v ? `策略 v${id}（${fmtTime(v.published_at)} 发布）` : `策略 v${id}`
}
function weightText(w) {
  w = w || {}
  return `技${Math.round((w.skill ?? 0) * 100)}% · 年限${Math.round((w.year ?? 0) * 100)}% · 薪${Math.round((w.salary ?? 0) * 100)}% · 学历${Math.round((w.edu ?? 0) * 100)}% · 城${Math.round((w.city ?? 0) * 100)}%`
}

// 轨迹弹窗内出现过的策略版本（已固化事件 + 最新结果），供下拉过滤
const traceVersionOptions = computed(() => {
  if (!traceApp.value) return []
  const ids = new Set()
  ;(traceApp.value.stageEvents || []).forEach(e => ids.add(e.strategy_id || 0))
  if (traceApp.value.match) ids.add(traceApp.value.match.strategy_id || 0)
  return [...ids].sort((x, y) => x - y)
})
const traceEvents = computed(() => {
  if (!traceApp.value) return []
  const evs = [...(traceApp.value.stageEvents || [])].sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || a.id - b.id)
  if (versionFilter.value === 'all') return evs
  return evs.filter(e => String(e.strategy_id || 0) === String(versionFilter.value))
})
// 最新重算结果作为「未固化」条目单独展示，便于与各阶段锁定依据对比
const traceLatest = computed(() => {
  if (!traceApp.value?.match) return null
  if (versionFilter.value === 'all') return traceApp.value.match
  return String(traceApp.value.match.strategy_id || 0) === String(versionFilter.value) ? traceApp.value.match : null
})
const basisLabel = { latest: '进入阶段时锁定', snapshot: '投递时锁定', legacy: '历史补录' }
const scoreCls = s => s >= 75 ? 's-hi' : s >= 55 ? 's-mid' : 's-lo'
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
      <div class="score-toggle">
        <span class="muted">评分口径</span>
        <button :class="{ on: scoreView === 'snapshot' }" @click="scoreView = 'snapshot'">🕘 投递时评分</button>
        <button :class="{ on: scoreView === 'latest' }" @click="scoreView = 'latest'">🆕 最新结果</button>
      </div>
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
            <div class="kname">{{ a.candidate }}</div>
            <div class="kpos muted">{{ a.position }} · {{ a.dept }}</div>
            <div class="kmatch" v-if="activeMatch(a)">
              <div class="mscores">
                <span class="msc" :class="[histScore(a) >= 75 ? 's-hi' : histScore(a) >= 55 ? 's-mid' : 's-lo', { dim: scoreView === 'latest' }]">{{ histScore(a) }}</span>
                <span class="ms-arrow">→</span>
                <span class="msc" :class="[latestScore(a) >= 75 ? 's-hi' : latestScore(a) >= 55 ? 's-mid' : 's-lo', { dim: scoreView === 'snapshot' }]">{{ latestScore(a) }}</span>
              </div>
              <div class="minfo">
                <div class="ms-labels">
                  <em :class="{ on: scoreView === 'snapshot' }">🕘 投递时{{ a.matchSnapshot?.backfilled ? '（补录）' : '' }}</em>
                  <em :class="{ on: scoreView === 'latest' }">
                    🆕 最新<span class="delta" v-if="scoreDelta(a)" :class="scoreDelta(a) > 0 ? 'up' : 'down'">
                      {{ scoreDelta(a) > 0 ? '+' : '' }}{{ scoreDelta(a) }}
                    </span>
                  </em>
                </div>
                <div class="mweak" v-if="activeMatch(a).weakness && activeMatch(a).weakness !== '无显著短板'">短板：{{ activeMatch(a).weakness }}</div>
                <div class="mreason muted">{{ activeMatch(a).reason }}</div>
                <div class="mtime muted">
                  ⚖️ {{ versionTag(activeStrategyId(a)) }} ·
                  {{ scoreView === 'latest' ? '重算于 ' + fmtTime(a.match?.computed_at) : '评于 ' + fmtTime(a.matched_at) }}
                </div>
              </div>
            </div>
            <div class="kskills"><span class="skill-chip" v-for="sk in (a.candSkills||[]).slice(0,4)" :key="sk.k">{{ sk.k }}</span></div>
            <div class="kfoot">
              <span class="muted">{{ a.city }} · {{ (a.stageEvents || []).filter(e => e.stage !== 'rejected').length }} 个阶段留痕</span>
              <div class="ka">
                <button class="ghost" @click="openTrace(a)">🧭 评分轨迹</button>
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

    <!-- 评分依据轨迹：按阶段回看、按策略版本过滤 -->
    <div class="modal" v-if="traceApp" @click.self="closeTrace">
      <div class="trace-box card">
        <div class="trace-head">
          <h3>🧭 评分依据轨迹 · {{ traceApp.candidate }}</h3>
          <button class="x" @click="closeTrace">✕</button>
        </div>
        <div class="trace-sub muted">
          {{ traceApp.position }} · {{ traceApp.dept }} · 当前阶段「{{ STAGE_META[traceApp.stage]?.label || traceApp.stage }}」
        </div>
        <div class="trace-filter">
          <span class="muted">策略版本：</span>
          <select v-model="versionFilter">
            <option value="all">全部版本（{{ traceVersionOptions.length }}）</option>
            <option v-for="id in traceVersionOptions" :key="id" :value="String(id)">
              {{ id === 0 ? '系统默认策略' : `策略 v${id}` }}
            </option>
          </select>
          <span class="muted tip">仅显示用所选版本评分并固化的阶段依据</span>
        </div>

        <div class="trace-timeline">
          <div class="t-event" v-for="e in traceEvents" :key="e.id">
            <div class="te-dot" :style="{ background: STAGE_META[e.stage]?.color || '#8c91b0' }">
              {{ STAGE_META[e.stage]?.icon || '•' }}
            </div>
            <div class="te-body">
              <div class="te-top">
                <b>进入{{ STAGE_META[e.stage]?.label || e.stage }}阶段</b>
                <span class="ver-chip" :class="{ def: !e.strategy_id, bf: e.backfilled }">{{ versionTag(e.strategy_id) }}</span>
                <span class="basis-tag" :class="e.basis">{{ basisLabel[e.basis] || '锁定' }}</span>
                <span class="te-score" :class="scoreCls(e.score)">{{ e.score }}</span>
                <span class="muted te-time">{{ fmtTime(e.created) }}</span>
              </div>
              <div class="te-dims">
                <div v-for="d in e.dims" :key="d.k" class="dim">
                  <span>{{ d.k }}<em class="dw">{{ Math.round((d.w || 0) * 100) }}%</em></span>
                  <div class="bar"><i :style="{ width: d.score + '%', background: d.score >= 75 ? 'var(--green)' : d.score >= 55 ? 'var(--accent2)' : 'var(--red)' }"></i></div>
                  <b>{{ d.score }}</b>
                </div>
              </div>
              <div class="te-meta">
                <span class="muted">权重：{{ weightText(e.weights) }} · 关键词+{{ e.keyword_cap }}</span>
              </div>
              <div class="te-weak" v-if="e.weakness && e.weakness !== '无显著短板'">短板：{{ e.weakness }}</div>
              <div class="muted te-reason">{{ e.reason }}</div>
              <div class="te-ver muted" v-if="e.strategy_id">{{ versionText(e.strategy_id) }}</div>
            </div>
          </div>

          <div class="t-event latest" v-if="traceLatest">
            <div class="te-dot latest-dot">🆕</div>
            <div class="te-body">
              <div class="te-top">
                <b>当前最新结果（未固化，重算/发布策略后会变化）</b>
                <span class="ver-chip" :class="{ def: !traceLatest.strategy_id }">{{ versionTag(traceLatest.strategy_id) }}</span>
                <span class="te-score" :class="scoreCls(traceLatest.score)">{{ traceLatest.score }}</span>
                <span class="muted te-time">重算于 {{ fmtTime(traceLatest.computed_at) }}</span>
              </div>
              <div class="te-dims">
                <div v-for="d in traceLatest.dims" :key="d.k" class="dim">
                  <span>{{ d.k }}<em class="dw">{{ Math.round((d.w || 0) * 100) }}%</em></span>
                  <div class="bar"><i :style="{ width: d.score + '%', background: d.score >= 75 ? 'var(--green)' : d.score >= 55 ? 'var(--accent2)' : 'var(--red)' }"></i></div>
                  <b>{{ d.score }}</b>
                </div>
              </div>
              <div class="te-weak" v-if="traceLatest.weakness && traceLatest.weakness !== '无显著短板'">短板：{{ traceLatest.weakness }}</div>
              <div class="muted te-reason">{{ traceLatest.reason }}</div>
            </div>
          </div>

          <div class="muted empty-mini" v-if="!traceEvents.length && !traceLatest">该版本下暂无评分记录</div>
        </div>
        <div class="trace-foot muted">
          每次推进阶段都会在同一事务内锁定当时的评分依据与策略版本；批量重算只刷新「最新结果」，已固化的阶段依据不会改变。
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pipeline { display: flex; flex-direction: column; gap: 14px; }
.bar { display: flex; justify-content: space-between; align-items: center; }
.filters { display: flex; gap: 8px; }
.score-toggle { display: flex; align-items: center; gap: 6px; }
.score-toggle button { padding: 5px 10px; font-size: 12px; opacity: .75; }
.score-toggle button.on { opacity: 1; border-color: var(--accent); background: rgba(91,140,255,.15); color: var(--accent); }
.kanban { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
@media (max-width: 1100px) { .kanban { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); } }
.kcol { background: rgba(19,25,44,.6); border-radius: 12px; padding: 10px; border: 1px solid var(--border); }
.khead { display: flex; align-items: center; gap: 8px; padding-bottom: 8px; border-bottom: 2px solid; margin-bottom: 10px; }
.khead b { font-size: 14px; }
.khead .tag { margin-left: auto; }
.kbody { display: flex; flex-direction: column; gap: 10px; min-height: 60px; }
.kcard { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.kname { font-weight: 700; font-size: 14px; }
.kpos { font-size: 12px; }
.kskills { display: flex; flex-wrap: wrap; }
.kmatch { display: flex; gap: 8px; align-items: flex-start; background: var(--panel2); border-radius: 8px; padding: 6px 8px; }
.kmatch .mscores { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.kmatch .msc { min-width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; }
.kmatch .msc.dim { opacity: .35; filter: grayscale(.6); }
.ms-arrow { color: var(--muted); font-size: 11px; }
.minfo { min-width: 0; display: flex; flex-direction: column; gap: 2px; flex: 1; }
.ms-labels { display: flex; gap: 10px; font-size: 10.5px; color: var(--muted); }
.ms-labels em { font-style: normal; opacity: .6; }
.ms-labels em.on { opacity: 1; color: var(--accent); font-weight: 700; }
.delta { font-weight: 700; font-style: normal; margin-left: 2px; }
.delta.up { color: var(--green); }
.delta.down { color: var(--red); }
.mweak { font-size: 11px; color: var(--red); }
.mreason { font-size: 10.5px; line-height: 1.4; word-break: break-all; }
.mtime { font-size: 10px; opacity: .7; }
.kfoot { display: flex; flex-direction: column; gap: 8px; }
.ka { display: flex; gap: 6px; flex-wrap: wrap; }
.ka button { font-size: 11px; padding: 4px 8px; }
.succ-chip { color: var(--green); font-size: 12px; }
.empty-mini { font-size: 12px; padding: 10px; text-align: center; }

/* 轨迹弹窗 */
.trace-box { width: min(760px, 94vw); max-height: 86vh; overflow-y: auto; padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; }
.trace-head { display: flex; align-items: center; justify-content: space-between; }
.trace-head h3 { font-size: 16px; }
.trace-head .x { background: none; border: none; color: var(--muted); font-size: 14px; cursor: pointer; }
.trace-sub { font-size: 12px; margin-top: -6px; }
.trace-filter { display: flex; align-items: center; gap: 8px; font-size: 12px; flex-wrap: wrap; }
.trace-filter select { min-width: 180px; }
.trace-filter .tip { font-size: 11px; }
.trace-timeline { display: flex; flex-direction: column; gap: 0; }
.t-event { display: flex; gap: 10px; position: relative; padding-bottom: 14px; }
.t-event:not(:last-child)::before { content: ''; position: absolute; left: 15px; top: 32px; bottom: 0; width: 2px; background: var(--border); }
.te-dot { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 14px; z-index: 1; }
.te-dot.latest-dot { background: var(--panel2); border: 1px dashed var(--accent2); }
.te-body { flex: 1; min-width: 0; background: var(--panel2); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.t-event.latest .te-body { border-style: dashed; border-color: rgba(255,209,102,.5); background: rgba(255,209,102,.05); }
.te-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.te-top b { font-size: 13px; }
.te-time { font-size: 11px; margin-left: auto; }
.te-score { font-size: 18px; font-weight: 800; min-width: 30px; text-align: right; }
.ver-chip { font-size: 10px; padding: 1px 7px; border-radius: 9px; background: rgba(91,140,255,.16); color: var(--accent); border: 1px solid rgba(91,140,255,.35); font-style: normal; }
.ver-chip.def { background: var(--panel); color: var(--muted); border-color: var(--border); }
.ver-chip.bf { background: rgba(255,209,102,.14); color: #ffd166; border-color: rgba(255,209,102,.4); }
.basis-tag { font-size: 10px; padding: 1px 7px; border-radius: 9px; background: rgba(87,214,160,.14); color: var(--green); border: 1px solid rgba(87,214,160,.35); }
.basis-tag.snapshot { color: var(--accent); background: rgba(91,140,255,.14); border-color: rgba(91,140,255,.35); }
.basis-tag.legacy { color: #ffd166; background: rgba(255,209,102,.12); border-color: rgba(255,209,102,.35); }
.te-dims { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; }
.dim { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); }
.dim span { width: 78px; display: flex; justify-content: space-between; }
.dim .dw { opacity: .7; font-style: normal; }
.dim .bar { flex: 1; height: 6px; background: var(--panel); border-radius: 4px; overflow: hidden; }
.dim .bar i { display: block; height: 100%; }
.dim b { width: 24px; text-align: right; color: var(--text); }
.te-meta { font-size: 11px; }
.te-weak { font-size: 11px; color: var(--red); }
.te-reason { font-size: 11px; line-height: 1.5; }
.te-ver { font-size: 10.5px; }
.trace-foot { font-size: 11px; line-height: 1.6; border-top: 1px solid var(--border); padding-top: 10px; }
</style>
