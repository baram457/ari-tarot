// Vercel 서버리스 함수: /api/reading
// Groq 또는 Cerebras(둘 다 무료 티어 제공) API를 대신 호출해주는 프록시입니다.
// 앱(프론트엔드)은 이 함수만 호출하고, 실제 API 키는 여기(서버 환경 변수)에만 있습니다.
//
// 어느 걸 쓸지는 Vercel 환경 변수 PROVIDER 로 정합니다: "groq" (기본값) 또는 "cerebras"
// 그에 맞는 키도 넣어주세요: GROQ_API_KEY 또는 CEREBRAS_API_KEY

const PROVIDERS = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    envKey: 'GROQ_API_KEY',
    defaultModel: 'llama-3.3-70b-versatile'
  },
  cerebras: {
    url: 'https://api.cerebras.ai/v1/chat/completions',
    envKey: 'CEREBRAS_API_KEY',
    defaultModel: 'llama-3.3-70b'
  }
};

export default async function handler(req, res) {
  // CORS 허용 (앱을 file://로 열거나 다른 곳에서 호스팅해도 호출 가능하게)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST만 지원합니다.' });
    return;
  }

  const providerName = (process.env.PROVIDER || 'groq').toLowerCase();
  const provider = PROVIDERS[providerName];
  if (!provider) {
    res.status(500).json({ error: `알 수 없는 PROVIDER 값입니다: ${providerName} (groq 또는 cerebras만 가능)` });
    return;
  }

  const apiKey = process.env[provider.envKey];
  if (!apiKey) {
    res.status(500).json({ error: `서버에 ${provider.envKey} 환경 변수가 설정되어 있지 않습니다.` });
    return;
  }

  try {
    const { system, messages, max_tokens } = req.body;

    // 프론트엔드는 Anthropic 스타일({system, messages:[{role,content:string}]})로 보내는데,
    // Groq/Cerebras는 OpenAI 호환 형식이라 system도 messages 배열 맨 앞에 role:'system'으로 넣어줍니다.
    const openaiMessages = [
      { role: 'system', content: system },
      ...messages.map(m => ({ role: m.role, content: m.content }))
    ];

    const upstreamRes = await fetch(provider.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.MODEL || provider.defaultModel,
        max_tokens: max_tokens || 1200,
        messages: openaiMessages
      })
    });

    const data = await upstreamRes.json();

    if (!upstreamRes.ok) {
      res.status(upstreamRes.status).json(data);
      return;
    }

    const text = data.choices?.[0]?.message?.content || '';

    // 프론트엔드가 기대하는 Anthropic 응답 모양({content:[{type:'text', text}]})으로 맞춰서 돌려줍니다.
    // 이렇게 하면 index.html 쪽 코드를 더 안 바꿔도 됩니다.
    res.status(200).json({ content: [{ type: 'text', text }] });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
