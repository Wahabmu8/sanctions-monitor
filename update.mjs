// مُحدِّث مرصد العقوبات — يعمل على GitHub Actions (مرة يومياً).
// يحدّث البيانات داخل index.html، ويكتب new_designations.md عند وجود أي جديد
// (مُضافون جدد للقوائم أو أخبار/تحديثات حديثة) — ليصلك إشعار.
import fs from "node:fs";

const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || "claude-3-5-sonnet-latest";
const FILE = "index.html";

if (!KEY) { console.log("[update] لا يوجد ANTHROPIC_API_KEY — تخطّي التحديث."); process.exit(0); }

const SCHEMA = `أخرج كائن JSON واحد فقط (بدون أي نص آخر، بدون Markdown):
{
  "items": [ {
    "id":"معرّف-فريد","src":"OFAC|EU|UK|UN|Other","date":"YYYY-MM-DD","newToList":true/false,
    "kind":{"ar":"...","en":"..."},"country":{"code":"ISO2","flag":"🏳️","ar":"...","en":"..."},
    "title":{"ar":"...","en":"..."},"body":{"ar":"شرح 1-2 جملة","en":"1-2 sentences"},
    "target":{"ar":"...","en":"..."},"url":"رابط رسمي" } ],
  "designations": [ {
    "id":"d-فريد","date":"YYYY-MM-DD","src":"OFAC|EU|UK|UN|Other","type":"individual|entity",
    "nameEn":"الاسم الأصلي رسمياً","nameAr":"الاسم بالعربي (ترجمة صوتية دقيقة)",
    "program":{"ar":"القائمة/البرنامج","en":"list/program"},
    "country":{"code":"ISO2","flag":"🏳️","ar":"...","en":"..."},
    "role":{"ar":"الصفة","en":"role"},"info":{"ar":"معرّفات (ميلاد/كنية)","en":"identifiers"},"url":"رابط رسمي" } ]
}
القواعد: المصادر OFAC، الاتحاد الأوروبي، OFSI البريطاني، مجلس الأمن (لجان العقوبات)، BIS.
في "designations" ضع كل فرد/كيان أُدرج فعلياً خلال آخر 14 يوماً (استخرج الأسماء من البيانات الرسمية).
روابط رسمية حقيقية. ترجمة عربية دقيقة. JSON صالح 100% فقط.`;

async function call() {
  const body = { model: MODEL, max_tokens: 12000,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 10 }],
    messages: [{ role: "user", content: `ابحث في الويب عن آخر تحديثات العقوبات الدولية والمُدرَجين الجدد خلال آخر أسبوعين.\n${SCHEMA}` }] };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type":"application/json", "x-api-key":KEY, "anthropic-version":"2023-06-01" },
    body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return (j.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
}
function parseObj(t){ const s=t.indexOf("{"), e=t.lastIndexOf("}"); if(s<0||e<=s) throw new Error("no json"); return JSON.parse(t.slice(s,e+1)); }
function hash(s){ let h=0; for(let k=0;k<s.length;k++) h=(h*31+s.charCodeAt(k))|0; return h; }
function daysAgo(d){ return Math.floor((Date.now() - new Date(d+"T00:00:00Z").getTime())/(864e5)); }

function vItems(a){ const o=[]; for(const i of a||[]){ if(!i||!i.src||!i.date||!i.title?.ar||!i.title?.en||!i.country||!i.url) continue;
  if(!["OFAC","EU","UK","UN","Other"].includes(i.src)) i.src="Other";
  if(!i.id) i.id=`${i.src}-${i.date}-${Math.abs(hash(i.title.en))}`;
  i.country.flag=i.country.flag||"🏳️"; i.kind=i.kind||{ar:"تحديث",en:"Update"}; i.body=i.body||{ar:"",en:""};
  i.target=i.target||{ar:i.country.ar,en:i.country.en}; i.newToList=i.newToList===true; o.push(i);} return o; }
function vDes(a){ const o=[]; for(const d of a||[]){ if(!d||!d.src||!d.date||!d.nameEn||!d.country||!d.url) continue;
  if(!["OFAC","EU","UK","UN","Other"].includes(d.src)) d.src="Other";
  if(!["individual","entity"].includes(d.type)) d.type="individual";
  if(!d.id) d.id=`d-${d.src}-${d.date}-${Math.abs(hash(d.nameEn))}`;
  d.nameAr=d.nameAr||d.nameEn; d.country.flag=d.country.flag||"🏳️";
  d.program=d.program||{ar:"",en:""}; d.role=d.role||{ar:"",en:""}; d.info=d.info||{ar:"",en:""}; o.push(d);} return o; }

// استخراج المفاتيح السابقة من index.html (يعمل مع الصيغة القديمة والجديدة)
function block(html,name){ const m=html.match(new RegExp("window\\."+name+"\\s*=\\s*\\[[\\s\\S]*?\\n\\];")); return m?m[0]:""; }
function grab(s,key){ const set=new Set(); const re=new RegExp(key+'"?\\s*:\\s*"([^"]+)"',"g"); let m; while((m=re.exec(s))) set.add(m[1]); return set; }

try {
  const obj = parseObj(await call());
  const items = vItems(obj.items).slice(0, 18);
  const des = vDes(obj.designations).slice(0, 60);
  if (items.length < 3) { console.log(`[update] عناصر قليلة (${items.length}) — إبقاء الملف.`); process.exit(0); }

  let html = fs.readFileSync(FILE, "utf8");
  const prevDesIds  = grab(block(html,"DESIGNATIONS"), "id");
  const prevItemUrls = grab(block(html,"SANCTIONS_ITEMS"), "url");
  const hadBaseline = prevDesIds.size > 0 || prevItemUrls.size > 0;

  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const iRe = /window\.SANCTIONS_ITEMS\s*=\s*\[[\s\S]*?\n\];/;
  const dRe = /window\.DESIGNATIONS\s*=\s*\[[\s\S]*?\n\];/;
  if (!iRe.test(html) || !dRe.test(html)) throw new Error("markers not found in index.html");

  html = html.replace(/lastUpdated:\s*"[^"]*"/, `lastUpdated: ${JSON.stringify(now)}`);
  html = html.replace(iRe, `window.SANCTIONS_ITEMS = ${JSON.stringify(items, null, 2)};`);
  html = html.replace(dRe, `window.DESIGNATIONS = ${JSON.stringify(des, null, 2)};`);
  fs.writeFileSync(FILE, html);

  // ما الجديد؟ مُضافون جدد (بالمعرّف) + أخبار جديدة حديثة (برابط لم يظهر سابقاً وتاريخها ضمن 3 أيام)
  const freshDes = des.filter(d => !prevDesIds.has(d.id));
  const freshItems = items.filter(i => !prevItemUrls.has(i.url) && daysAgo(i.date) <= 3);

  if (hadBaseline && (freshDes.length || freshItems.length)) {
    let md = `## 🚨 تحديثات مهمة جديدة — مرصد العقوبات\n`;
    if (freshDes.length) {
      md += `\n### مُضافون جدد لقوائم العقوبات (${freshDes.length})\n` +
        freshDes.map(d => `- **${d.nameEn}** — ${d.nameAr} · ${d.src} · ${d.program?.en||""} (${d.date})`).join("\n") + "\n";
    }
    if (freshItems.length) {
      md += `\n### أخبار وتحديثات حديثة (${freshItems.length})\n` +
        freshItems.map(i => `- [${i.src} · ${i.date}] ${i.title.ar}\n  ${i.url}`).join("\n") + "\n";
    }
    md += `\n🔗 اللوحة: https://wahabmu8.github.io/sanctions-monitor/\n`;
    fs.writeFileSync("new_designations.md", md);
  }
  console.log(`[update] تم: ${items.length} تحديث، ${des.length} مُدرَج، جديد: ${freshDes.length} أسماء / ${freshItems.length} أخبار.`);
} catch (e) {
  console.error("[update] فشل، إبقاء الموقع كما هو:", e.message);
  process.exit(0);
}
