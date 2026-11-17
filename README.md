# የከተማና መሰረተ-ልማት ቢሮ — የBSC አፈጻጸም አስተዳደር

## በዚህ ስሪት የተጨመሩ ባህሪያት
- ከተያያዘው የኤክሴል ዕቅድ 14 ግቦች፣ 20 ዋና ተግባራት እና 189 ዝርዝር ተግባራት በራስ-ሰር ወደ ዳታቤዝ ይገባሉ።
- የግብ መመደብ፡ አስተዳዳሪው ግብን ለዳይሬክቶሬት ይመድባል።
- የዋና ተግባር መመደብ፡ አስተዳዳሪው ዋና ተግባርን በዳይሬክቶሬቱ ስር ላለ ቡድን ይመድባል።
- የዝርዝር ተግባር መመደብ፡ አስተዳዳሪው ዝርዝር ተግባርን በተመረጠው ቡድን ውስጥ ላለ ግለሰብ ሰራተኛ ይመድባል።
- ዋና ተግባር ለቡድን ሲመደብ የታችኛው ዝርዝር ተግባራት ዳይሬክቶሬትና ቡድኑን በራስ-ሰር ይወርሳሉ።
- የተመደቡ ዝርዝር ተግባራት በባለሙያው መለያ ላይ ብቻ ይታያሉ።
- የተጠቃሚ ገጽና የሪፖርት ክፍሎች በአማርኛ ተዘጋጅተዋል።

## መጫኛ (Windows / VS Code)
1. ZIP ፋይሉን Extract All ያድርጉ።
2. VS Code ውስጥ የተከፈተውን `bureau-performance-management` ፎልደር ይክፈቱ።
3. Terminal ይክፈቱ። `package.json` በሚታይበት ፎልደር ውስጥ መሆንዎን `dir` በማስኬድ ያረጋግጡ።
4. የሚከተሉትን ያስኪዱ፦

```powershell
npm install
npm start
```

5. በኮምፒውተሩ ላይ `http://localhost:3000` ይክፈቱ።

## የመጀመሪያ አስተዳዳሪ
- Email: `admin@bureau.local`
- Password: `ChangeMe123!`

ይህን የመጀመሪያ የይለፍ ቃል በምርት አጠቃቀም በፊት መቀየር አለበት።

## አስፈላጊ የመጀመሪያ አጠቃቀም
- በመጀመሪያ የሰራተኞችን ራስ-ምዝገባ ያጽድቁ። ዳይሬክቶሬትና ቡድን በምዝገባ ቅጽ ላይ በትክክል መግባታቸውን ያረጋግጡ።
- ከዚያ በ"የቢሮ ግቦች" ገጽ ግቦችን ለዳይሬክቶሬቶች ይመድቡ።
- በ"ዋናና ዝርዝር ተግባራት" ገጽ ዋና ተግባራትን ለቡድኖች፣ ዝርዝር ተግባራትን ለግለሰቦች ይመድቡ።
- ሰራተኛው የተመደበለትን ዝርዝር ተግባር ብቻ በመምረጥ የአፈጻጸም ሪፖርት ያስገባል።

## የLAN አጠቃቀም
Server የሚሆነውን ኮምፒውተር እና ሌሎች ኮምፒውተሮች በአንድ የLAN ኔትወርክ ላይ ያገናኙ። Server ኮምፒውተሩ ላይ `ipconfig` በማስኬድ IPv4 Address ያግኙ። ከሌሎች ኮምፒውተሮች `http://SERVER-IP:3000` ይክፈቱ። Windows Firewall ላይ Node.js የPrivate network ፍቃድ ያስፈልጋል።

## ማስታወሻ
ይህ የሚሰራ የመጀመሪያ ስሪት ነው። ከተቋሙ ኦፊሴላዊ የመዋቅር ስም ዝርዝር፣ የተረጋገጡ የሰራተኛ ዳይሬክቶሬት/ቡድን መረጃዎች ጋር ማጣጣም፣ የይለፍ ቃል ለውጥ፣ የተጠቃሚ መዳረሻ ገደቦች፣ የዳታቤዝ ባክአፕ፣ HTTPS፣ CSRF/rate limiting እና የኦዲት ምርመራ ከተቋሙ የIT ባለሙያ ጋር መጠናከር አለባቸው።


## Added features (Amharic / English)

- Use the **English / አማርኛ** switch on the sign-in screen or application header. The selected language is kept in the browser.
- The administrator assigns each bureau goal to a directorate.
- A directorate head assigns a main task to a team in their directorate.
- A team leader assigns each specific task to an officer in their own team.
- Officers submit actual achievement against the assigned task target. The report shows the plan/target, actual achievement, and calculated percentage (`actual ÷ target × 100`).
- The administrator sets a weight for each main task. The sum of main-task weights under one goal cannot exceed 100%.
- A main-task weight is distributed equally among its specific tasks for weighted scoring. Each specific task contribution is `specific-task achievement percentage × allocated weight ÷ 100`. Goal performance is the sum of these weighted contributions.
- The dashboard includes directorate, team, and individual performance tables and filters.

### Weighting example

If a main task has a weight of 30% and contains three specific tasks, each specific task receives a 10% share. If one specific task achieves 80% of its target, its contribution to the goal score is 8 percentage points (`80 × 10 ÷ 100`).

The percentage uses approved progress reports only. Progress is cumulative: each reporting period records total achievement to date. For each task, the dashboard uses the latest approved reporting period's actual value and compares it with the task target. It does NOT add Q1 + Q2 + Q3 + Q4, because each later value already includes earlier achievement. Re-entering the same task and period updates that period's existing report rather than creating another one.


## Offline use (added in this version)

- The existing SQLite database remains on the main Windows server. This update does not migrate or replace it.
- After a user signs in and opens the application while connected, the browser caches the application shell and recently used GET data for that signed-in user.
- If the connection is interrupted, task/report screens can use cached data and new progress submissions are stored in that browser's IndexedDB queue.
- When the connection returns, queued progress reports are sent automatically. A unique client reference prevents duplicate insertion if a response is lost and the browser retries.
- Pending reports are shown in the progress table as “Pending sync” until accepted by the server.
- The offline queue is per browser/device. Unsynchronized entries are not visible to other devices or offices until synchronization succeeds.
- Sign in at least once while connected on each device. Do not clear browser site data while reports are waiting to sync.
- Service workers/PWA installation require HTTPS on phones and on other devices; `localhost` is the usual development exception. For production, deploy behind HTTPS with a trusted certificate. Open the application while online, then reload it once while still online so the service worker can cache the CDN-hosted Bootstrap and Chart.js assets. Test each device before relying on offline use.

### Windows LAN hosting

The server already listens on `0.0.0.0` and uses `PORT` (default `3000`). Set a DHCP reservation for the Windows server, allow inbound TCP 3000 on the Windows Private network profile, then visit `http://SERVER-IP:3000` from devices on the same LAN. This HTTP LAN address is suitable for ordinary browser access, but PWA service-worker offline support on phones requires trusted HTTPS. Never expose port 3000 or the SQLite file directly to the public internet.

### Important limitations of this first offline release

- This is device-level offline capture with a central server, not a separate offline server in every office. If an office LAN must continue sharing new records while its internet/WAN is down, that office needs a local gateway/server and a separate server-to-server replication design.
- Offline users must have signed in on that browser previously and must have loaded the task data while connected.
- Only progress submission is queued offline. User administration, task/goal changes, approvals, Excel exports and other write operations still require a live connection.
- Cached data may be stale while disconnected. Review the sync status before relying on current assignments or reports.
- Keep the existing `data/performance.sqlite` file backed up before upgrading.


## Cumulative progress reporting (important)

- Enter the total achievement reached from the start of the plan through the current reporting period. Example: Q1 = 20 km, Q2 = 45 km, Q3 = 70 km, Q4 = 100 km.
- The dashboard and weighted performance calculation use the latest approved period for each task. They do not sum cumulative quarter values.
- A newer report affects the dashboard only after it is approved. If the latest submitted report is pending or returned, the dashboard continues to use the latest approved report.
- Submitting the same task + reporting period again updates that existing period record. A database unique index also prevents duplicate task-period records.
- Standard period labels such as `2019-Q1`, `2019-Q2`, `Q1-2019`, or `Q2-2019` are compared chronologically. For custom labels, latest submission time is used as the fallback ordering.
