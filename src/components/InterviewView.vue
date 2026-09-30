<script setup>
import { computed, ref } from 'vue'
import { useHrStore } from '@/store/hr'

const store = useHrStore()
const roundFilter = ref('all')
const detail = ref(null) // application pipline row

const interviewApps = computed(() => store.applications.filter(a => a.stage === 'interview'))
const list = computed(() => interviewApps.value.filter(a =>
  roundFilter.value === 'all' || a.interviews.some(i => i.round === roundFilter.value)
))

function openDetail(a) { detail.value = a }

const ivResult = r => ({
  pending: ['⏳', '未评'], pass: ['✅', '通过'], fail: ['❌', '不通过']
}[r] || ['⏳', '未评'])
</script>

<template>
  <div class="interview">
    <div class="bar">
      <span class="muted">面试中应聘 {{ interviewApps.length }} 份</span>
    </div>

    <div class="ilist">
      <div class="icard card" v-for="a in list" :key="a.id" @click="openDetail(a)">
        <div class="ihead">
          <b>{{ a.candidate }}</b>
          <span class="tag">{{ a.position }}</span>
        </div>
        <div class="isub muted">{{ a.interviews.length ? a.interviews[a.interviews.length - 1].round : '待安排' }} · 面试官 {{ a.interviews.length ? a.interviews[a.interviews.length-1].interviewer : '-' }}</div>
        <div class="irounds">
          <div v-for="iv in a.interviews" :key="iv.id" class="iround">
            <span class="rtag">{{ iv.round }}</span>
            <span class="rres" :class="iv.result">{{ ivResult(iv.result)[1] }}</span>
          </div>
          <div v-if="!a.interviews.length" class="muted">尚未安排面试</div>
        </div>
      </div>
      <div class="card empty" v-if="!list.length">当前无面试中的候选人。</div>
    </div>

    <!-- 面试详情 -->
    <div class="modal" v-if="detail">
      <div class="modal-box wide card">
        <h3>💬 面试管理 · {{ detail.candidate }} <span class="tag">{{ detail.position }}</span></h3>
        <div class="iv-list">
          <div class="iv-item card" v-for="iv in detail.interviews" :key="iv.id">
            <div class="ivtop">
              <span class="rtag">{{ iv.round }}</span>
              <input v-model="iv.interviewer" placeholder="面试官姓名" @change="store.setInterview(iv.id, { eval: iv.eval })" />
              <div class="ivres">
                <button class="succ" :class="{ on: iv.result === 'pass' }" @click="store.setInterview(iv.id, { result: 'pass' })">通过</button>
                <button class="danger" :class="{ on: iv.result === 'fail' }" @click="store.setInterview(iv.id, { result: 'fail' })">不通过</button>
                <button class="ghost" :class="{ on: iv.result === 'pending' }" @click="store.setInterview(iv.id, { result: 'pending' })">待定</button>
              </div>
            </div>
            <textarea v-model="iv.eval" placeholder="填写面试评价……" rows="2" @change="store.setInterview(iv.id, { eval: iv.eval })"></textarea>
            <div class="muted" v-if="iv.id === (detail.interviews[detail.interviews.length-1]?.id)">这是最后一轮评价，可返回招聘流程推进候选人。</div>
          </div>
        </div>
        <div class="acts">
          <button class="primary" @click="store.addInterview(detail.id, { round: '复试', interviewer: '面试官', time: '待定' })">＋ 添加复试/下一轮</button>
          <button class="ghost" @click="detail = null">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.interview { display: flex; flex-direction: column; gap: 14px; }
.bar { display: flex; }
.ilist { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
.icard { cursor: pointer; transition: .18s; }
.icard:hover { border-color: var(--accent); transform: translateY(-2px); }
.ihead { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
.ihead b { font-size: 15px; }
.isub { font-size: 12px; margin: 6px 0; }
.irounds { display: flex; flex-direction: column; gap: 6px; }
.iround { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.rtag { font-size: 11px; background: var(--panel2); border: 1px solid var(--border); padding: 2px 8px; border-radius: 10px; }
.rres.pass { color: var(--green); }
.rres.fail { color: var(--red); }
.iv-list { display: flex; flex-direction: column; gap: 12px; margin: 14px 0; }
.iv-item { border-color: var(--border); }
.ivtop { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.ivtop input { flex: 1; min-width: 140px; }
.ivres { display: flex; gap: 6px; margin-left: auto; }
.ivres button.on.succ { background: var(--green); color: #06231a; }
.ivres button.on.danger { background: var(--red); color: #fff; }
textarea { width: 100%; background: #101731; border: 1px solid var(--border); border-radius: 8px; color: var(--text); padding: 8px; font-size: 13px; font-family: inherit; resize: vertical; }
</style>