const { classifyReceiptImage } = require('../../src/lib/geminiClient');

function fakeFetch(responseBody, ok = true, status = 200) {
  return jest.fn().mockResolvedValue({
    ok,
    status,
    json: async () => responseBody,
  });
}

function geminiTextResponse(jsonText) {
  return { candidates: [{ content: { parts: [{ text: jsonText }] } }] };
}

describe('classifyReceiptImage', () => {
  test('parses a well-formed Gemini response', async () => {
    const body = geminiTextResponse(JSON.stringify({
      category: '식비', date: '2026-08-01', amount: 45000, merchant: '감자바우', detail: '옹심이칼국수 x18',
    }));
    const result = await classifyReceiptImage('base64data', 'image/jpeg', 'key', fakeFetch(body));

    expect(result).toEqual({
      category: '식비', date: '2026-08-01', amount: 45000, merchant: '감자바우', detail: '옹심이칼국수 x18',
    });
  });

  test('coerces an unrecognized category to an empty string', async () => {
    const body = geminiTextResponse(JSON.stringify({
      category: '기타', date: '2026-08-01', amount: 1000, merchant: 'x', detail: 'y',
    }));
    const result = await classifyReceiptImage('base64data', 'image/jpeg', 'key', fakeFetch(body));
    expect(result.category).toBe('');
  });

  test('throws on an HTTP error from Gemini', async () => {
    await expect(
      classifyReceiptImage('base64data', 'image/jpeg', 'key', fakeFetch({}, false, 500))
    ).rejects.toThrow('GEMINI_HTTP_500');
  });

  test('throws when Gemini returns text that is not valid JSON', async () => {
    const body = geminiTextResponse('this is not json');
    await expect(
      classifyReceiptImage('base64data', 'image/jpeg', 'key', fakeFetch(body))
    ).rejects.toThrow('GEMINI_PARSE_ERROR');
  });

  test('coerces a non-numeric amount to 0', async () => {
    const body = geminiTextResponse(JSON.stringify({
      category: '식비', date: '2026-08-01', amount: 'not-a-number', merchant: 'x', detail: 'y',
    }));
    const result = await classifyReceiptImage('base64data', 'image/jpeg', 'key', fakeFetch(body));
    expect(result.amount).toBe(0);
  });

  test('coerces a non-string date, merchant, and detail to empty strings', async () => {
    const body = geminiTextResponse(JSON.stringify({
      category: '식비', date: null, amount: 1000, merchant: 42, detail: {},
    }));
    const result = await classifyReceiptImage('base64data', 'image/jpeg', 'key', fakeFetch(body));
    expect(result.date).toBe('');
    expect(result.merchant).toBe('');
    expect(result.detail).toBe('');
  });
});
