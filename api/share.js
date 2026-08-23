// /api/share.js — Vercel Serverless Function
//
// ทำไมต้องมีไฟล์นี้ (แก้ 2 ปัญหาที่ share link ผ่าน script.google.com แก้ไม่ได้จริงจัง):
// 1) UX ค้างที่ script.google.com — บาง in-app browser/webview (เช่น LINE, iOS Link Preview) "แช่แข็ง"
//    URL bar ไว้ที่ URL แรกที่ถูกเปิดเสมอ ไม่ว่าโค้ดฝั่ง Apps Script จะ redirect ด้วยวิธีไหน (meta refresh,
//    location.replace, top.location) ก็ตาม เพราะเป็นพฤติกรรมของ webview นั้นเอง แก้จาก Apps Script ไม่ได้
// 2) OG image ไม่โชว์ — บาง bot preview ที่ทำตาม redirect chain ของ Apps Script (script.google.com ->
//    script.googleusercontent.com -> ...) ไม่ครบ เลยไม่เจอ og:image ของหัวข้อนั้น
//
// ทางแก้: ให้ลิงก์ที่แชร์ออกไปชี้มาที่ https://wezide.vercel.app/api/share?... (โดเมนเดียวกับเว็บจริง) แทน
// ไฟล์นี้เช็ค User-Agent — ถ้าเป็น bot ของแอปแชท/โซเชียล จะเสิร์ฟ og:tag ตรงๆ ไม่ redirect (ให้ bot อ่านได้ครบ)
// ถ้าเป็นคนจริง จะยิง HTTP 302 ไปหน้าเว็บจริงทันที (โดเมนเดียวกัน ไม่มี sandbox/webview quirk ใดๆ มากวนใจ)
//
// ตั้งค่า: ต้องมี Environment Variable ชื่อ APPSCRIPT_URL ใน Vercel project ชี้ไปที่ Apps Script /exec URL
// เดียวกับ CONFIG.API_URL ในไฟล์ index.txt (ถ้าไม่ตั้งค่า จะ fallback ไปใช้ค่า default ที่ hardcode ไว้ด้านล่าง
// เผื่อสะดวกตอนทดสอบ แต่แนะนำให้ตั้งเป็น env var จริงเพื่อให้แก้ทีเดียวได้ทั้งระบบตอนย้าย deployment)

const DEFAULT_APPSCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwUBBRSKVfEkr-FmanTnQ1pHDD_-gNQ53pWkzHLvm3kvDWSTu-ARtV70yXiuN8hep8Gmg/exec';
const FRONTEND_URL = 'https://wezide.vercel.app';

// รายชื่อ user-agent ของ bot ที่ทำ link preview ให้แอปแชท/โซเชียลต่างๆ — ถ้าตรงกับพวกนี้ = ต้องการ og:tag
// ไม่ใช่การ browse จริง (เช็คแบบ case-insensitive substring match พอ ไม่ต้อง exact match)
const BOT_UA_PATTERNS = [
  'facebookexternalhit', 'facebot', 'line-poker', 'line/', 'twitterbot', 'slackbot',
  'discordbot', 'whatsapp', 'telegrambot', 'linkedinbot', 'pinterest', 'googlebot',
  'bingbot', 'embedly', 'quora link preview', 'showyoubot', 'outbrain', 'redditbot',
  'applebot', 'skypeuripreview', 'vkshare', 'w3c_validator', 'iframely', 'tumblr'
];

function isBot(userAgent){
  const ua = String(userAgent || '').toLowerCase();
  return BOT_UA_PATTERNS.some(p => ua.indexOf(p) !== -1);
}

function escapeHtml(str){
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = async (req, res) => {
  const appscriptUrl = process.env.APPSCRIPT_URL || DEFAULT_APPSCRIPT_URL;
  const topicId = req.query.topic;
  const userId = req.query.mytype;

  // ไม่มี param ที่รู้จักเลย -> เด้งกลับหน้าแรกเฉยๆ กันหน้าเปล่า
  if(!topicId && !userId){
    res.writeHead(302, { Location: FRONTEND_URL });
    return res.end();
  }

  const redirectUrl = topicId
    ? `${FRONTEND_URL}/?topic=${encodeURIComponent(topicId)}`
    : `${FRONTEND_URL}/mytype.html?id=${encodeURIComponent(userId)}`;

  const ua = req.headers['user-agent'];

  // คนจริง (ไม่ใช่ bot ทำพรีวิว) -> ยิง 302 ตรงไปหน้าเว็บจริงทันที ไม่ต้องเสียเวลาไปดึง meta เลย
  // (เร็วกว่า, และไม่มีความเสี่ยงเรื่อง Apps Script ช้า/error มากั้นทางคนเปิดลิงก์จริง)
  if(!isBot(ua)){
    res.writeHead(302, { Location: redirectUrl });
    return res.end();
  }

  // เป็น bot -> ไปดึง title/desc/image จาก Apps Script backend มาใส่ og:tag ให้ครบ
  try{
    const qs = topicId
      ? `action=getShareMeta&topic_id=${encodeURIComponent(topicId)}`
      : `action=getShareMeta&user_id=${encodeURIComponent(userId)}`;
    const apiRes = await fetch(`${appscriptUrl}?${qs}`);
    const data = await apiRes.json();

    if(!data || !data.success){
      // ดึงข้อมูลไม่สำเร็จ -> ยัง redirect คนจริงได้ปกติ (bot ที่ตามมาด้วยจะได้แค่หน้าเปล่า ไม่ใช่เรื่องคอขาดบาดตาย)
      res.writeHead(302, { Location: redirectUrl });
      return res.end();
    }

    const { title, desc, image } = data;
    const html = `<!DOCTYPE html><html lang="th"><head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeHtml(redirectUrl)}">
</head><body></body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // cache สั้นๆ ฝั่ง CDN กัน bot ยิงรัวๆ ถล่ม Apps Script ซ้ำ (title/desc/image ไม่ได้เปลี่ยนบ่อยระดับนาที)
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.statusCode = 200;
    return res.end(html);
  }catch(err){
    // Apps Script ยิงไม่ทัน/error -> fallback ไป redirect เฉยๆ กันหน้าเว็บพังไปเลย
    res.writeHead(302, { Location: redirectUrl });
    return res.end();
  }
};
