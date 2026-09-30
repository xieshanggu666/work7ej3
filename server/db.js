import { DatabaseSync } from 'node:sqlite'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const db = new DatabaseSync(join(__dirname, 'hr.db'))

db.exec(`
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  dept TEXT NOT NULL,
  city TEXT NOT NULL,
  level TEXT NOT NULL,
  salary_min INTEGER NOT NULL,
  salary_max INTEGER NOT NULL,
  skills TEXT NOT NULL DEFAULT '[]',   -- [{k:"Vue",w:5}] 技能权重
  years INTEGER NOT NULL DEFAULT 2,
  slots INTEGER NOT NULL DEFAULT 1,    -- 编制
  status TEXT NOT NULL DEFAULT 'open', -- open/closed
  created TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  skills TEXT NOT NULL DEFAULT '[]',   -- [{k:"Vue",idx:5}] 技能及熟练度
  years INTEGER NOT NULL DEFAULT 0,
  edu TEXT NOT NULL DEFAULT '本科',
  school TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  exp_salary INTEGER NOT NULL DEFAULT 0,
  channel TEXT NOT NULL DEFAULT '内推',
  raw TEXT NOT NULL DEFAULT ''        -- 解析出的简历文本
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL,
  position_id INTEGER NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  dims TEXT NOT NULL DEFAULT '[]',   -- [{k:"技能",score:80,w:0.4}]
  reason TEXT NOT NULL DEFAULT '',
  weakness TEXT NOT NULL DEFAULT '',
  computed_at TEXT NOT NULL DEFAULT '',  -- 最近一次按策略重算的时间（最新结果）
  strategy_id INTEGER NOT NULL DEFAULT 0 -- 重算时使用的策略版本（0=系统默认/历史数据）
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id INTEGER NOT NULL,
  candidate_id INTEGER NOT NULL,
  stage TEXT NOT NULL DEFAULT 'submitted', -- submitted/screening/interview/offer/hired/rejected
  updated TEXT NOT NULL,
  recruiter TEXT NOT NULL DEFAULT '',
  match_snapshot TEXT NOT NULL DEFAULT '', -- 投递时的评分依据快照（永不随重算改变）
  matched_at TEXT NOT NULL DEFAULT ''      -- 快照评分时间
);

-- 每个职位独立发布的人岗匹配策略（无记录=使用系统默认五维权重）
CREATE TABLE IF NOT EXISTS match_strategies (
  position_id INTEGER PRIMARY KEY,
  weights TEXT NOT NULL DEFAULT '{}', -- {skill,year,salary,edu,city} 归一化后合计为1
  keyword_cap INTEGER NOT NULL DEFAULT 5, -- 简历关键词加分上限（0=关闭）
  published_at TEXT NOT NULL DEFAULT '',
  published_by TEXT NOT NULL DEFAULT ''
);

-- 策略发布留痕，支持追溯每次重算所依据的版本
CREATE TABLE IF NOT EXISTS strategy_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id INTEGER NOT NULL,
  weights TEXT NOT NULL DEFAULT '{}',
  keyword_cap INTEGER NOT NULL DEFAULT 5,
  published_at TEXT NOT NULL DEFAULT '',
  published_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_strategy_versions_pos ON strategy_versions(position_id);

CREATE TABLE IF NOT EXISTS interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL,
  interviewer TEXT NOT NULL DEFAULT '',
  time TEXT NOT NULL DEFAULT '',
  round TEXT NOT NULL DEFAULT '初试',
  eval TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT 'pending' -- pass/fail/pending
);

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL,
  salary INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', -- pending/accepted/rejected/joined
  due TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  cost INTEGER NOT NULL DEFAULT 0
);
`)

// ---------------- 兼容已有库：补列迁移 ----------------
function hasColumn(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)
}
function addColumn(table, col, ddl) {
  if (!hasColumn(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`)
}
addColumn('matches', 'computed_at', `TEXT NOT NULL DEFAULT ''`)
addColumn('matches', 'strategy_id', `INTEGER NOT NULL DEFAULT 0`)
addColumn('applications', 'match_snapshot', `TEXT NOT NULL DEFAULT ''`)
addColumn('applications', 'matched_at', `TEXT NOT NULL DEFAULT ''`)

// 系统默认匹配策略：五维权重合计 1.0，简历关键词为封顶附加分
const DEFAULT_WEIGHTS = { skill: 0.4, year: 0.2, salary: 0.15, edu: 0.15, city: 0.1 }
const DEFAULT_KEYWORD_CAP = 5

const now = () => new Date().toISOString()
const ts = () => new Date().toLocaleString('zh-CN')

function seed() {
  const n = db.prepare('SELECT COUNT(*) c FROM positions').get().c
  if (n > 0) return

  const iP = db.prepare('INSERT INTO positions(name,dept,city,level,salary_min,salary_max,skills,years,slots,status,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  const P = [
    ['前端开发工程师', '技术部', '上海', 'P5-P6', 18000, 32000, JSON.stringify([{ k: 'Vue', w: 5 }, { k: 'JavaScript', w: 5 }, { k: 'TypeScript', w: 4 }, { k: 'CSS', w: 3 }, { k: 'Node', w: 3 }]), 3, 2, 'open', ts()],
    ['后端开发工程师', '技术部', '北京', 'P5-P6', 20000, 38000, JSON.stringify([{ k: 'Java', w: 5 }, { k: 'Spring', w: 4 }, { k: 'MySQL', w: 4 }, { k: 'Redis', w: 3 }, { k: '微服务', w: 3 }]), 3, 3, 'open', ts()],
    ['产品经理', '产品部', '深圳', 'P6-P7', 22000, 42000, JSON.stringify([{ k: '需求分析', w: 5 }, { k: 'Axure', w: 4 }, { k: '数据分析', w: 4 }, { k: '项目管理', w: 3 }]), 4, 1, 'open', ts()],
    ['UI设计师', '设计部', '杭州', 'P5-P6', 15000, 28000, JSON.stringify([{ k: 'Figma', w: 5 }, { k: 'UI设计', w: 5 }, { k: '交互设计', w: 4 }]), 2, 2, 'open', ts()],
    ['数据分析师', '数据部', '上海', 'P5-P6', 18000, 33000, JSON.stringify([{ k: 'SQL', w: 5 }, { k: 'Python', w: 4 }, { k: 'Tableau', w: 3 }, { k: '统计学', w: 4 }]), 2, 1, 'closed', ts()],
    ['测试工程师', '质量部', '广州', 'P4-P5', 12000, 22000, JSON.stringify([{ k: '自动化测试', w: 4 }, { k: 'Python', w: 3 }, { k: 'Selenium', w: 3 }]), 1, 2, 'open', ts()]
  ]
  P.forEach(p => iP.run(...p))

  const iC = db.prepare('INSERT INTO candidates(name,phone,skills,years,edu,school,city,exp_salary,channel,raw) VALUES(?,?,?,?,?,?,?,?,?,?)')
  const skillPool = {
    'Vue': ['Vue', 'JavaScript', 'TypeScript', 'CSS', 'Node', 'Vite'],  // 前端集合用
    'Java': ['Java', 'Spring', 'MySQL', 'Redis', '微服务'],
    '产品': ['需求分析', 'Axure', '数据分析', '项目管理'],
    'UI': ['Figma', 'UI设计', '交互设计', 'PS'],
    '数据': ['SQL', 'Python', 'Tableau', '统计学'],
    '测试': ['自动化测试', 'Python', 'Selenium', 'JIRA']
  }
  const C = [
    ['林小雨', 'Vue', 4, '硕士', '上海交大', '上海', 30000, '猎头', '5年web开发经验，精通Vue3、TypeScript，主导过微前端改造'],
    ['周健', 'Vue', 2, '本科', '武汉理工', '杭州', 22000, '内推', 'Vue和JavaScript熟练，参与过大型后台系统开发'],
    ['王浩然', 'Java', 5, '硕士', '北邮', '北京', 38000, 'Boss直聘', 'Java后端专家，熟悉Spring Cloud微服务与高并发'],
    ['陈思远', 'Java', 3, '本科', '华中科大', '武汉', 28000, '内推', '掌握Java/Spring/MySQL，做过分布式订单系统'],
    ['刘一鸣', 'Java', 1, '本科', '郑州大学', '郑州', 15000, '校招', 'Java基础扎实，实习参与过支付模块'],
    ['黄梦琪', '产品', 5, '硕士', '复旦', '深圳', 40000, '猎头', '资深产品经理，擅长电商与增长，数据驱动'],
    ['孙明亮', '产品', 2, '本科', '中山大学', '广州', 23000, '内推', '需求分析与原型能力，跟进过3个上线产品'],
    ['吴雅琴', 'UI', 4, '本科', '江南大学', '杭州', 26000, '站酷', 'Figma熟练，擅长C端与B端UI，获奖多次'],
    ['郑晓彤', 'UI', 1, '本科', '四川美院', '成都', 16000, '校招', '视觉与交互设计，作品集丰富，掌握Figma'],
    ['何俊杰', '数据', 3, '硕士', '浙大', '上海', 30000, '内推', 'SQL与Python熟练，负责过用户行为数据仓库'],
    ['罗欣怡', '数据', 2, '本科', '厦大', '厦门', 21000, 'Boss直聘', '掌握SQL与Tableau，熟悉统计学与AB测试'],
    ['唐国强', '测试', 3, '本科', '电子科大', '成都', 19000, '内推', '自动化测试与Python，搭建过CI测试框架']
  ]
  C.forEach(c => {
    const [name, kind, years, edu, school, city, salary, channel, raw] = c
    const skills = JSON.stringify((skillPool[kind] || []).map((k, i) => ({ k, idx: Math.max(2, 5 - Math.floor(i / 2) + Math.floor(Math.random() * 2)) })))
    iC.run(name, '138' + String(10000000 + Math.floor(Math.random() * 89999999)), skills, years, edu, school, city, salary, channel, raw)
  })

  const iCh = db.prepare('INSERT INTO channels(name,cost) VALUES(?,?)')
  ;[['内推', 0], ['Boss直聘', 6000], ['猎头', 20000], ['校招', 8000], ['站酷', 4000]].forEach(ch => iCh.run(...ch))
}
seed()

export default db
export { now, ts, DEFAULT_WEIGHTS, DEFAULT_KEYWORD_CAP }