<script setup>
import { computed, ref } from 'vue'
import { useHrStore } from '@/store/hr'

const store = useHrStore()
const detail = ref(null)
const offerAmt = ref(20000)

const offerApps = computed(() => store.applications.filter(a => a.stage === 'offer' && !a.offer))
const offerList = computed(() => store.applications.filter(a => a.offer))

function openMake(a) { detail.value = a; offerAmt.value = Math.round((a.position ? salaryRange(a.position) : 22000)) }
function salaryRange(name) {
  const p = store.positions.find(p => `${p.name}` === name)
  return p ? (p.salary_min + p.salary_max) / 2 : 22000
}
function makeOffer() { store.addOffer(detail.value.id, { salary: offerAmt.value }); detail.value = null }

const ofStatus = s => ({
  pending: ['⏳', '待回应', 'var(--accent2)'], accepted: ['✅', '已接受', 'var(--green)'],
  rejected: ['❌', '已拒绝', 'var(--red)'], joined: ['🎉', '已入职', 'var(--green)']
}[s] || ['⏳', '待回应'])
</script>

<template>
  <div class="offer">
    <div class="two">
      <div class="card">
        <h3>📤 待发 Offer <span class="tag">{{ offerApps.length }}</span></h3>
        <div class="olist">
          <div class="ocard" v-for="a in offerApps" :key="a.id">
            <div><b>{{ a.candidate }}</b><em class="muted">{{ a.position }}</em></div>
            <div class="muted">{{ a.city }}</div>
            <button class="primary" @click="openMake(a)">发起 Offer</button>
          </div>
          <div class="muted empty" v-if="!offerApps.length">当前无待发 Offer，先在「招聘流程」推进候选人至 Offer 阶段。</div>
        </div>
      </div>

      <div class="card">
        <h3>💼 Offer 记录 <span class="tag">{{ offerList.length }}</span></h3>
        <div class="olist">
          <div class="ocard" v-for="a in offerList" :key="a.id">
            <div><b>{{ a.candidate }}</b><em class="muted">{{ a.position }}</em></div>
            <div class="money">¥{{ a.offer.salary.toLocaleString() }}<em class="muted">/月</em></div>
            <div class="op-acts">
              <span class="ostatus" :style="{ color: ofStatus(a.offer.status)[1], borderColor: ofStatus(a.offer.status)[1] }">{{ ofStatus(a.offer.status)[1] }}</span>
              <button v-if="a.offer.status === 'pending'" class="succ" @click="store.setOffer(a.offer.id, 'accepted')">接受</button>
              <button v-if="a.offer.status === 'accepted'" class="primary" @click="store.setOffer(a.offer.id, 'joined')">入职</button>
              <button v-if="a.offer.status === 'pending'" class="danger" @click="store.setOffer(a.offer.id, 'rejected')">拒绝</button>
            </div>
          </div>
          <div class="muted empty" v-if="!offerList.length">暂无 Offer 记录。</div>
        </div>
      </div>
    </div>

    <div class="modal" v-if="detail">
      <div class="modal-box card">
        <h3>📄 发起 Offer</h3>
        <div class="ofinfo">
          <div><span class="muted">候选人</span><b>{{ detail.candidate }}</b></div>
          <div><span class="muted">职位</span><b>{{ detail.position }} · {{ detail.dept }}</b></div>
          <div><span class="muted">阶段</span><b>Offer 沟通</b></div>
        </div>
        <label class="muted">Offer 月薪</label>
        <div class="sal-input">
          <input type="number" v-model.number="offerAmt" />
          <span class="muted">¥/月</span>
        </div>
        <div class="acts">
          <button class="primary" @click="makeOffer">确认发送</button>
          <button class="ghost" @click="detail = null">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.offer { display: flex; flex-direction: column; gap: 16px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 900px) { .two { grid-template-columns: 1fr; } }
.olist { display: flex; flex-direction: column; gap: 10px; }
.ocard { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px; border: 1px solid var(--border); border-radius: 10px; flex-wrap: wrap; }
.ocard b { display: block; }
.ocard em { font-style: normal; font-size: 11px; }
.op-acts { display: flex; gap: 6px; align-items: center; }
.ostatus { font-size: 11px; border: 1px solid; padding: 2px 8px; border-radius: 10px; }
.ofinfo { display: flex; flex-direction: column; gap: 8px; margin: 14px 0; }
.ofinfo div { display: flex; justify-content: space-between; }
.sal-input { display: flex; align-items: center; gap: 8px; margin: 8px 0 14px; }
.sal-input input { flex: 1; font-size: 18px; padding: 10px; }
</style>