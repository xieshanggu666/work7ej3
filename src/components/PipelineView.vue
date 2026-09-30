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
                  {{ scoreView === 'latest' ? '重算于 ' + fmtTime(a.match?.computed_at) : '评于 ' + fmtTime(a.matched_at) }}
                </div>
              </div>
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
</style>