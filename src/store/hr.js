import { defineStore } from 'pinia'

const BASE = '/api'
async function j(method, path, body) {
  const opt = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opt.body = JSON.stringify(body)
  const r = await fetch(BASE + path, opt)
  return r.json()
}

export const useHrStore = defineStore('hr', {
  state: () => ({
    data: null,
    loaded: false
  }),
  getters: {
    positions: s => s.data?.positions || [],
    candidates: s => s.data?.candidates || [],
    applications: s => s.data?.applications || [],
    interviews: s => s.data?.interviews || [],
    offers: s => s.data?.offers || [],
    channels: s => s.data?.channels || [],
    matches: s => s.data?.matches || [],
    strategyVersions: s => s.data?.strategyVersions || [],
    defaultStrategy: s => s.data?.defaultStrategy || { weights: { skill: 0.4, year: 0.2, salary: 0.15, edu: 0.15, city: 0.1 }, keywordCap: 5 },
    openPositions: s => (s.data?.positions || []).filter(p => p.status === 'open')
  },
  actions: {
    async refresh() {
      this.data = await j('GET', '/state')
      this.loaded = true
    },
    async api(method, path, body) {
      const r = await j(method, path, body)
      await this.refresh()
      return r
    },
    async matchPos(pid) { return j('GET', `/match/pos/${pid}`) },
    async matchCand(cid) { return j('GET', `/match/cand/${cid}`) },
    async summary() { return j('GET', '/summary') },
    async getStrategy(pid) { return j('GET', `/positions/${pid}/strategy`) },
    publishStrategy(pid, payload) { return this.api('POST', `/positions/${pid}/strategy`, payload) },
    recomputeAll(positionId) {
      return this.api('POST', '/match/recompute', positionId ? { position_id: positionId } : {})
    },
    addPosition(p) { return this.api('POST', '/positions', p) },
    updatePosition(id, p) { return this.api('POST', `/positions/${id}`, p) },
    addCandidate(c) { return this.api('POST', '/candidates', c) },
    delCandidate(id) { return this.api('DELETE', `/candidates/${id}`) },
    apply(pid, cid) { return this.api('POST', '/applications', { position_id: pid, candidate_id: cid }) },
    advance(id) { return this.api('POST', `/applications/${id}/advance`, {}) },
    reject(id) { return this.api('POST', `/applications/${id}/reject`, {}) },
    addInterview(id, p) { return this.api('POST', `/applications/${id}/interview`, p) },
    setInterview(ivId, p) { return this.api('POST', `/interviews/${ivId}`, p) },
    addOffer(id, p) { return this.api('POST', `/applications/${id}/offer`, p) },
    setOffer(ofId, status) { return this.api('POST', `/offers/${ofId}`, { status }) }
  }
})