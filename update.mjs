// مُحدِّث مرصد العقوبات — يعمل على GitHub Actions كل ساعة.
// يحدّث البيانات داخل index.html مباشرة، ويكتب new_designations.md عند وجود مُضافين جدد.
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
function prevIds(h){ const m=h.match(/window\.DESIGNATIONS\s*=\s*(\[[\s\S]*?\n\]);/); if(!m) return new Set();
  try{ return new Set(JSON.parse(m[1]).map(d=>d.id)); }catch{ return new Set(); } }

try {
  const obj = parseObj(await call());
  const items = vItems(obj.items).slice(0, 18);
  const des = vDes(obj.designations).slice(0, 60);
  if (items.length < 3) { console.log(`[update] عناصر قليلة (${items.length}) — إبقاء الملف.`); process.exit(0); }

  let html = fs.readFileSync(FILE, "utf8");
  const pIds = prevIds(html);
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const iRe = /window\.SANCTIONS_ITEMS\s*=\s*\[[\s\S]*?\n\];/;
  const dRe = /window\.DESIGNATIONS\s*=\s*\[[\s\S]*?\n\];/;
  if (!iRe.test(html) || !dRe.test(html)) throw new Error("markers not found in index.html");

  html = html.replace(/lastUpdated:\s*"[^"]*"/, `lastUpdated: ${JSON.stringify(now)}`);
  html = html.replace(iRe, `window.SANCTIONS_ITEMS = ${JSON.stringify(items, null, 2)};`);
  html = html.replace(dRe, `window.DESIGNATIONS = ${JSON.stringify(des, null, 2)};`);
  fs.writeFileSync(FILE, html);

  const fresh = des.filter(d => !pIds.has(d.id));
  if (fresh.length && pIds.size) {
    fs.writeFileSync("new_designations.md",
      `## 🚨 ${fresh.length} مُضاف جديد لقوائم العقوبات\n\n` +
      fresh.map(d => `- **${d.nameEn}** — ${d.nameAr} · ${d.src} · ${d.program?.en||""} (${d.date})`).join("\n") + "\n");
  }
  console.log(`[update] تم: ${items.length} تحديث، ${des.length} مُدرَج، جديد: ${fresh.length}.`);
} catch (e) {
  console.error("[update] فشل، إبقاء الموقع كما هو:", e.message);
  process.exit(0);
}
