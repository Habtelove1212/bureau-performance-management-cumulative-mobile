const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const initSqlJs = require('sql.js');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'performance.sqlite');
const PLAN_FILE = path.join(__dirname, 'plan-data.json');
fs.mkdirSync(DATA_DIR, {recursive:true});
let db;

function persist(){ fs.writeFileSync(DB_FILE, Buffer.from(db.export())); }
function run(sql, params=[]){ db.run(sql, params); persist(); }
function rows(sql, params=[]){
  const stmt=db.prepare(sql); stmt.bind(params); const out=[];
  while(stmt.step()) out.push(stmt.getAsObject()); stmt.free(); return out;
}
function one(sql, params=[]){ return rows(sql,params)[0] || null; }
function ensureColumn(table, column, definition){
  const cols=rows(`PRAGMA table_info(${table})`);
  if(!cols.some(c=>c.name===column)) db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
function initSchema(){
  db.run(`CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'officer', status TEXT NOT NULL DEFAULT 'pending',
    position TEXT, directorate TEXT, team TEXT, experience INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS goals(
    id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, name_en TEXT NOT NULL, name_am TEXT,
    goal_type TEXT DEFAULT 'Common', description TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS tasks(
    id INTEGER PRIMARY KEY AUTOINCREMENT, goal_id INTEGER NOT NULL, parent_id INTEGER,
    level TEXT NOT NULL, title_en TEXT NOT NULL, title_am TEXT, indicator TEXT, baseline REAL DEFAULT 0,
    target REAL DEFAULT 0, weight REAL DEFAULT 0, directorate TEXT, team TEXT, officer_id INTEGER,
    start_date TEXT, end_date TEXT, FOREIGN KEY(goal_id) REFERENCES goals(id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS progress(
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    period TEXT NOT NULL, actual REAL NOT NULL, explanation TEXT, evidence TEXT,
    status TEXT DEFAULT 'Pending', submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(task_id) REFERENCES tasks(id), FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS audit(
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT, details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS org_units(id INTEGER PRIMARY KEY AUTOINCREMENT, directorate TEXT, team TEXT)`);
  ensureColumn('goals','directorate','TEXT');
  ensureColumn('goals','indicator','TEXT');
  ensureColumn('goals','baseline','REAL DEFAULT 0');
  ensureColumn('goals','target','REAL DEFAULT 0');
  ensureColumn('tasks','code','TEXT');
  ensureColumn('tasks','source_row','INTEGER');
  ensureColumn('tasks','indicator_extra','TEXT');
  ensureColumn('progress','client_ref','TEXT');
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_progress_client_ref ON progress(client_ref) WHERE client_ref IS NOT NULL AND client_ref <> ''");
  // Keep one active progress row for each task/reporting-period pair.
  // Older duplicate submissions are preserved in an archive before enforcing uniqueness.
  db.run("CREATE TABLE IF NOT EXISTS progress_duplicate_archive AS SELECT *, CURRENT_TIMESTAMP AS archived_at FROM progress WHERE 0");
  const progressColumns=rows('PRAGMA table_info(progress)').map(c=>c.name);
  const columnList=progressColumns.join(',');
  const duplicateGroups=rows('SELECT task_id, period, MAX(id) keep_id FROM progress GROUP BY task_id, period HAVING COUNT(*)>1');
  for(const group of duplicateGroups){
    const older=rows('SELECT id FROM progress WHERE task_id=? AND period=? AND id<>?',[group.task_id,group.period,group.keep_id]);
    for(const item of older){
      db.run(`INSERT INTO progress_duplicate_archive(${columnList},archived_at) SELECT ${columnList},CURRENT_TIMESTAMP FROM progress WHERE id=?`,[item.id]);
      db.run('DELETE FROM progress WHERE id=?',[item.id]);
    }
  }
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_progress_task_period ON progress(task_id,period)');
  const count=one('SELECT COUNT(*) n FROM users').n;
  if(!count){
    const hash=bcrypt.hashSync('ChangeMe123!',10);
    db.run('INSERT INTO users(name,email,password,role,status) VALUES(?,?,?,?,?)',['System Administrator','admin@bureau.local',hash,'super_admin','approved']);
  }
  seedPlanIfEmpty();
  persist();
}
function seedPlanIfEmpty(){
  if(one('SELECT COUNT(*) n FROM goals').n>0 || !fs.existsSync(PLAN_FILE)) return;
  const plan=JSON.parse(fs.readFileSync(PLAN_FILE,'utf8'));
  const goalIds={};
  for(const g of plan.goals){
    db.run(`INSERT INTO goals(code,name_en,name_am,goal_type,description,indicator,baseline,target)
      VALUES(?,?,?,?,?,?,?,?)`,[g.code,g.name_en,g.name_am,'Common',g.description||'',g.description||'',g.baseline||0,g.target||0]);
    goalIds[g.code]=one('SELECT last_insert_rowid() id').id;
  }
  const mainIds={};
  for(const t of plan.tasks.filter(x=>x.level==='Main')){
    const gid=goalIds[t.goal_code];
    db.run(`INSERT INTO tasks(code,goal_id,parent_id,level,title_en,title_am,indicator,baseline,target,source_row)
      VALUES(?,?,NULL,?,?,?,?,?,?,?)`,[t.code,gid,t.level,t.title_en,t.title_am,t.indicator||'',t.baseline||0,t.target||0,t.source_row||null]);
    mainIds[t.code]=one('SELECT last_insert_rowid() id').id;
  }
  for(const t of plan.tasks.filter(x=>x.level==='Specific')){
    const gid=goalIds[t.goal_code], pid=mainIds[t.parent_code]||null;
    db.run(`INSERT INTO tasks(code,goal_id,parent_id,level,title_en,title_am,indicator,baseline,target,source_row)
      VALUES(?,?,?,?,?,?,?,?,?,?)`,[t.code,gid,pid,t.level,t.title_en,t.title_am,t.indicator||'',t.baseline||0,t.target||0,t.source_row||null]);
  }
}
function audit(req, action, details=''){ db.run('INSERT INTO audit(user_id,action,details) VALUES(?,?,?)',[req.session.user?.id||null,action,details]); persist(); }
function auth(req,res,next){ if(!req.session.user) return res.status(401).json({error:'እባክዎ መጀመሪያ ይግቡ'}); next(); }
function roles(...allowed){ return (req,res,next)=>{ if(!req.session.user || !allowed.includes(req.session.user.role)) return res.status(403).json({error:'ይህን ተግባር ለማከናወን ፈቃድ የለዎትም'}); next(); }; }

app.use(express.json({limit:'15mb'}));
app.use(express.urlencoded({extended:true}));
app.use(session({secret:process.env.SESSION_SECRET||'replace-this-secret-before-deployment',resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax'}}));
app.use(express.static(path.join(__dirname,'public')));

app.post('/api/login',(req,res)=>{
  const u=one('SELECT * FROM users WHERE email=?',[String(req.body.email||'').trim().toLowerCase()]);
  if(!u || !bcrypt.compareSync(String(req.body.password||''),u.password)) return res.status(401).json({error:'ኢሜይል ወይም የይለፍ ቃል ትክክል አይደለም'});
  if(u.status!=='approved') return res.status(403).json({error:'መለያዎ የአስተዳዳሪ ማጽደቅን እየጠበቀ ነው'});
  req.session.user={id:u.id,name:u.name,email:u.email,role:u.role,directorate:u.directorate,team:u.team};
  audit(req,'LOGIN',u.email); res.json({user:req.session.user});
});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me',(req,res)=>res.json({user:req.session.user||null}));

app.post('/api/register',(req,res)=>{
  const b=req.body;
  if(!b.name||!b.email||!b.password) return res.status(400).json({error:'ሙሉ ስም፣ ኢሜይል እና የይለፍ ቃል ያስፈልጋሉ'});
  try{
    db.run(`INSERT INTO users(name,email,password,position,directorate,team,experience,status,role)
      VALUES(?,?,?,?,?,?,?,'pending','officer')`,
      [b.name,String(b.email).toLowerCase(),bcrypt.hashSync(b.password,10),b.position||'',b.directorate||'',b.team||'',Number(b.experience||0)]);
    persist(); res.json({ok:true,message:'ምዝገባዎ ለአስተዳዳሪ ማጽደቅ ተልኳል'});
  }catch(e){res.status(400).json({error:'ይህ ኢሜይል ቀድሞ ተመዝግቦ ሊሆን ይችላል'});}
});
app.get('/api/users',auth,roles('super_admin','performance_admin'),(req,res)=>res.json(rows('SELECT id,name,email,role,status,position,directorate,team,experience,created_at FROM users ORDER BY id DESC')));
app.patch('/api/users/:id',auth,roles('super_admin','performance_admin'),(req,res)=>{
  const {status,role}=req.body;
  if(status) db.run('UPDATE users SET status=? WHERE id=?',[status,Number(req.params.id)]);
  if(role) db.run('UPDATE users SET role=? WHERE id=?',[role,Number(req.params.id)]);
  persist(); audit(req,'UPDATE_USER',req.params.id); res.json({ok:true});
});
app.get('/api/org',auth,roles('super_admin','performance_admin','bureau_head','directorate_head','team_leader'),(req,res)=>{
  const people=rows("SELECT id,name,email,position,directorate,team,role FROM users WHERE status='approved' ORDER BY directorate,team,name");
  const directorates=[...new Set(people.map(x=>x.directorate).filter(Boolean))];
  const teams=[...new Set(people.map(x=>JSON.stringify({directorate:x.directorate,team:x.team})).filter(Boolean))].map(x=>JSON.parse(x)).filter(x=>x.directorate&&x.team);
  res.json({people,directorates,teams});
});
app.get('/api/goals',auth,(req,res)=>res.json(rows('SELECT * FROM goals ORDER BY id')));
app.post('/api/goals',auth,roles('super_admin','performance_admin'),(req,res)=>{
  const b=req.body; if(!b.name_en) return res.status(400).json({error:'የግብ ስም ያስፈልጋል'});
  db.run('INSERT INTO goals(code,name_en,name_am,goal_type,description) VALUES(?,?,?,?,?)',[b.code||'',b.name_en,b.name_am||b.name_en,b.goal_type||'Common',b.description||'']);
  persist(); audit(req,'CREATE_GOAL',b.name_en); res.json({ok:true,id:one('SELECT last_insert_rowid() id').id});
});
app.put('/api/goals/:id',auth,roles('super_admin','performance_admin'),(req,res)=>{
  const b=req.body; db.run('UPDATE goals SET code=?,name_en=?,name_am=?,goal_type=?,description=? WHERE id=?',[b.code||'',b.name_en,b.name_am||'',b.goal_type||'Common',b.description||'',Number(req.params.id)]); persist(); res.json({ok:true});
});
app.patch('/api/goals/:id/assignment',auth,roles('super_admin','performance_admin'),(req,res)=>{
  const d=String(req.body.directorate||'').trim();
  if(!d) return res.status(400).json({error:'ዳይሬክቶሬት ይምረጡ'});
  const id=Number(req.params.id);
  db.run('UPDATE goals SET directorate=? WHERE id=?',[d,id]);
  db.run('UPDATE tasks SET directorate=? WHERE goal_id=?',[d,id]);
  persist(); audit(req,'ASSIGN_GOAL',`${id} -> ${d}`); res.json({ok:true});
});
app.delete('/api/goals/:id',auth,roles('super_admin'),(req,res)=>{
  db.run('DELETE FROM goals WHERE id=?',[Number(req.params.id)]); persist(); audit(req,'DELETE_GOAL',req.params.id); res.json({ok:true});
});
app.get('/api/tasks',auth,(req,res)=>{
  const u=req.session.user;
  let where='', params=[];
  if(u.role==='officer'){ where='WHERE t.officer_id=?'; params=[u.id]; }
  else if(u.role==='team_leader'){ where='WHERE t.directorate=? AND t.team=?'; params=[u.directorate||'',u.team||'']; }
  else if(u.role==='directorate_head'){ where='WHERE t.directorate=?'; params=[u.directorate||'']; }
  res.json(rows(`SELECT t.*,g.name_am goal_name,g.directorate goal_directorate,u.name officer_name
    FROM tasks t JOIN goals g ON g.id=t.goal_id LEFT JOIN users u ON u.id=t.officer_id ${where}
    ORDER BY g.id,t.parent_id,t.id`,params));
});
app.post('/api/tasks',auth,roles('super_admin','performance_admin','directorate_head','team_leader'),(req,res)=>{
  const b=req.body;
  if(!b.goal_id||!b.title_en||!b.level) return res.status(400).json({error:'ግብ፣ የተግባር ርዕስ እና ደረጃ ያስፈልጋሉ'});
  if(b.level==='Main'){const w=Number(b.weight||0),used=one("SELECT COALESCE(SUM(weight),0) n FROM tasks WHERE goal_id=? AND level='Main'",[Number(b.goal_id)]).n;if(!Number.isFinite(w)||w<0||w>100||used+w>100.0001)return res.status(400).json({error:'የአንድ ግብ ዋና ተግባራት ክብደት ድምር ከ100% መብለጥ የለበትም'});}
  let directorate=b.directorate||'', team=b.team||'';
  if(b.level==='Specific'){
    const parent=b.parent_id?one('SELECT * FROM tasks WHERE id=?',[Number(b.parent_id)]):null;
    if(!parent || parent.level!=='Main' || parent.goal_id!==Number(b.goal_id)) return res.status(400).json({error:'ዝርዝር ተግባሩን ከተመሳሳይ ግብ ስር ካለ ዋና ተግባር ጋር ያያይዙ'});
    directorate=parent.directorate||directorate; team=parent.team||team;
  }
  db.run(`INSERT INTO tasks(code,goal_id,parent_id,level,title_en,title_am,indicator,baseline,target,weight,directorate,team,officer_id,start_date,end_date)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[b.code||'',Number(b.goal_id),b.parent_id?Number(b.parent_id):null,b.level,b.title_en,b.title_am||b.title_en,b.indicator||'',Number(b.baseline||0),Number(b.target||0),Number(b.weight||0),directorate,team,b.officer_id?Number(b.officer_id):null,b.start_date||'',b.end_date||'']);
  persist(); audit(req,'CREATE_TASK',b.title_en); res.json({ok:true});
});
app.put('/api/tasks/:id',auth,roles('super_admin','performance_admin','directorate_head','team_leader'),(req,res)=>{
  const b=req.body; db.run(`UPDATE tasks SET code=?,goal_id=?,parent_id=?,level=?,title_en=?,title_am=?,indicator=?,baseline=?,target=?,weight=?,directorate=?,team=?,officer_id=?,start_date=?,end_date=? WHERE id=?`,
  [b.code||'',Number(b.goal_id),b.parent_id?Number(b.parent_id):null,b.level,b.title_en,b.title_am||'',b.indicator||'',Number(b.baseline||0),Number(b.target||0),Number(b.weight||0),b.directorate||'',b.team||'',b.officer_id?Number(b.officer_id):null,b.start_date||'',b.end_date||'',Number(req.params.id)]); persist(); res.json({ok:true});
});
app.patch('/api/tasks/:id/assignment',auth,roles('super_admin','performance_admin','directorate_head','team_leader'),(req,res)=>{
  const id=Number(req.params.id), t=one('SELECT * FROM tasks WHERE id=?',[id]);
  if(!t) return res.status(404).json({error:'ተግባሩ አልተገኘም'});
  const directorate=String(req.body.directorate||'').trim(), team=String(req.body.team||'').trim();
  const officerId=req.body.officer_id?Number(req.body.officer_id):null;
  const actor=req.session.user;
  if(actor.role==='directorate_head' && (t.level!=='Main' || actor.directorate!==directorate)) return res.status(403).json({error:'የእርስዎ ዳይሬክቶሬት ውስጥ ያሉ ዋና ተግባራትን ብቻ ለቡድን መመደብ ይችላሉ'});
  if(actor.role==='team_leader' && (t.level!=='Specific' || actor.directorate!==directorate || actor.team!==team)) return res.status(403).json({error:'በእርስዎ ቡድን ውስጥ ያሉ ዝርዝር ተግባራትን ብቻ ለሰራተኛ መመደብ ይችላሉ'});
  if(t.level==='Main' && (!directorate||!team)) return res.status(400).json({error:'ለዋና ተግባር ዳይሬክቶሬትና ቡድን መምረጥ አለብዎት'});
  if(t.level==='Specific' && (!directorate||!team||!officerId)) return res.status(400).json({error:'ለዝርዝር ተግባር ዳይሬክቶሬት፣ ቡድንና ሰራተኛ ይምረጡ'});
  if(officerId){
    const p=one("SELECT * FROM users WHERE id=? AND status='approved'",[officerId]);
    if(!p || p.directorate!==directorate || p.team!==team) return res.status(400).json({error:'የተመረጠው ሰራተኛ በዚህ ዳይሬክቶሬትና ቡድን ውስጥ አይገኝም'});
  }
  if(t.level==='Main'){const weight=Number(req.body.weight??t.weight??0);const otherWeight=one("SELECT COALESCE(SUM(weight),0) n FROM tasks WHERE goal_id=? AND level='Main' AND id<>?",[t.goal_id,id]).n;if(!Number.isFinite(weight)||weight<0||weight>100||otherWeight+weight>100.0001)return res.status(400).json({error:'የአንድ ግብ ዋና ተግባራት ክብደት ድምር ከ100% መብለጥ የለበትም'});db.run('UPDATE tasks SET directorate=?,team=?,officer_id=?,weight=? WHERE id=?',[directorate,team,officerId,weight,id]);}else{db.run('UPDATE tasks SET directorate=?,team=?,officer_id=? WHERE id=?',[directorate,team,officerId,id]);}
  if(t.level==='Main') db.run('UPDATE tasks SET directorate=?,team=? WHERE parent_id=?',[directorate,team,id]);
  persist(); audit(req,'ASSIGN_TASK',`${id} -> ${directorate}/${team}/${officerId||''}`); res.json({ok:true});
});
app.delete('/api/tasks/:id',auth,roles('super_admin','performance_admin'),(req,res)=>{db.run('DELETE FROM tasks WHERE id=?',[Number(req.params.id)]);persist();res.json({ok:true});});

app.post('/api/progress',auth,(req,res)=>{
  const b=req.body;
  if(!b.task_id||!b.period||b.actual===undefined || !Number.isFinite(Number(b.actual)) || Number(b.actual)<0) return res.status(400).json({error:'ተግባር፣ የሪፖርት ጊዜ እና ትክክለኛ የተፈጸመ መጠን ያስፈልጋሉ'});
  const task=one('SELECT * FROM tasks WHERE id=?',[Number(b.task_id)]);
  if(!task || (req.session.user.role==='officer' && task.officer_id!==req.session.user.id)) return res.status(403).json({error:'ይህ ተግባር ለእርስዎ አልተመደበም'});
  // Scope the idempotency key to the authenticated user. Retries after a lost response
  // return the original row instead of inserting a duplicate progress report.
  const clientRef=b.client_ref ? `${req.session.user.id}:${String(b.client_ref).slice(0,100)}` : null;
  if(clientRef){
    const prior=one('SELECT id FROM progress WHERE client_ref=?',[clientRef]);
    if(prior) return res.json({ok:true,duplicate:true,id:prior.id});
  }
  const period=String(b.period).trim().slice(0,40);
  const existing=one('SELECT id FROM progress WHERE task_id=? AND period=?',[Number(b.task_id),period]);
  let savedId, updated=false;
  if(existing){
    // Re-submitting the same task in the same period edits that period's record;
    // it does not create a second progress row. A revised submission returns to review.
    db.run(`UPDATE progress SET user_id=?,actual=?,explanation=?,evidence=?,status='Pending',
      submitted_at=CURRENT_TIMESTAMP,client_ref=? WHERE id=?`,
      [req.session.user.id,Number(b.actual),String(b.explanation||'').slice(0,5000),String(b.evidence||'').slice(0,1000),clientRef,existing.id]);
    savedId=existing.id; updated=true;
  }else{
    db.run('INSERT INTO progress(task_id,user_id,period,actual,explanation,evidence,client_ref) VALUES(?,?,?,?,?,?,?)',[Number(b.task_id),req.session.user.id,period,Number(b.actual),String(b.explanation||'').slice(0,5000),String(b.evidence||'').slice(0,1000),clientRef]);
    savedId=one('SELECT last_insert_rowid() id').id;
  }
  persist(); audit(req,updated?'UPDATE_PROGRESS':'SUBMIT_PROGRESS',`Task ${b.task_id}; period ${period}`);
  res.json({ok:true,updated,id:savedId});
});
app.get('/api/progress',auth,(req,res)=>{
  const u=req.session.user;
  let where='',params=[];
  if(u.role==='officer'){where='WHERE p.user_id=?';params=[u.id]}
  else if(u.role==='team_leader'){where='WHERE t.directorate=? AND t.team=?';params=[u.directorate||'',u.team||'']}
  else if(u.role==='directorate_head'){where='WHERE t.directorate=?';params=[u.directorate||'']}
  const isReviewer=['super_admin','performance_admin','bureau_head','directorate_head','team_leader','evaluator'].includes(u.role);
  res.json(rows(`SELECT p.*,t.title_am task_title,t.code task_code,t.target task_target,CASE WHEN t.target=0 THEN 0 ELSE ROUND(p.actual*100.0/t.target,1) END performance_pct,u.name employee FROM progress p JOIN tasks t ON t.id=p.task_id JOIN users u ON u.id=p.user_id ${where} ORDER BY p.id DESC`,params));
});
app.patch('/api/progress/:id',auth,roles('super_admin','performance_admin','bureau_head','directorate_head','team_leader','evaluator'),(req,res)=>{
  const s=req.body.status; if(!['Approved','Returned','Rejected'].includes(s)) return res.status(400).json({error:'የሁኔታ ምርጫ ትክክል አይደለም'});
  db.run('UPDATE progress SET status=? WHERE id=?',[s,Number(req.params.id)]);persist();audit(req,'REVIEW_PROGRESS',`${req.params.id}: ${s}`);res.json({ok:true});
});
// Reporting periods are cumulative snapshots. Compare standard year/quarter labels
// chronologically (e.g. 2019-Q1, 2019-Q2); fall back to submission time for custom labels.
function reportingPeriodRank(value){
  const label=String(value||'').trim().toUpperCase();
  let m=label.match(/^(\\d{4})\\s*[-\\/]?\\s*Q([1-4])$/);
  if(m) return Number(m[1])*10+Number(m[2]);
  m=label.match(/^Q([1-4])\\s*[-\\/]?\\s*(\\d{4})$/);
  if(m) return Number(m[2])*10+Number(m[1]);
  m=label.match(/^(\\d{4})[-\\/](0?[1-9]|1[0-2])(?:[-\\/](0?[1-9]|[12]\\d|3[01]))?$/);
  if(m) return Number(m[1])*100+Number(m[2]);
  return null;
}
function isLaterApprovedPeriod(candidate,current){
  const a=reportingPeriodRank(candidate.period), b=reportingPeriodRank(current.period);
  if(a!==null && b!==null && a!==b) return a>b;
  // For custom/mixed period labels, use the latest submission as a safe fallback.
  const at=String(candidate.submitted_at||''), bt=String(current.submitted_at||'');
  return at>bt || (at===bt && Number(candidate.id)>Number(current.id));
}

app.get('/api/dashboard',auth,(req,res)=>{
  const u=req.session.user;
  const requested={directorate:String(req.query.directorate||''),team:String(req.query.team||''),officer:String(req.query.officer||'')};
  if(u.role==='directorate_head') requested.directorate=u.directorate||'';
  if(u.role==='team_leader'){requested.directorate=u.directorate||'';requested.team=u.team||'';}
  if(u.role==='officer') requested.officer=String(u.id);
  const goals=one('SELECT COUNT(*) n FROM goals').n;
  const users=one("SELECT COUNT(*) n FROM users WHERE status='approved'").n;
  const tasks=one('SELECT COUNT(*) n FROM tasks').n;
  const pending=one("SELECT COUNT(*) n FROM progress WHERE status='Pending'").n;
  const approved=one("SELECT COUNT(*) n FROM progress WHERE status='Approved'").n;
  // Cumulative reporting: use only the latest approved snapshot for each task.
  // Never sum Q1 + Q2 + Q3 + Q4 because each figure already includes prior achievement.
  const approvedReports=rows("SELECT id,task_id,period,actual,submitted_at FROM progress WHERE status='Approved'");
  const latestApprovedByTask=new Map();
  for(const report of approvedReports){
    const current=latestApprovedByTask.get(report.task_id);
    if(!current || isLaterApprovedPeriod(report,current)) latestApprovedByTask.set(report.task_id,report);
  }
  const allTasks=rows(`SELECT t.*,g.name_am goal_name,g.name_en goal_name_en,u.name officer_name
    FROM tasks t JOIN goals g ON g.id=t.goal_id LEFT JOIN users u ON u.id=t.officer_id ORDER BY t.id`)
    .map(t=>{
      const latest=latestApprovedByTask.get(t.id);
      return {...t,actual_approved:latest?Number(latest.actual):0,
        latest_approved_period:latest?latest.period:null};
    });
  const filtered=allTasks.filter(t=>(!requested.directorate||t.directorate===requested.directorate)&&(!requested.team||t.team===requested.team)&&(!requested.officer||String(t.officer_id||'')===requested.officer));
  const mains=allTasks.filter(t=>t.level==='Main');
  const weighted=[];
  for(const main of mains){
    const children=allTasks.filter(t=>t.level==='Specific'&&t.parent_id===main.id);
    const selected=children.length?children.filter(c=>filtered.some(f=>f.id===c.id)):(filtered.some(f=>f.id===main.id)?[main]:[]);
    if(!selected.length) continue;
    const weight=Number(main.weight||0);
    const share=children.length?weight/children.length:weight;
    for(const t of selected){
      const pct=Number(t.target)>0?Math.min(100,Math.max(0,Number(t.actual_approved)*100/Number(t.target))):0;
      weighted.push({...t,performance:Number(pct.toFixed(1)),weight_share:Number(share.toFixed(3)),weighted_score:Number((pct*share/100).toFixed(2)),main_title:main.title_am||main.title_en,main_weight:weight});
    }
  }
  const byGoal=rows('SELECT id,name_am,name_en FROM goals ORDER BY id').map(g=>{
    const items=weighted.filter(t=>t.goal_id===g.id), total=items.reduce((a,t)=>a+t.weight_share,0), score=items.reduce((a,t)=>a+t.weighted_score,0);
    return {id:g.id,name_am:g.name_am,name_en:g.name_en,performance:Number(score.toFixed(1)),weight_total:Number(total.toFixed(2))};
  });
  const group=(key)=>[...new Set(filtered.map(t=>t[key]).filter(Boolean))].map(name=>{
    const items=weighted.filter(t=>t[key]===name), total=items.reduce((a,t)=>a+t.weight_share,0), score=items.reduce((a,t)=>a+t.weighted_score,0);
    return {name,task_count:items.length,performance:total?Number((score*100/total).toFixed(1)):0};
  });
  const directorates=group('directorate'), teams=group('team');
  const officers=[...new Set(filtered.filter(t=>t.officer_id).map(t=>String(t.officer_id)))].map(id=>{
    const items=weighted.filter(t=>String(t.officer_id||'')===id), total=items.reduce((a,t)=>a+t.weight_share,0), score=items.reduce((a,t)=>a+t.weighted_score,0);
    return {id:Number(id),name:items[0]?.officer_name||'',directorate:items[0]?.directorate||'',team:items[0]?.team||'',task_count:items.length,performance:total?Number((score*100/total).toFixed(1)):0};
  });
  const org=rows("SELECT id,name,directorate,team FROM users WHERE status='approved' ORDER BY name");
  res.json({goals,users,tasks,pending,approved,byGoal,byDirectorate:directorates,byTeam:teams,byOfficer:officers,org,weightedTasks:weighted,filters:requested});
});
app.get('/api/template.xlsx',auth,async(req,res)=>{
  const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('ዕቅድ');
  ws.addRow(['የግብ ኮድ','ግብ','ዋና ተግባር','ዝርዝር ተግባር','መለኪያ','መነሻ','ዓመታዊ ዒላማ']);
  ws.getRow(1).font={bold:true};res.setHeader('Content-Disposition','attachment; filename="bureau-bsc-template.xlsx"');res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');await wb.xlsx.write(res);res.end();
});
app.get('/api/export/progress',auth,async(req,res)=>{
  const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('አፈጻጸም');
  ws.addRow(['ኮድ','ተግባር','ሰራተኛ','ጊዜ','አፈጻጸም','ሁኔታ','ማብራሪያ']);
  rows(`SELECT t.code,t.title_am task_title,u.name employee,p.period,p.actual,p.status,p.explanation FROM progress p JOIN tasks t ON t.id=p.task_id JOIN users u ON u.id=p.user_id`).forEach(r=>ws.addRow([r.code,r.task_title,r.employee,r.period,r.actual,r.status,r.explanation]));
  ws.getRow(1).font={bold:true};res.setHeader('Content-Disposition','attachment; filename="bureau-performance-progress.xlsx"');res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');await wb.xlsx.write(res);res.end();
});
(async()=>{const SQL=await initSqlJs(); db=fs.existsSync(DB_FILE)?new SQL.Database(new Uint8Array(fs.readFileSync(DB_FILE))):new SQL.Database();initSchema();app.listen(PORT,'0.0.0.0',()=>console.log(`ሲስተሙ ተጀምሯል: http://localhost:${PORT} | LAN: http://YOUR-SERVER-IP:${PORT}`));})();
