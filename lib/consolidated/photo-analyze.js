export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    return res.status(500).json({
      error: 'OPENAI_API_KEY not configured on server'
    });
  }

  const { imageBase64, mimeType, prompt } = req.body || {};

  if (!imageBase64 || !mimeType) {
    return res.status(400).json({ error: 'Missing image data' });
  }

  if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(mimeType)) {
    return res.status(400).json({ error: 'Unsupported image type' });
  }

  const safePrompt =
    typeof prompt === 'string' && prompt.trim()
      ? prompt.trim()
      : 'Summarize this photo in concise bullet points.';

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: safePrompt
              },
              {
                type: 'input_image',
                image_url: `data:${mimeType};base64,${imageBase64}`
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const details = await response.text();
      return res.status(response.status).json({
        error: 'OpenAI API request failed',
        details
      });
    }

    const data = await response.json();
    const summary = data.output_text || 'No summary returned.';

    return res.status(200).json({ summary });
  } catch (error) {
    console.error('Photo analyze error:', error);
    return res.status(500).json({
      error: 'Failed to analyze photo',
      message: error.message
    });
  }
}
