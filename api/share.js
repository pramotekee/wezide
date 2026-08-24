// /api/share.js — Vercel Serverless Function (v2 — แก้บั๊กหน้าขาว)
//
// สาเหตุที่หน้าขาว (v1): โค้ดเดิมใช้ req.query.topic ดึงค่าพารามิเตอร์ ซึ่งพึ่งพาว่า Vercel รันฟังก์ชันนี้
// ด้วย runtime ที่ auto-parse query string ให้เป็น req.query เสมอ — ถ้า runtime ที่ deploy จริงไม่ตรงกับที่คาด
// (เช่นกลายเป็น Edge Runtime หรือ Node runtime คนละแบบที่ไม่มี req.query) โค้ดจะพังตั้งแต่บรรทัดแรกที่แตะ
// req.query แล้วไม่มี catch คลุมไว้ ทำให้ Vercel ตอบกลับมาเป็น response ว่างเปล่า/error ที่ไม่มีเนื้อหา
// -> แก้โดยแกะ query string เองจาก req.url ตรงๆ (ไม่พึ่ง req.query เลย) และห่อทั้งฟังก์ชันด้วย try/catch
//    ชั้นนอกสุดอีกที ถ้าเกิด error อะไรก็ตามที่ไม่คาดคิด จะ fallback ไป redirect ธรรมดาแทนที่จะปล่อยให้พัง

const DEFAULT_APPSCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwUBBRSKVfEkr-FmanTnQ1pHDD_-gNQ53pWkzHLvm3kvDWSTu-ARtV70yXiuN8hep8Gmg/exec';
const FRONTEND_URL = 'https://wezide.vercel.app';

const BOT_UA_PATTERNS = [
  // หมายเหตุสำคัญ: ไม่ใส่ 'line/' ในลิสต์นี้โดยตั้งใจ — LINE ไม่มี user-agent แยกระหว่าง "บอทดึงพรีวิว"
  // กับ "in-app browser ที่คนจริงใช้เปิดลิงก์" ทั้งคู่มีคำว่า "Line/" ติดมาเหมือนกันหมด ถ้าใส่ไว้จะทำให้
  // คนจริงที่กดลิงก์ในแอป LINE โดนเข้าใจผิดว่าเป็นบอท แล้วได้หน้า og:tag เปล่า (body ว่าง) แทนที่จะถูก
  // redirect ไปหน้าเว็บจริง — เป็นสาเหตุของบั๊ก "กดลิงก์แล้วเจอหน้าขาว" ที่เจอไปก่อนหน้านี้
  // (แลกกับ trade-off: รูปพรีวิวใน LINE อาจไม่การันตีว่าจะขึ้นเสมอ เพราะตรวจจับบอทของ LINE ไม่ได้แม่นยำ
  // — แต่การกดลิงก์แล้วไปหน้าเว็บถูกต้องสำคัญกว่า)
  'facebookexternalhit', 'facebot', 'twitterbot', 'slackbot',
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

// แกะ query param เองจาก req.url แบบตรงไปตรงมา ไม่พึ่ง req.query ของ framework ใดๆ
// req.url ของ Vercel Node function คือ path+query เสมอ (เช่น "/api/share?topic=ABC123")
function getQueryParam(req, key){
  try{
    const url = new URL(req.url, 'http://placeholder.local');
    return url.searchParams.get(key);
  }catch(e){
    return null;
  }
}

function redirect(res, location){
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store'); // กัน browser/CDN cache หน้า redirect นี้ค้างไว้ผิดๆ
  res.end();
}

module.exports = async (req, res) => {
  try{
    const appscriptUrl = process.env.APPSCRIPT_URL || DEFAULT_APPSCRIPT_URL;
    const topicId = getQueryParam(req, 'topic');
    const userId = getQueryParam(req, 'mytype');

    if(!topicId && !userId){
      return redirect(res, FRONTEND_URL);
    }

    const redirectUrl = topicId
      ? `${FRONTEND_URL}/?topic=${encodeURIComponent(topicId)}`
      : `${FRONTEND_URL}/mytype.html?id=${encodeURIComponent(userId)}`;

    const ua = req.headers && req.headers['user-agent'];

    // คนจริง -> 302 ตรงไปหน้าเว็บจริงทันที ไม่ต้องรอดึง meta
    if(!isBot(ua)){
      return redirect(res, redirectUrl);
    }

    // bot -> ดึง title/desc/image จาก Apps Script มาใส่ og:tag
    const qs = topicId
      ? `action=getShareMeta&topic_id=${encodeURIComponent(topicId)}`
      : `action=getShareMeta&user_id=${encodeURIComponent(userId)}`;

    let data = null;
    try{
      const apiRes = await fetch(`${appscriptUrl}?${qs}`);
      data = await apiRes.json();
    }catch(fetchErr){
      data = null;
    }

    if(!data || !data.success){
      return redirect(res, redirectUrl);
    }

    const title = data.title || 'WEZIDE — Opinion matter!';
    const desc = data.desc || 'เวทีความเห็น เลือกข้างที่ใช่ของคุณ';
    const image = data.image || '';

    const html = `<!DOCTYPE html><html lang="th"><head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeHtml(redirectUrl)}">
</head><body></body></html>`;

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.end(html);

  }catch(err){
    // เหตุการณ์ไม่คาดคิดใดๆ ก็ตาม -> อย่างน้อยต้องพา user ไปหน้าแรกได้ ไม่ปล่อยให้เจอหน้าขาว/error ดิบ
    try{
      res.statusCode = 302;
      res.setHeader('Location', FRONTEND_URL);
      res.setHeader('Cache-Control', 'no-store');
      return res.end();
    }catch(e2){
      res.statusCode = 500;
      return res.end('error');
    }
  }
};
