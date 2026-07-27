const { CATEGORIES } = require('./categories');

const PROMPT = `이 영수증 이미지를 분석해서 아래 JSON 형식으로만 답해줘. 다른 설명은 절대 추가하지 마.
{"category": "숙박" | "식비" | "장보기" | "교통비" 중 하나, "date": "YYYY-MM-DD", "amount": 숫자(원 단위, 콤마 없이), "merchant": "상호명", "detail": "구매 품목 요약"}
영수증에서 확인할 수 없는 값은 빈 문자열이나 0으로 둬.`;

async function classifyReceiptImage(base64Image, mimeType, apiKey, fetchImpl = fetch) {
  const res = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: PROMPT },
            { inline_data: { mime_type: mimeType, data: base64Image } },
          ],
        }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    }
  );

  if (!res.ok) throw new Error(`GEMINI_HTTP_${res.status}`);

  const body = await res.json();
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('GEMINI_EMPTY_RESPONSE');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error('GEMINI_PARSE_ERROR');
  }

  return {
    category: CATEGORIES.includes(parsed.category) ? parsed.category : '',
    date: typeof parsed.date === 'string' ? parsed.date : '',
    amount: Number.isFinite(parsed.amount) ? parsed.amount : 0,
    merchant: typeof parsed.merchant === 'string' ? parsed.merchant : '',
    detail: typeof parsed.detail === 'string' ? parsed.detail : '',
  };
}

module.exports = { classifyReceiptImage, PROMPT };
